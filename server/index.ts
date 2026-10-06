import { contentSecurityPolicy } from './lib/securityHeaders'
import cors from 'cors'
import './lib/env'
import cookieParser from 'cookie-parser'
import express from 'express'
import rateLimit from 'express-rate-limit'
import path from 'node:path'
import { adminRouter } from './routes/admin'
import { analyticsRouter } from './routes/analytics'
import { authRouter } from './routes/auth'
import { billingRouter } from './routes/billing'
import { batchRouter } from './routes/batch'
import { channelsRouter } from './routes/channels'
import { cronRouter } from './routes/cron'
import { dashboardKeysRouter } from './routes/dashboardKeys'
import { dashboardWebhooksRouter } from './routes/dashboardWebhooks'
import { dashboardChannelsRouter } from './routes/dashboardChannels'
import { dashboardTranscriptsRouter } from './routes/dashboardTranscripts'
import { dashboardBatchesRouter } from './routes/dashboardBatches'
import { dashboardSourcesRouter } from './routes/dashboardSources'
import { dashboardTeamRouter } from './routes/dashboardTeam'
import { keysRouter } from './routes/keys'
import { hasSummaryProvider, summaryRouter } from './routes/summary'
import { translateRouter } from './routes/translate'
import { handleTranscriptPrepareRequest, handleTranscriptRequest, transcriptRouter } from './routes/transcripts'
import { usageRouter } from './routes/usage'
import { waitlistRouter } from './routes/waitlist'
import { feedbackRouter } from './routes/feedback'
import { publicMetricsRouter } from './routes/publicMetrics'
import { wallpaperRouter } from './routes/wallpaper'
import { webhooksRouter } from './routes/webhooks'
import { requireAdminSession, requireApiKey, requirePrivateAdminNetwork, requireSession } from './middleware/auth'
import { hasSupabaseConfig, supabase } from './lib/supabase'
import { startScheduler } from './lib/scheduler'
import { resolveRateLimit, resolveTrustProxyHops } from './lib/networkConfig'
import { getOperationsState, hydrateOperationsState, recordRateLimitedClient } from './lib/opsState'
import { hasPolarPlanConfig } from './lib/polar'
import { getSpeechProviderOrder } from './lib/speechToText'
import { hydrateSpeechProviderCredentials } from './lib/speechProviderCredentials'
import { renderWorkspaceAccessEmail } from './lib/email'
import { trackRuntimeRequest } from './lib/runtimeMetrics'
import { getReleasePolicy } from './lib/releasePolicy'
import { probeReadonlyRpcContracts, type RuntimeSchemaReadiness } from './lib/readiness'

const app = express()
const port = Number(process.env.PORT || 4000)
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5000'
const allowedClientUrls = (process.env.CLIENT_URLS || clientUrl)
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean)
const distPath = path.join(process.cwd(), 'dist')
const trustProxyHops = resolveTrustProxyHops(process.env.TRUST_PROXY_HOPS, process.env.NODE_ENV)
const getBillingMode = () => hasPolarPlanConfig('api') || hasPolarPlanConfig('business') ? 'polar' : 'unconfigured'
let schemaReadiness: Promise<RuntimeSchemaReadiness> | null = null
let schemaCheckedAt = 0
const getRuntimeSchemaReadiness = () => {
  if (!schemaReadiness || Date.now() - schemaCheckedAt > 30_000) {
    schemaCheckedAt = Date.now()
    schemaReadiness = probeReadonlyRpcContracts((name, parameters) =>
      supabase.rpc(name, parameters, { get: true }).abortSignal(AbortSignal.timeout(5000)))
  }
  return schemaReadiness
}

if (process.env.NODE_ENV !== 'production') {
  app.get('/_preview/checkout-email', (_request, response) => {
    const preview = renderWorkspaceAccessEmail({
      accessKey: 'et_access_••••••••••••••••',
      plan: 'api',
      limit: 10_000,
    })
    response.type('html').send(preview.html)
  })
}

