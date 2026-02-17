import { NextRequest, NextResponse } from 'next/server'

const VAPI_API_KEY = process.env.VAPI_API_KEY || ''
const HETZNER_API_TOKEN = process.env.HETZNER_API_TOKEN || ''
const HETZNER_API_BASE = 'https://api.hetzner.cloud/v1'

// Precios estimados GCP (us-central1)
const GCP_PRICING = {
  // e2-medium: 2 vCPU, 4GB RAM
  // Precio por hora: ~$0.034/hr (on-demand)
  e2MediumHourly: 0.034,
  // Cloud Run: 
  // CPU: $0.00002400/vCPU-second = $0.0864/vCPU-hour
  // Memory: $0.00000250/GiB-second
  // Requests: $0.40 per million
  cloudRunCpuPerHour: 0.0864,
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
      start.setFullYear(2020) // Desde siempre
      break
  }
  
  return { start, end }
}

async function getVAPICosts(period: Period) {
  if (!VAPI_API_KEY) {
    return { total: 0, calls: 0, breakdown: {}, limitedTo14Days: false }
  }

  try {
    const { start, end } = getDateRange(period)
    
    // VAPI plan only allows 14 days of call history
    // Adjust start date if needed
    const maxHistoryDays = 14
    const maxHistoryMs = maxHistoryDays * 24 * 60 * 60 * 1000
    const effectiveStart = new Date(Math.max(start.getTime(), end.getTime() - maxHistoryMs))
    const limitedTo14Days = effectiveStart.getTime() > start.getTime()
    
    // Fetch calls from VAPI
    const params = new URLSearchParams({
      limit: '1000',
      createdAtGt: effectiveStart.toISOString(),
      createdAtLt: end.toISOString(),
    })
    
    const response = await fetch(`https://api.vapi.ai/call?${params}`, {
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
      },
      next: { revalidate: 300 }, // Cache 5 minutes
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('VAPI API error:', response.status, errorText)
      return { total: 0, calls: 0, breakdown: {}, limitedTo14Days, error: `API error: ${response.status}` }
    }

    const calls = await response.json()
    
    // Handle case where response is not an array (error response)
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
    }
  } catch (error) {
    console.error('Error fetching VAPI costs:', error)
    return { total: 0, calls: 0, breakdown: {}, limitedTo14Days: false, error: String(error) }
  }
}

async function getCloudRunCosts(period: Period) {
  // Cloud Run costs are harder to get in real-time without BigQuery export
  // We'll estimate based on usage patterns
  
  const { start, end } = getDateRange(period)
  const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
  
  // Estimated usage for Sofia Bot:
  // - Average 0.1 vCPU-hours per day (scaled to 0 when idle)
  // - ~100 requests per day average
  const daysInPeriod = hours / 24
  
  const estimatedCpuHours = daysInPeriod * 0.5 // Very conservative estimate
  const estimatedRequests = daysInPeriod * 200
  
  const cpuCost = estimatedCpuHours * GCP_PRICING.cloudRunCpuPerHour
  const requestCost = (estimatedRequests / 1000000) * GCP_PRICING.cloudRunRequestsPerMillion
  
  return {
    total: cpuCost + requestCost,
    requests: Math.round(estimatedRequests),
    cpuHours: estimatedCpuHours,
  }
}

