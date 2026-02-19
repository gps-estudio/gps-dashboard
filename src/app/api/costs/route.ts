import { NextRequest, NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'

const VAPI_API_KEY = process.env.VAPI_API_KEY || ''
const HETZNER_API_TOKEN = process.env.HETZNER_API_TOKEN || ''
const HETZNER_API_BASE = 'https://api.hetzner.cloud/v1'

// GCP Billing Configuration (only for Cloud Run / Sofia Bot)
const GCP_BILLING_CREDENTIALS = process.env.GCP_BILLING_CREDENTIALS || ''
const GCP_BILLING_ACCOUNT_ID = process.env.GCP_BILLING_ACCOUNT_ID || '01F2CB-329AFF-39493F'

// GCP Projects configuration - only Cloud Run for Sofia Bot
const GCP_PROJECTS = {
  cloudRun: 'gps-bot-481315',  // Cloud Run (gps-bot / Sofia)
}

// GCP Pricing (us-central1) - for cost calculation from real metrics
const GCP_PRICING = {
  // Cloud Run pricing
  cloudRunCpuPerVCpuSecond: 0.00002400,
  cloudRunMemPerGibSecond: 0.00000250,
  cloudRunRequestsPerMillion: 0.40,
}

type Period = 'today' | 'week' | 'month' | 'all'

function getDateRange(period: Period): { start: Date; end: Date } {
  const end = new Date()
  const start = new Date()
  
  switch (period) {
    case 'today':
      start.setHours(0, 0, 0, 0)
      break
    case 'week':
      start.setDate(start.getDate() - 7)
      break
    case 'month':
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      break
    case 'all':
      start.setFullYear(2024, 0, 1) // Since January 2024
      break
  }
  
  return { start, end }
}

// Initialize GCP auth from base64 credentials
function getGCPAuth(): GoogleAuth | null {
  if (!GCP_BILLING_CREDENTIALS) {
    console.warn('GCP_BILLING_CREDENTIALS not configured')
    return null
  }
  
  try {
    const credentials = JSON.parse(Buffer.from(GCP_BILLING_CREDENTIALS, 'base64').toString('utf-8'))
    return new GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/cloud-billing.readonly',
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/monitoring.read',
      ],
    })
  } catch (error) {
    console.error('Error parsing GCP credentials:', error)
    return null
  }
}

async function getVAPICosts(period: Period) {
  if (!VAPI_API_KEY) {
    return { total: 0, calls: 0, breakdown: {}, limitedTo14Days: false }
  }

  try {
    const { start, end } = getDateRange(period)
    
    // VAPI plan only allows 14 days of call history
    const maxHistoryDays = 14
    const maxHistoryMs = maxHistoryDays * 24 * 60 * 60 * 1000
    const effectiveStart = new Date(Math.max(start.getTime(), end.getTime() - maxHistoryMs))
    const limitedTo14Days = effectiveStart.getTime() > start.getTime()
    
    const params = new URLSearchParams({
      limit: '1000',
      createdAtGt: effectiveStart.toISOString(),
      createdAtLt: end.toISOString(),
    })
    
    const response = await fetch(`https://api.vapi.ai/call?${params}`, {
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
      },
      next: { revalidate: 300 },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('VAPI API error:', response.status, errorText)
      return { total: 0, calls: 0, breakdown: {}, limitedTo14Days, error: `API error: ${response.status}` }
    }

    const calls = await response.json()
    
    if (!Array.isArray(calls)) {
      console.error('VAPI returned non-array response:', calls)
      return { total: 0, calls: 0, breakdown: {}, limitedTo14Days, error: 'Invalid response' }
    }
    
    let total = 0
    const breakdown: Record<string, number> = {
      transport: 0,
      stt: 0,
      llm: 0,
      tts: 0,
      vapi: 0,
    }

    for (const call of calls) {
      total += call.cost || 0
      if (call.costBreakdown) {
        breakdown.transport += call.costBreakdown.transport || 0
        breakdown.stt += call.costBreakdown.stt || 0
        breakdown.llm += call.costBreakdown.llm || 0
        breakdown.tts += call.costBreakdown.tts || 0
        breakdown.vapi += call.costBreakdown.vapi || 0
      }
    }

    return {
      total,
      calls: calls.length,
      breakdown,
      limitedTo14Days,
      isRealData: true,
    }
  } catch (error) {
    console.error('Error fetching VAPI costs:', error)
    return { total: 0, calls: 0, breakdown: {}, limitedTo14Days: false, error: String(error) }
  }
}