app.disable('x-powered-by')
if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops)
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader(
    'Content-Security-Policy',
    contentSecurityPolicy,
  )
  next()
})
app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    const normalizedOrigin = origin?.replace(/\/+$/, '')
    // Production admin is accessed only through an SSH local-port forward.
    // Vite's code-split admin bundle is fetched in CORS mode, so the local
    // browser origin must be allowed as well as the public site origin.
    const localLoopbackOrigin = Boolean(normalizedOrigin
      && /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(normalizedOrigin))
    if (!normalizedOrigin || allowedClientUrls.includes(normalizedOrigin) || localLoopbackOrigin) {
      callback(null, true)
      return
    }
    callback(new Error('Not allowed by CORS'))
  },
}))
app.use('/api/billing/polar/webhook', express.raw({ type: 'application/json' }))
app.use(cookieParser())
app.use(express.json({ limit: '1mb' }))
app.use(trackRuntimeRequest)

const transcriptLimiter = rateLimit({
  windowMs: 60_000,
  limit: resolveRateLimit(process.env.PUBLIC_TRANSCRIPT_RATE_LIMIT_PER_MIN, 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (request, response) => {
    recordRateLimitedClient(request.ip || 'unknown', request.path)
    response.status(429).json({ error: 'rate_limited', message: 'Too many requests. Try again in a minute.' })
  },
})

const summaryLimiter = rateLimit({
  windowMs: 60_000,
  limit: resolveRateLimit(process.env.PUBLIC_SUMMARY_RATE_LIMIT_PER_MIN, 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (request, response) => {
    recordRateLimitedClient(request.ip || 'unknown', request.path)
    response.status(429).json({ error: 'rate_limited', message: 'Too many summary requests. Try again in a minute.' })
  },
})

const translateLimiter = rateLimit({
  windowMs: 60_000,
  limit: resolveRateLimit(process.env.PUBLIC_TRANSLATE_RATE_LIMIT_PER_MIN, 40),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (request, response) => {
    recordRateLimitedClient(request.ip || 'unknown', request.path)
    response.status(429).json({ error: 'rate_limited', message: 'Too many translation requests. Try again in a minute.' })
  },
})

const waitlistLimiter = rateLimit({
  windowMs: 60_000,
  limit: resolveRateLimit(process.env.PUBLIC_WAITLIST_RATE_LIMIT_PER_MIN, 10),
  standardHeaders: true,
  legacyHeaders: false,
})
const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  limit: resolveRateLimit(process.env.PUBLIC_CHECKOUT_RATE_LIMIT_PER_MIN, 10),
  standardHeaders: true,
  legacyHeaders: false,
})
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: resolveRateLimit(process.env.AUTH_RATE_LIMIT_PER_15_MIN, 8),
  standardHeaders: true,
  legacyHeaders: false,
})
const analyticsLimiter = rateLimit({
  windowMs: 60_000,
  limit: resolveRateLimit(process.env.ANALYTICS_RATE_LIMIT_PER_MIN, 120),
  standardHeaders: true,
  legacyHeaders: false,
})
const wallpaperLimiter = rateLimit({
  windowMs: 60_000,
  limit: resolveRateLimit(process.env.PUBLIC_WALLPAPER_RATE_LIMIT_PER_MIN, 30),
  standardHeaders: true,
  legacyHeaders: false,
})
const feedbackLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: resolveRateLimit(process.env.PUBLIC_FEEDBACK_RATE_LIMIT_PER_15_MIN, 5),
  standardHeaders: true,
  legacyHeaders: false,
})
const publicMetricsLimiter = rateLimit({
  windowMs: 60_000,
  limit: resolveRateLimit(process.env.PUBLIC_METRICS_RATE_LIMIT_PER_MIN, 30),
  standardHeaders: true,
  legacyHeaders: false,
})
const dashboardLimiter = rateLimit({
  windowMs: 60_000,
  limit: resolveRateLimit(process.env.DASHBOARD_RATE_LIMIT_PER_MIN, 600),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (request, response) => {
    recordRateLimitedClient(request.ip || 'unknown', request.path)
    response.status(429).json({ error: 'rate_limited', message: 'Too many dashboard requests. Try again in a minute.' })
  },
})
const sourceInspectionLimiter = rateLimit({
  windowMs: 60_000,
  limit: resolveRateLimit(process.env.SOURCE_INSPECTION_RATE_LIMIT_PER_MIN, 20),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (request, response) => {
    recordRateLimitedClient(request.ip || 'unknown', request.path)
    response.status(429).json({ error: 'rate_limited', message: 'Too many source analyses. Try again in a minute.' })
  },
})

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/system/status', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.json({ ...getOperationsState(), features: { ...getReleasePolicy(), summaryEnabled: hasSummaryProvider() } })
})

