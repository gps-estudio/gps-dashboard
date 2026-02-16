# GPS Estudio - Dashboard General

Panel de control centralizado para GPS Estudio con tracking de aplicaciones y costos.

## Features

### 📱 Pestaña Aplicaciones
- Card Sofia Bot → sofia-bot-dashboard.vercel.app
- Card VAPI Campaigns → vapi-campaign-dashboard.vercel.app
- Card Chatwoot → 34.170.148.211.nip.io

### 💰 Pestaña Costos
Tracking de costos por servicio:
- **VAPI**: Costos reales via API (transport, LLM, TTS, etc.)
- **Sofia Bot**: Estimación basada en Cloud Run pricing
- **Chatwoot**: Costo fijo VM e2-highcpu-4

Filtros: Hoy, Semana, Mes, Total

## Setup

```bash
npm install
npm run dev
```

## Environment Variables

```
VAPI_API_KEY=your_vapi_key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=gps2026
```

## Deploy

```bash
vercel --prod
```

## APIs

### GET /api/costs?period=month
Returns cost breakdown by service.

Periods: `today`, `week`, `month`, `all`

Response:
```json
{
  "vapi": { "total": 0.05, "calls": 10, "breakdown": {...} },
  "cloudRun": { "total": 0.02, "requests": 200, "cpuHours": 0.5 },
  "chatwoot": { "total": 97.00, "uptime": 99.9 },
  "totalMonth": 97.07
}
```
