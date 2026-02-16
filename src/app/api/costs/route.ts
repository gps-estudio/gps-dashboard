import { NextRequest, NextResponse } from 'next/server'

const VAPI_API_KEY = process.env.VAPI_API_KEY || ''

// Precios estimados GCP (us-central1)
const GCP_PRICING = {
  // e2-medium: 2 vCPU, 4GB RAM
  // Precio por hora: ~$0.134/hr
  chatwootVmHourly: 0.034,
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
    return { total: 0, calls: 0, breakdown: {} }
  }

  try {
    const { start, end } = getDateRange(period)
    
    // Fetch calls from VAPI
    const params = new URLSearchParams({
      limit: '1000',
      createdAtGt: start.toISOString(),
      createdAtLt: end.toISOString(),
    })
    
    const response = await fetch(`https://api.vapi.ai/call?${params}`, {
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
      },
      next: { revalidate: 300 }, // Cache 5 minutes
    })

    if (!response.ok) {
      console.error('VAPI API error:', response.status)
      return { total: 0, calls: 0, breakdown: {} }
    }

    const calls = await response.json()
    
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
    }
  } catch (error) {
    console.error('Error fetching VAPI costs:', error)
    return { total: 0, calls: 0, breakdown: {} }
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

async function getChatwootCosts(period: Period) {
  const { start, end } = getDateRange(period)
  const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
  
  // Chatwoot VM runs 24/7
  const cost = hours * GCP_PRICING.chatwootVmHourly
  
  return {
    total: cost,
    uptime: 99.9, // Assumed uptime
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const period = (searchParams.get('period') as Period) || 'month'

  try {
    const [vapi, cloudRun, chatwoot] = await Promise.all([
      getVAPICosts(period),
      getCloudRunCosts(period),
      getChatwootCosts(period),
    ])

    const totalMonth = vapi.total + cloudRun.total + chatwoot.total

    return NextResponse.json({
      vapi,
      cloudRun,
      chatwoot,
      totalMonth,
      period,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching costs:', error)
    return NextResponse.json({ error: 'Error fetching costs' }, { status: 500 })
  }
}