app.get('/api/ready', async (_request, response) => {
  if (getOperationsState().mode === 'maintenance') {
    response.status(503).json({ ok: false, error: 'maintenance' })
    return
  }
  if (!hasSupabaseConfig()) {
    response.status(503).json({ ok: false, database: false })
    return
  }
  try {
    const { error } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .abortSignal(AbortSignal.timeout(5000))
    const email = Boolean(process.env.RESEND_API_KEY)
    const providerOrder = getSpeechProviderOrder('business')
    const transcription = providerOrder.length > 0
    const paidFallback = providerOrder[0] ?? null
    const schema = await getRuntimeSchemaReadiness()
    const ready = !error && email && transcription && schema.ok
    response.status(ready ? 200 : 503).json({
      ok: ready,
      database: !error,
      email,
      transcription,
      paidFallback,
      speechProviders: providerOrder,
      billing: getBillingMode(),
      schema,
      features: { ...getReleasePolicy(), summaryEnabled: hasSummaryProvider() },
      bilibili: {
        metadata: true,
        authenticatedCaptions: Boolean(process.env.BILIBILI_SESSDATA),
        audioFallback: false,
      },
    })
  } catch {
    response.status(503).json({ ok: false, database: false, email: Boolean(process.env.RESEND_API_KEY), transcription: false, paidFallback: null })
  }
})

app.use((request, response, next) => {
  const operationsMode = getOperationsState().mode
  const alwaysAllowed = request.path.startsWith('/api/admin')
    || request.path.startsWith('/api/auth')
    || request.path === '/api/system/status'
    || request.path === '/api/health'
  const protectedPublicWork = request.path.startsWith('/api/transcript')
    || request.path.startsWith('/api/summary')
    || request.path.startsWith('/api/translate')
    || request.path.startsWith('/v1')

  if (alwaysAllowed || operationsMode === 'live' || (operationsMode === 'security' && !protectedPublicWork)) {
    next()
    return
  }
  response.status(503).json({
    error: operationsMode,
    message: operationsMode === 'security'
      ? 'EasyTran is temporarily accepting dashboard traffic only.'
      : 'EasyTran is temporarily offline.',
  })
})

