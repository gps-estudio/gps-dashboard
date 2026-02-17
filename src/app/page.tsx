'use client'

import { useState, useEffect } from 'react'

type Tab = 'apps' | 'costs'
type Period = 'today' | 'week' | 'month' | 'all'

interface CostData {
  vapi: { total: number; calls: number; breakdown: Record<string, number>; limitedTo14Days?: boolean; isRealData?: boolean }
  cloudRun: { total: number; requests: number; cpuHours: number; isRealData?: boolean }
  chatwoot: { 
    total: number; 
    uptime: number; 
    machineType?: string; 
    provider?: string; 
    specs?: string; 
    monthlyRate?: number;
    isRealData?: boolean;
    ip?: string;
    lastUpdated?: string;
  }
  openclaw: { total: number; uptime: number; machineType?: string; specs?: string; hourlyRate?: number; isRealData?: boolean }
  totalMonth: number
  timestamp?: string
  gcpBillingAccount?: string
  gcpProject?: string
}

const apps = [
  {
    name: 'Sofia Bot',
    description: 'Dashboard del chatbot WhatsApp',
    url: 'https://sofia-bot-dashboard.vercel.app',
    icon: '🤖',
    color: 'from-green-500 to-emerald-600',
  },
  {
    name: 'VAPI Campaigns',
    description: 'Campañas de llamadas automáticas',
    url: 'https://vapi-campaign-dashboard.vercel.app',
    icon: '📞',
    color: 'from-blue-500 to-indigo-600',
  },
  {
    name: 'Chatwoot',
    description: 'Plataforma de soporte y mensajería (Hetzner)',
    url: 'https://178.156.255.182.sslip.io',
    icon: '💬',
    color: 'from-purple-500 to-violet-600',
  },
]

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('apps')
  const [period, setPeriod] = useState<Period>('month')
  const [costs, setCosts] = useState<CostData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (activeTab === 'costs') {
      fetchCosts()
    }
  }, [activeTab, period])

  async function fetchCosts() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/costs?period=${period}`)
      if (!res.ok) throw new Error('Error fetching costs')
      const data = await res.json()
      setCosts(data)
    } catch (err) {
      setError('Error cargando costos')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">GPS Estudio</h1>
            <p className="text-gray-600">Panel de Control General</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition"
          >
            Cerrar sesión
          </button>
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 bg-gray-100 p-1 rounded-xl mb-8 w-fit">
          <button
            onClick={() => setActiveTab('apps')}
            className={`px-6 py-2.5 rounded-lg font-medium transition ${
              activeTab === 'apps'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            📱 Aplicaciones
          </button>
          <button
            onClick={() => setActiveTab('costs')}
            className={`px-6 py-2.5 rounded-lg font-medium transition ${
              activeTab === 'costs'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            💰 Costos
          </button>
        </div>

        {/* Apps Tab */}
        {activeTab === 'apps' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {apps.map((app) => (
              <a
                key={app.name}
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="card-hover block bg-white rounded-2xl overflow-hidden shadow-lg"
              >
                <div className={`h-32 bg-gradient-to-br ${app.color} flex items-center justify-center`}>
                  <span className="text-6xl">{app.icon}</span>
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-semibold text-gray-800 mb-2">{app.name}</h3>
                  <p className="text-gray-600">{app.description}</p>
                  <div className="mt-4 flex items-center text-sm text-gray-500">
                    <span className="truncate">{app.url.replace('https://', '')}</span>
                    <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}

        {/* Costs Tab */}
        {activeTab === 'costs' && (
          <div>
            {/* Period Filter */}
            <div className="flex space-x-2 mb-6">
              {[
                { key: 'today', label: 'Hoy' },
                { key: 'week', label: 'Semana' },
                { key: 'month', label: 'Mes' },
                { key: 'all', label: 'Total' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setPeriod(key as Period)}
                  className={`px-4 py-2 rounded-lg font-medium transition ${
                    period === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading && (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Cargando costos...</p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {costs && !loading && (
              <div className="space-y-6">
                {/* Total Card */}
                <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 text-white">
                  <p className="text-blue-100 mb-1">Costo Total ({period === 'today' ? 'Hoy' : period === 'week' ? 'Semana' : period === 'month' ? 'Este Mes' : 'Total'})</p>
                  <p className="text-4xl font-bold">${costs.totalMonth.toFixed(2)} USD</p>
                </div>

                {/* Service Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* VAPI */}
                  <div className="bg-white rounded-2xl p-6 shadow-lg relative">
                    {costs.vapi.limitedTo14Days && (
                      <span className="absolute top-2 right-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                        ⚠️ 14 días
                      </span>
                    )}
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-800">📞 VAPI</h3>
                      <span className="text-2xl font-bold text-blue-600">${costs.vapi.total.toFixed(2)}</span>
                    </div>
                    <div className="space-y-2 text-sm text-gray-600">
                      <div className="flex justify-between">
                        <span>Llamadas</span>
                        <span className="font-medium">{costs.vapi.calls}</span>
                      </div>
                      {costs.vapi.breakdown.stt > 0 && (
                        <div className="flex justify-between">
                          <span>STT</span>
                          <span>${costs.vapi.breakdown.stt.toFixed(3)}</span>
                        </div>
                      )}
                      {costs.vapi.breakdown.llm > 0 && (
                        <div className="flex justify-between">
                          <span>LLM</span>
                          <span>${costs.vapi.breakdown.llm.toFixed(3)}</span>
                        </div>
                      )}
                      {costs.vapi.breakdown.tts > 0 && (
                        <div className="flex justify-between">
                          <span>TTS</span>
                          <span>${costs.vapi.breakdown.tts.toFixed(3)}</span>
                        </div>
                      )}
                      {costs.vapi.breakdown.vapi > 0 && (
                        <div className="flex justify-between">
                          <span>VAPI Fee</span>
                          <span>${costs.vapi.breakdown.vapi.toFixed(3)}</span>
                        </div>
                      )}
                      {costs.vapi.breakdown.transport > 0 && (
                        <div className="flex justify-between">
                          <span>Transport</span>
                          <span>${costs.vapi.breakdown.transport.toFixed(3)}</span>
                        </div>
                      )}
                      {costs.vapi.limitedTo14Days && (
                        <p className="text-xs text-amber-600 mt-2">⚠️ Limitado a últimos 14 días (plan VAPI)</p>
                      )}
                    </div>
                  </div>

                  {/* Cloud Run (Sofia Bot) */}
                  <div className="bg-white rounded-2xl p-6 shadow-lg relative">
                    {costs.cloudRun.isRealData ? (
                      <span className="absolute top-2 right-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        ✓ API Real
                      </span>
                    ) : (
                      <span className="absolute top-2 right-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                        ~ Estimado
                      </span>
                    )}
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-800">🤖 Sofia Bot</h3>
                      <span className="text-2xl font-bold text-green-600">${costs.cloudRun.total.toFixed(2)}</span>
                    </div>
                    <div className="space-y-2 text-sm text-gray-600">
                      <div className="flex justify-between">
                        <span>Requests</span>
                        <span className="font-medium">{costs.cloudRun.isRealData ? '' : '~'}{costs.cloudRun.requests.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>CPU Hours</span>
                        <span>{costs.cloudRun.isRealData ? '' : '~'}{costs.cloudRun.cpuHours.toFixed(2)}h</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-2">☁️ Cloud Run (us-central1)</p>
                    </div>
                  </div>

                  {/* Chatwoot VM - Hetzner */}
                  <div className="bg-white rounded-2xl p-6 shadow-lg relative">
                    {costs.chatwoot.isRealData && (
                      <span className="absolute top-2 right-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        ✓ API Real
                      </span>
                    )}
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-800">💬 Chatwoot</h3>
                      <span className="text-2xl font-bold text-purple-600">${costs.chatwoot.total.toFixed(2)}</span>
                    </div>
                    <div className="space-y-2 text-sm text-gray-600">
                      <div className="flex justify-between">
                        <span>Tipo</span>
                        <span className="font-medium">{costs.chatwoot.machineType || 'CX23'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Specs</span>
                        <span className="font-medium">{costs.chatwoot.specs || '2 vCPU, 4GB'}</span>
                      </div>
                      {costs.chatwoot.monthlyRate && (
                        <div className="flex justify-between">
                          <span>Mensual</span>
                          <span className="font-medium">${costs.chatwoot.monthlyRate.toFixed(2)}/mes</span>
                        </div>
                      )}
                      {costs.chatwoot.ip && costs.chatwoot.ip !== 'N/A' && (
                        <div className="flex justify-between">
                          <span>IP</span>
                          <span className="font-mono text-xs">{costs.chatwoot.ip}</span>
                        </div>
                      )}
                      <p className="text-xs text-gray-400 mt-2">🇺🇸 Hetzner (Ashburn, VA)</p>
                    </div>
                  </div>

                  {/* OpenClaw Gateway */}
                  <div className="bg-white rounded-2xl p-6 shadow-lg relative">
                    {costs.openclaw.isRealData ? (
                      <span className="absolute top-2 right-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        ✓ API Real
                      </span>
                    ) : (
                      <span className="absolute top-2 right-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                        ~ Estimado
                      </span>
                    )}
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-800">🦾 OpenClaw</h3>
                      <span className="text-2xl font-bold text-orange-600">${costs.openclaw.total.toFixed(2)}</span>
                    </div>
                    <div className="space-y-2 text-sm text-gray-600">
                      <div className="flex justify-between">
                        <span>Tipo</span>
                        <span className="font-medium">{costs.openclaw.machineType || 'e2-medium'}</span>
                      </div>
                      {costs.openclaw.specs && (
                        <div className="flex justify-between">
                          <span>Specs</span>
                          <span className="font-medium">{costs.openclaw.specs}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>Uptime</span>
                        <span>{costs.openclaw.isRealData ? '' : '~'}{costs.openclaw.uptime.toFixed(1)}%</span>
                      </div>
                      {costs.openclaw.hourlyRate && (
                        <div className="flex justify-between">
                          <span>Tarifa</span>
                          <span className="font-medium">${costs.openclaw.hourlyRate.toFixed(4)}/hr</span>
                        </div>
                      )}
                      <p className="text-xs text-gray-400 mt-2">☁️ Compute Engine (us-central1)</p>
                    </div>
                  </div>
                </div>

                {/* Cost Breakdown Chart (simple) */}
                <div className="bg-white rounded-2xl p-6 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">Distribución de Costos</h3>
                  <div className="h-8 rounded-full overflow-hidden flex bg-gray-100">
                    {costs.totalMonth > 0 && (
                      <>
                        <div 
                          className="bg-blue-500 h-full" 
                          style={{ width: `${(costs.vapi.total / costs.totalMonth) * 100}%` }}
                          title={`VAPI: $${costs.vapi.total.toFixed(2)}`}
                        ></div>
                        <div 
                          className="bg-green-500 h-full" 
                          style={{ width: `${(costs.cloudRun.total / costs.totalMonth) * 100}%` }}
                          title={`Cloud Run: $${costs.cloudRun.total.toFixed(2)}`}
                        ></div>
                        <div 
                          className="bg-purple-500 h-full" 
                          style={{ width: `${(costs.chatwoot.total / costs.totalMonth) * 100}%` }}
                          title={`Chatwoot: $${costs.chatwoot.total.toFixed(2)}`}
                        ></div>
                        <div 
                          className="bg-orange-500 h-full" 
                          style={{ width: `${(costs.openclaw.total / costs.totalMonth) * 100}%` }}
                          title={`OpenClaw: $${costs.openclaw.total.toFixed(2)}`}
                        ></div>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-center gap-4 mt-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                      <span>VAPI</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-green-500"></div>
                      <span>Sofia Bot</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                      <span>Chatwoot</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                      <span>OpenClaw</span>
                    </div>
                  </div>
                </div>

                {/* Last Updated */}
                <div className="text-center text-sm text-gray-500 mt-4">
                  <p>
                    Última actualización: {costs.timestamp ? new Date(costs.timestamp).toLocaleString('es-AR', { 
                      timeZone: 'America/Argentina/Buenos_Aires',
                      dateStyle: 'short',
                      timeStyle: 'short'
                    }) : 'N/A'}
                  </p>
                  <p className="text-xs mt-1">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span> API Real
                    </span>
                    {' · '}
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-yellow-500"></span> Estimado
                    </span>
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