async function getHetznerCostsReal(period: Period) {
  if (!HETZNER_API_TOKEN) {
    console.warn('HETZNER_API_TOKEN not configured, using fallback estimates')
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
    
    let totalCost = 0
    let totalMonthlyRate = 0
    const serverDetails: Array<{
      name: string
      type: string
      specs: string
      location: string
      ip: string
      cost: number
      monthlyRate: number
    }> = []

    for (const server of servers) {
      // Find price for this server's location
      const locationPricing = server.server_type.prices.find(
        (p: { location: string }) => p.location === server.datacenter.location.name
      ) || server.server_type.prices[0]

      const priceHourly = parseFloat(locationPricing?.price_hourly.gross || '0')
      const priceMonthly = parseFloat(locationPricing?.price_monthly.gross || '0')
      
      // Calculate cost for the selected period
      const serverCreated = new Date(server.created)
      const effectiveStart = serverCreated > start ? serverCreated : start
      
      let periodCost = 0
      if (effectiveStart < end) {
        const hoursInPeriod = (end.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60)
        
        // For monthly period, check if we're in the same month
        if (period === 'month') {
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
          const effectiveMonthStart = serverCreated > startOfMonth ? serverCreated : startOfMonth
          const hoursThisMonth = (now.getTime() - effectiveMonthStart.getTime()) / (1000 * 60 * 60)
          periodCost = Math.min(hoursThisMonth * priceHourly, priceMonthly)
        } else if (period === 'all') {
          // Calculate full months + current month
          const monthsRunning = (now.getFullYear() - serverCreated.getFullYear()) * 12 + 
                                (now.getMonth() - serverCreated.getMonth())
          periodCost = monthsRunning * priceMonthly + Math.min(
            ((now.getTime() - new Date(now.getFullYear(), now.getMonth(), 1).getTime()) / (1000 * 60 * 60)) * priceHourly,
            priceMonthly
          )
        } else {
          periodCost = hoursInPeriod * priceHourly
        }
      }
      
      totalCost += periodCost
      totalMonthlyRate += priceMonthly
      
      serverDetails.push({
        name: server.name,
        type: server.server_type.name.toUpperCase(),
        specs: `${server.server_type.cores} vCPU, ${server.server_type.memory}GB RAM, ${server.server_type.disk}GB SSD`,
        location: server.datacenter.location.description,
        ip: server.public_net?.ipv4?.ip || 'N/A',
        cost: periodCost,
        monthlyRate: priceMonthly,
      })
    }

    // For Chatwoot specifically, find the server (usually ubuntu-2gb-ash-1 or similar)
    const chatwootServer = servers[0] // Main server
    const chatwootPricing = chatwootServer?.server_type.prices.find(
      (p: { location: string }) => p.location === chatwootServer.datacenter.location.name
    ) || chatwootServer?.server_type.prices[0]

    return {
      total: totalCost,
      uptime: 99.9,
      machineType: chatwootServer?.server_type.name.toUpperCase() || 'Unknown',
      provider: 'Hetzner',
      specs: chatwootServer ? 
        `${chatwootServer.server_type.cores} vCPU, ${chatwootServer.server_type.memory}GB RAM` : 
        'N/A',
      ip: chatwootServer?.public_net?.ipv4?.ip || 'N/A',
      monthlyRate: parseFloat(chatwootPricing?.price_monthly.gross || '0'),
      isRealData: true,
      servers: serverDetails,
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
      servers: [],
      lastUpdated: new Date().toISOString(),
    }
  }
}

async function getOpenClawCosts(period: Period) {
  const { start, end } = getDateRange(period)
  const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
  
  // OpenClaw Gateway runs 24/7 on e2-medium
  const cost = hours * GCP_PRICING.e2MediumHourly
  
  return {
    total: cost,
    uptime: 99.9, // Assumed uptime
    machineType: 'e2-medium',
    region: 'us-central1',
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const period = (searchParams.get('period') as Period) || 'month'

  try {
    const [vapi, cloudRun, chatwoot, openclaw] = await Promise.all([
      getVAPICosts(period),
      getCloudRunCosts(period),
      getHetznerCostsReal(period),
      getOpenClawCosts(period),
    ])

    const totalMonth = vapi.total + cloudRun.total + chatwoot.total + openclaw.total

    return NextResponse.json({
      vapi,
      cloudRun,
      chatwoot,
      openclaw,
      totalMonth,
      period,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching costs:', error)
    return NextResponse.json({ error: 'Error fetching costs' }, { status: 500 })
  }
}