app.use('/api/transcripts', transcriptLimiter, transcriptRouter)
app.post('/api/transcript/prepare', transcriptLimiter, handleTranscriptPrepareRequest)
app.post('/api/transcript', transcriptLimiter, handleTranscriptRequest)
app.use('/api/summary', summaryLimiter, summaryRouter)
app.use('/api/translate', translateLimiter, translateRouter)
app.use('/api/analytics', analyticsLimiter, analyticsRouter)
app.use('/api/public-metrics', publicMetricsLimiter, publicMetricsRouter)
app.use('/api/wallpaper', wallpaperLimiter, wallpaperRouter)
app.post('/api/auth/magic-link', authLimiter)
app.post('/api/auth/admin-key-login', authLimiter, requirePrivateAdminNetwork)
app.post('/api/auth/key-login', authLimiter)
app.post('/api/auth/bootstrap-login', authLimiter)
app.post('/api/auth/password-login', authLimiter)
app.post('/api/auth/complete-setup', authLimiter)
app.use('/api/auth', authRouter)
app.use('/api/waitlist', waitlistLimiter, waitlistRouter)
app.use('/api/feedback', feedbackLimiter, feedbackRouter)
app.use('/api/admin', requirePrivateAdminNetwork, requireAdminSession, adminRouter)
app.use('/api/dashboard', (request, response, next) => {
  const localDevelopmentAccess = process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_BYPASS === 'true'
  if (!getReleasePolicy().paidWorkspacesEnabled && !localDevelopmentAccess) {
    response.status(503).json({ error: 'paid_workspaces_unavailable', message: 'Dashboard access is temporarily paused.' })
    return
  }
  next()
}, requireSession, dashboardLimiter, (request, response, next) => {
  if (request.onboardingRequired) {
    response.status(428).json({ error: 'onboarding_required' })
    return
  }
  next()
})
app.use('/api/dashboard/keys', dashboardKeysRouter)
app.use('/api/dashboard/usage', usageRouter)
app.use('/api/dashboard/webhooks', dashboardWebhooksRouter)
app.use('/api/dashboard/channels', dashboardChannelsRouter)
app.use('/api/dashboard/transcripts', dashboardTranscriptsRouter)
app.use('/api/dashboard/batches', dashboardBatchesRouter)
app.use('/api/dashboard/sources', sourceInspectionLimiter, dashboardSourcesRouter)
app.use('/api/dashboard/team', dashboardTeamRouter)
app.use('/v1/transcripts/batch', batchRouter)
app.use('/v1/transcripts', requireApiKey, transcriptRouter)
app.use('/v1/keys', keysRouter)
app.use('/v1/webhooks', webhooksRouter)
app.use('/v1/channels', channelsRouter)
app.post('/api/billing/checkout', checkoutLimiter)
app.post('/api/billing/portal', checkoutLimiter, requireSession)
app.use('/api/billing', billingRouter)
app.use('/api/cron', cronRouter)

if (process.env.NODE_ENV === 'production') {
  app.use('/admin', requirePrivateAdminNetwork)
  app.get('/dashboard', (_request, response, next) => {
    if (getReleasePolicy().paidWorkspacesEnabled) {
      next()
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.sendFile(path.join(distPath, 'dashboard-hold.html'))
  })
  app.use(express.static(distPath, { maxAge: '1y', index: false }))
  app.get(/^(?!\/api|\/v1).*/, (_request, response) => {
    response.sendFile(path.join(distPath, 'index.html'))
  })
}

// The Supabase client falls back to a placeholder URL when config is absent, and
// /api/health stays minimal so maintenance mode works. Together that lets a
// misconfigured production deploy go live and pass health checks, then fail on
// every real request. Refuse to boot instead.
function verifyProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return

  const fatal: string[] = []
  const degraded: string[] = []

  if (!hasSupabaseConfig()) fatal.push('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
  if (process.env.DEV_AUTH_BYPASS === 'true') fatal.push('DEV_AUTH_BYPASS must not be set in production.')
  if (!process.env.CLIENT_URL) fatal.push('CLIENT_URL is required for auth links, CORS, and checkout returns.')

  if (!process.env.RESEND_API_KEY) degraded.push('RESEND_API_KEY missing — magic-link login and API-key email cannot be sent.')
  if (!getSpeechProviderOrder('business').length) degraded.push('No speech provider configured — videos without captions cannot be transcribed.')
  if (!process.env.CRON_SECRET && process.env.ENABLE_INTERNAL_SCHEDULER !== 'true') {
    degraded.push('CRON_SECRET missing and internal scheduler off — scheduled jobs will not run.')
  }

  for (const warning of degraded) console.warn(`⚠️  ${warning}`)

  if (fatal.length) {
    console.error('Refusing to start: production configuration is incomplete.')
    for (const problem of fatal) console.error(`  - ${problem}`)
    process.exit(1)
  }
}

async function start() {
  verifyProductionConfig()
  await hydrateSpeechProviderCredentials().catch((error) => {
    console.error('[speech-credentials] startup hydration failed:', error)
  })
  await hydrateOperationsState().catch((error) => {
    console.error('[operations] startup hydration failed:', error)
  })
  app.listen(port, host, () => {
    console.log(`EasyTranscript listening on http://${host}:${port}`)
    if (process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_BYPASS === 'true') {
      console.warn('⚠️  DEV_AUTH_BYPASS is ON — dashboard auth is disabled. Do NOT use in production.')
    }
    startScheduler()
  })
}

void start()
