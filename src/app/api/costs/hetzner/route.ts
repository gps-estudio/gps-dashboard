import { NextResponse } from 'next/server'

const HETZNER_API_TOKEN = process.env.HETZNER_API_TOKEN || ''
const HETZNER_API_BASE = 'https://api.hetzner.cloud/v1'

interface HetznerServer {
  id: number
  name: string
  status: string
  created: string
  server_type: {
    name: string
    description: string
    cores: number
    memory: number
    disk: number
    prices: Array<{
      location: string
      price_hourly: { net: string; gross: string }
      price_monthly: { net: string; gross: string }
    }>
  }
  datacenter: {
    name: string
    location: {
      name: string
      description: string
      city: string
      country: string
    }
  }
  public_net: {
    ipv4: { ip: string }
    ipv6: { ip: string }
  }
  included_traffic: number
  ingoing_traffic: number
  outgoing_traffic: number
}

interface HetznerCostData {
  servers: Array<{
    id: number
    name: string
    type: string
    description: string
    specs: string
    location: string
    locationDesc: string
    ip: string
    status: string
    created: string
    priceHourly: number
    priceMonthly: number
    currentMonthCost: number
    trafficIncludedGB: number
    trafficUsedGB: number
  }>
  totalMonthly: number
  totalCurrentMonth: number
  lastUpdated: string
}

function bytesToGB(bytes: number): number {
  return bytes / (1024 * 1024 * 1024)
}

function calculateCurrentMonthCost(created: string, monthlyPrice: number, hourlyPrice: number): number {
  const now = new Date()
  const createdDate = new Date(created)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  
  // If server was created this month, calculate from creation date
  const effectiveStart = createdDate > startOfMonth ? createdDate : startOfMonth
  
  const hoursRunning = (now.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60)
  
  // Hetzner bills hourly up to the monthly cap
  const hourlyTotal = hoursRunning * hourlyPrice
  return Math.min(hourlyTotal, monthlyPrice)
}

export async function GET() {
  if (!HETZNER_API_TOKEN) {
    return NextResponse.json({ 
      error: 'HETZNER_API_TOKEN not configured',
      servers: [],
      totalMonthly: 0,
      totalCurrentMonth: 0,
      lastUpdated: new Date().toISOString()
    }, { status: 200 })
  }

  try {
    const response = await fetch(`${HETZNER_API_BASE}/servers`, {
      headers: {
        'Authorization': `Bearer ${HETZNER_API_TOKEN}`,
      },
      next: { revalidate: 300 }, // Cache 5 minutes
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Hetzner API error:', response.status, errorText)
      return NextResponse.json({ 
        error: `Hetzner API error: ${response.status}`,
        servers: [],
        totalMonthly: 0,
        totalCurrentMonth: 0,
        lastUpdated: new Date().toISOString()
      }, { status: 200 })
    }

    const data = await response.json()
    const servers: HetznerServer[] = data.servers || []

    const result: HetznerCostData = {
      servers: servers.map(server => {
        // Find price for this server's location
        const locationPricing = server.server_type.prices.find(
          p => p.location === server.datacenter.location.name
        ) || server.server_type.prices[0]

        const priceHourly = parseFloat(locationPricing?.price_hourly.gross || '0')
        const priceMonthly = parseFloat(locationPricing?.price_monthly.gross || '0')
        const currentMonthCost = calculateCurrentMonthCost(server.created, priceMonthly, priceHourly)

        return {
          id: server.id,
          name: server.name,
          type: server.server_type.name.toUpperCase(),
          description: server.server_type.description,
          specs: `${server.server_type.cores} vCPU, ${server.server_type.memory}GB RAM, ${server.server_type.disk}GB SSD`,
          location: server.datacenter.location.name,
          locationDesc: server.datacenter.location.description,
          ip: server.public_net.ipv4?.ip || 'N/A',
          status: server.status,
          created: server.created,
          priceHourly,
          priceMonthly,
          currentMonthCost,
          trafficIncludedGB: Math.round(bytesToGB(server.included_traffic)),
          trafficUsedGB: Math.round(bytesToGB(server.ingoing_traffic + server.outgoing_traffic) * 100) / 100
        }
      }),
      totalMonthly: 0,
      totalCurrentMonth: 0,
      lastUpdated: new Date().toISOString()
    }

    // Calculate totals
    result.totalMonthly = result.servers.reduce((sum, s) => sum + s.priceMonthly, 0)
    result.totalCurrentMonth = result.servers.reduce((sum, s) => sum + s.currentMonthCost, 0)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching Hetzner costs:', error)
    return NextResponse.json({ 
      error: 'Error fetching Hetzner data',
      servers: [],
      totalMonthly: 0,
      totalCurrentMonth: 0,
      lastUpdated: new Date().toISOString()
    }, { status: 200 })
  }
}