// Get Cloud Run metrics
async function getCloudRunMetrics(auth: GoogleAuth, projectId: string, period: Period) {
  try {
    const { start, end } = getDateRange(period)
    const client = await auth.getClient()
    const accessToken = await client.getAccessToken()
    
    const monitoringUrl = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`
    
    // Get request count for Cloud Run
    const filter = encodeURIComponent(
      'metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision"'
    )
    
    const interval = `interval.startTime=${start.toISOString()}&interval.endTime=${end.toISOString()}`
    
    const response = await fetch(
      `${monitoringUrl}?filter=${filter}&${interval}&aggregation.alignmentPeriod=86400s&aggregation.perSeriesAligner=ALIGN_SUM`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken.token}`,
          'Content-Type': 'application/json',
        },
      }
    )
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Cloud Run Monitoring API error for ${projectId}:`, response.status, errorText)
      return null
    }
    
    const data = await response.json()
    
    let totalRequests = 0
    let serviceName = 'unknown'
    
    if (data.timeSeries) {
      for (const series of data.timeSeries) {
        if (series.resource?.labels?.service_name) {
          serviceName = series.resource.labels.service_name
        }
        if (series.points) {
          for (const point of series.points) {
            totalRequests += parseInt(point.value?.int64Value || '0', 10)
          }
        }
      }
    }
    
    // Also get container instance time (billable CPU seconds)
    const cpuFilter = encodeURIComponent(
      'metric.type="run.googleapis.com/container/billable_instance_time" AND resource.type="cloud_run_revision"'
    )
    
    const cpuResponse = await fetch(
      `${monitoringUrl}?filter=${cpuFilter}&${interval}&aggregation.alignmentPeriod=86400s&aggregation.perSeriesAligner=ALIGN_SUM`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken.token}`,
          'Content-Type': 'application/json',
        },
      }
    )
    
    let billableSeconds = 0
    if (cpuResponse.ok) {
      const cpuData = await cpuResponse.json()
      if (cpuData.timeSeries) {
        for (const series of cpuData.timeSeries) {
          if (series.points) {
            for (const point of series.points) {
              billableSeconds += parseFloat(point.value?.doubleValue || '0')
            }
          }
        }
      }
    }
    
    return {
      requests: totalRequests,
      billableSeconds,
      serviceName,
    }
  } catch (error) {
    console.error(`Error fetching Cloud Run metrics for ${projectId}:`, error)
    return null
  }
}

async function getCloudRunCosts(period: Period) {
  const auth = getGCPAuth()
  
  if (!auth) {
    // Fallback to estimates if no credentials
    return getCloudRunCostsEstimated(period)
  }
  
  try {
    const { start, end } = getDateRange(period)
    const hoursInPeriod = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
    const daysInPeriod = hoursInPeriod / 24
    
    const cloudRunMetrics = await getCloudRunMetrics(auth, GCP_PROJECTS.cloudRun, period)
    
    // Cloud Run (gps-bot / Sofia) - Calculate cost from real usage
    let cloudRunCost = 0
    let cloudRunRequests = 0
    let cloudRunCpuHours = 0
    let cloudRunIsReal = false
    
    if (cloudRunMetrics && (cloudRunMetrics.requests > 0 || cloudRunMetrics.billableSeconds > 0)) {
      cloudRunRequests = cloudRunMetrics.requests
      cloudRunIsReal = true
      
      if (cloudRunMetrics.billableSeconds > 0) {
        // Calculate from actual billable seconds (1 vCPU, 512MB assumed)
        const cpuCost = cloudRunMetrics.billableSeconds * GCP_PRICING.cloudRunCpuPerVCpuSecond
        const memCost = cloudRunMetrics.billableSeconds * 0.5 * GCP_PRICING.cloudRunMemPerGibSecond
        const requestCost = (cloudRunRequests / 1000000) * GCP_PRICING.cloudRunRequestsPerMillion
        cloudRunCost = cpuCost + memCost + requestCost
        cloudRunCpuHours = cloudRunMetrics.billableSeconds / 3600
      } else {
        // Estimate from request count
        const avgDurationSec = 0.5
        const cpuCost = cloudRunRequests * avgDurationSec * GCP_PRICING.cloudRunCpuPerVCpuSecond
        const memCost = cloudRunRequests * avgDurationSec * 0.5 * GCP_PRICING.cloudRunMemPerGibSecond
        const requestCost = (cloudRunRequests / 1000000) * GCP_PRICING.cloudRunRequestsPerMillion
        cloudRunCost = cpuCost + memCost + requestCost
        cloudRunCpuHours = cloudRunRequests * avgDurationSec / 3600
      }
    } else {
      // Estimate based on period
      cloudRunRequests = Math.round(daysInPeriod * 200)
      cloudRunCost = (cloudRunRequests / 1000000) * GCP_PRICING.cloudRunRequestsPerMillion
      cloudRunCpuHours = daysInPeriod * 0.5
    }
    
    return {
      total: cloudRunCost,
      requests: cloudRunRequests,
      cpuHours: cloudRunCpuHours,
      isRealData: cloudRunIsReal,
      serviceName: cloudRunMetrics?.serviceName || 'gps-bot',
      projectId: GCP_PROJECTS.cloudRun,
    }
  } catch (error) {
    console.error('Error fetching Cloud Run costs:', error)
    return getCloudRunCostsEstimated(period)
  }
}

function getCloudRunCostsEstimated(period: Period) {
  const { start, end } = getDateRange(period)
  const hoursInPeriod = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
  const daysInPeriod = hoursInPeriod / 24
  
  // Cloud Run - minimal usage estimate
  const estimatedRequests = daysInPeriod * 200
  const cloudRunCost = (estimatedRequests / 1000000) * GCP_PRICING.cloudRunRequestsPerMillion
  
  return {
    total: cloudRunCost,
    requests: Math.round(estimatedRequests),
    cpuHours: daysInPeriod * 0.5,
    isRealData: false,
    serviceName: 'gps-bot',
    projectId: GCP_PROJECTS.cloudRun,
  }
}

async function getHetznerCostsReal(period: Period) {
  if (!HETZNER_API_TOKEN) {
    console.warn('HETZNER_API_TOKEN not configured')
    return {
      total: 0,
      uptime: 99.9,
      machineType: 'Unknown',
      provider: 'Hetzner',
      specs: 'N/A',
      ip: 'N/A',
      monthlyRate: 0,
      isRealData: false,
      servers: [],
      lastUpdated: new Date().toISOString(),
    }
  }

  try {
    const response = await fetch(`${HETZNER_API_BASE}/servers`, {
      headers: {
        'Authorization': `Bearer ${HETZNER_API_TOKEN}`,
      },
      next: { revalidate: 300 },
    })

    if (!response.ok) {
      console.error('Hetzner API error:', response.status)
      throw new Error(`Hetzner API error: ${response.status}`)
    }

    const data = await response.json()
    const servers = data.servers || []
    
    const { start, end } = getDateRange(period)
    const now = new Date()
    
    // Find only the Chatwoot server (ubuntu-2gb-ash-1)
    const chatwootServer = servers.find((s: any) => 
      s.name === 'ubuntu-2gb-ash-1' || 
      s.public_net?.ipv4?.ip === '178.156.255.182'
    ) || servers[0]
    
    if (!chatwootServer) {
      return {
        total: 0,
        uptime: 99.9,
        machineType: 'Unknown',
        provider: 'Hetzner',
        specs: 'N/A',
        ip: 'N/A',
        monthlyRate: 0,
        isRealData: false,
        servers: [],
        lastUpdated: new Date().toISOString(),
      }
    }

    const locationPricing = chatwootServer.server_type.prices.find(
      (p: { location: string }) => p.location === chatwootServer.datacenter.location.name
    ) || chatwootServer.server_type.prices[0]

    const priceHourly = parseFloat(locationPricing?.price_hourly.gross || '0')
    const priceMonthly = parseFloat(locationPricing?.price_monthly.gross || '0')
    
    const serverCreated = new Date(chatwootServer.created)
    const effectiveStart = serverCreated > start ? serverCreated : start
    
    let periodCost = 0
    if (effectiveStart < end) {
      if (period === 'month') {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
        const effectiveMonthStart = serverCreated > startOfMonth ? serverCreated : startOfMonth
        const hoursThisMonth = (now.getTime() - effectiveMonthStart.getTime()) / (1000 * 60 * 60)
        periodCost = Math.min(hoursThisMonth * priceHourly, priceMonthly)
      } else if (period === 'all') {
        const monthsRunning = (now.getFullYear() - serverCreated.getFullYear()) * 12 + 
                              (now.getMonth() - serverCreated.getMonth())
        periodCost = monthsRunning * priceMonthly + Math.min(
          ((now.getTime() - new Date(now.getFullYear(), now.getMonth(), 1).getTime()) / (1000 * 60 * 60)) * priceHourly,
          priceMonthly
        )
      } else {
        const hoursInPeriod = (end.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60)
        periodCost = hoursInPeriod * priceHourly
      }
    }
    
    // Convert EUR to USD (approximate)
    const eurToUsd = 1.08
    const periodCostUsd = periodCost * eurToUsd
    const monthlyRateUsd = priceMonthly * eurToUsd

    return {
      total: periodCostUsd,
      uptime: 99.9,
      machineType: chatwootServer.server_type.name.toUpperCase(),
      provider: 'Hetzner',
      specs: `${chatwootServer.server_type.cores} vCPU, ${chatwootServer.server_type.memory}GB RAM`,
      ip: chatwootServer.public_net?.ipv4?.ip || '178.156.255.182',
      monthlyRate: monthlyRateUsd,
      isRealData: true,
      lastUpdated: new Date().toISOString(),
    }
  } catch (error) {
    console.error('Error fetching Hetzner costs:', error)
    return {
      total: 0,
      uptime: 99.9,
      machineType: 'Error',
      provider: 'Hetzner',
      specs: 'Error loading',
      ip: 'N/A',
      monthlyRate: 0,
      isRealData: false,
      lastUpdated: new Date().toISOString(),
    }
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const period = (searchParams.get('period') as Period) || 'month'

  try {
    const [vapi, cloudRun, chatwoot] = await Promise.all([
      getVAPICosts(period),
      getCloudRunCosts(period),
      getHetznerCostsReal(period),
    ])

    const totalMonth = vapi.total + cloudRun.total + chatwoot.total

    return NextResponse.json({
      vapi,
      cloudRun,
      chatwoot,
      totalMonth,
      period,
      timestamp: new Date().toISOString(),
      gcpBillingAccount: GCP_BILLING_ACCOUNT_ID,
      gcpProjects: GCP_PROJECTS,
    })
  } catch (error) {
    console.error('Error fetching costs:', error)
    return NextResponse.json({ error: 'Error fetching costs' }, { status: 500 })
  }
}
