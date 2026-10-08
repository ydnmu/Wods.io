import './AdminPage.css'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity, Archive, Bot, CircleDollarSign, Clock3, Eye, FileText, Gauge, KeyRound, ListChecks,
  LockKeyhole, LogOut, MessageSquareText, Radio, Search, Server, ShieldAlert, Trash2, Users, X,
} from 'lucide-react'

type HourMeter = { limitHours: number | null; usedHours: number; remainingHours: number | null; percentage: number }
type AdminCustomer = {
  id: string; email: string; plan: string; accessSource: string; subscriptionStatus: string | null
  quantity: number; caption: HourMeter; fallback: HourMeter; completedTranscripts: number
  lastUsedAt: string | null; activeKeys: number; monthlyRevenue: number; createdAt: string
}
type AccessRequest = {
  id: string; email: string; name: string; company: string; plan: string; requested_quantity: number
  status: string; approved_user_id: string | null; created_at: string
}
type Feedback = { id: string; username: string; message: string; source: string; status: string; created_at: string }
type Audit = { id: string; actor_email: string | null; action: string; target_type: string; target_id: string | null; created_at: string }
type StoredTranscript = {
  id: string; video_id: string; video_title: string; video_channel: string; video_duration: string
  video_thumbnail: string; word_count: number; caption_source: string; speech_providers: string[]
  ai_fallback_seconds: number; created_at: string; ownerEmail: string; ownerPlan: string
}
type PublicTranscriptEvent = {
  status: 'success' | 'error'; videoId: string | null; path: string; visitor: string; createdAt: string
}
type TranscriptMonitor = {
  totals: { stored: number; public: number; averagePublicResponseMs: number | null; publicCounterUpdatedAt: string | null }
  stored: StoredTranscript[]; publicEvents: PublicTranscriptEvent[]; warnings: string[]
}
type TranscriptDetail = StoredTranscript & {
  lines: Array<{ text: string; start?: number; duration?: number }>
  ai_summary?: unknown
}
type AdminOverview = {
  stats: {
    visitors30d: number; visitors24h: number; pageviews30d: number; transcripts30d: number
    transcriptErrors30d: number; waitlistCount: number; feedbackCount: number; usersCount: number
    activeSubscriptions: number; estimatedMrr: number; captionHoursMonth: number; fallbackHoursMonth: number
    queuedJobs: number; pendingJobItems: number; webhookFailures: number
  }
  recent: {
    events: Array<{ event: string; path: string; created_at: string }>
    waitlist: AccessRequest[]
    feedback: Feedback[]
    jobs: Array<{ id: string; total: number; completed: number; failed: number; status: string; created_at: string }>
    webhookDeliveries: Array<{ id: string; event: string; status: string; attempts: number; updated_at: string }>
    billingEvents: Array<{ id: string; event_type: string; processed_at: string }>
    audit: Audit[]
  }
  incidents: Array<{ fingerprint: string; hits: number; route: string; lastSeenAt: string }>
  providerUsage: Array<{ provider: string; usedHours: number; failures: number }>
  customers: AdminCustomer[]
  customerUsageSource: 'database_rpc' | 'fallback'
  migrationWarnings: string[]
}
type Operations = {
  mode: 'live' | 'maintenance' | 'security'; changedAt: string
  runtime: {
    activeRequests: number; activeTranscriptions: number; peakActiveRequests: number
    requestsPerMinute: number; averageResponseMs: number | null; errorsPerMinute: number
    uptimeSeconds: number; memoryRssMb: number; heapUsedMb: number
  }
  providers: {
    summary: { primary: string; model: string; pool: { configured: number; available: number; busy: number; coolingDown: number }; openAiFallback: boolean }
    transcription: {
      free: string[]; paid: string[]; models: Record<string, string>
      pool: Array<{ provider: string; active: number; concurrency: number; coolingDownUntil: number | null }>
      credentials: Array<{
        provider: string; configured: boolean; source: 'admin' | 'environment' | 'missing'
        fingerprint: string | null; updatedAt: string | null; accountIdConfigured?: boolean
      }>
      health: Array<{
        provider: string; configured: boolean; freeRoute: boolean
        status: 'healthy' | 'not_configured' | 'unauthorized' | 'rate_limited' | 'unreachable' | 'unhealthy' | 'unknown'
        detail: string; checkedAt: string | null; latencyMs: number | null
        budget: { dailyMinutes: number | null; lifetimeMinutes: number | null }
        pool: { active: number; concurrency: number; coolingDownUntil: number | null } | null
      }>
    }
  }
  flaggedClients: Array<{ fingerprint: string; hits: number; route: string; lastSeenAt: string }>
}
type AdminView = 'overview' | 'transcripts' | 'users' | 'access' | 'jobs' | 'ai' | 'abuse' | 'feedback' | 'audit'

function AdminLogin() {
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('')
    const response = await fetch('/api/auth/admin-key-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.ok) window.location.reload()
    else setError(response.status === 429 ? 'Too many attempts. Try again later.' : payload.error === 'admin_key_not_configured' ? 'Admin key is not configured on the server.' : 'Invalid admin key.')
    setLoading(false)
  }
  return <main className="dashboard-shell centered"><form className="login-card" onSubmit={submit}>
    <span className="dash-logo">WODS</span><h1>Admin access</h1><p>Enter the private administrator key stored on this computer.</p>
    <input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Administrator key" autoComplete="current-password" minLength={48} required />
    {error && <div className="error-box">{error}</div>}
    <button disabled={loading}>{loading ? 'Verifying…' : 'Unlock admin'}</button>
  </form></main>
}

const emptyStats: AdminOverview['stats'] = {
  visitors30d: 0, visitors24h: 0, pageviews30d: 0, transcripts30d: 0, transcriptErrors30d: 0,
  waitlistCount: 0, feedbackCount: 0, usersCount: 0, activeSubscriptions: 0, estimatedMrr: 0,
  captionHoursMonth: 0, fallbackHoursMonth: 0,
  queuedJobs: 0, pendingJobItems: 0, webhookFailures: 0,
}
const fmtHours = (value: number | null) => value == null ? 'Unlimited' : `${value.toLocaleString()}h`
const fmtDate = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Never'
const fmtUptime = (seconds = 0) => {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function AdminPage() {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [operations, setOperations] = useState<Operations | null>(null)
  const [transcriptMonitor, setTranscriptMonitor] = useState<TranscriptMonitor | null>(null)
  const [transcriptQuery, setTranscriptQuery] = useState('')
  const [selectedTranscript, setSelectedTranscript] = useState<TranscriptDetail | null>(null)
  const [transcriptDetailLoading, setTranscriptDetailLoading] = useState(false)
  const [view, setView] = useState<AdminView>('overview')
  const [loading, setLoading] = useState(true)
  const [authState, setAuthState] = useState<'ok' | 'login' | 'forbidden'>('ok')
  const [notice, setNotice] = useState('')
  const [customerQuery, setCustomerQuery] = useState('')
  const [modeSaving, setModeSaving] = useState(false)
  const [actionId, setActionId] = useState('')
  const [credentialProvider, setCredentialProvider] = useState('groq')
  const [credentialKey, setCredentialKey] = useState('')
  const [cloudflareAccountId, setCloudflareAccountId] = useState('')
  const [credentialSaving, setCredentialSaving] = useState(false)
  const [healthRefreshing, setHealthRefreshing] = useState(false)

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true)
    if (!quiet) setNotice('')
    try {
      const [overviewResponse, operationsResponse, transcriptsResponse] = await Promise.all([
        fetch('/api/admin/overview'), fetch('/api/admin/operations'), fetch('/api/admin/transcripts'),
      ])
      if ([overviewResponse, operationsResponse, transcriptsResponse].some((item) => item.status === 401)) { setAuthState('login'); return }
      if ([overviewResponse, operationsResponse, transcriptsResponse].some((item) => item.status === 403)) { setAuthState('forbidden'); return }
      if (operationsResponse.ok) setOperations(await operationsResponse.json())
      if (transcriptsResponse.ok) setTranscriptMonitor(await transcriptsResponse.json())
      if (overviewResponse.ok) setData(await overviewResponse.json())
      else setNotice('Admin data could not be loaded. Apply the latest database migration.')
    } catch {
      setNotice('Admin API is unavailable.')
    } finally { setLoading(false) }
  }
  useEffect(() => {
    void Promise.resolve().then(() => load())
    const refresh = window.setInterval(() => { void load(true) }, 15_000)
    return () => window.clearInterval(refresh)
  }, [])

  const setMode = async (mode: Operations['mode']) => {
    if (modeSaving || mode === operations?.mode) return
    if (mode !== 'live' && !window.confirm(`Switch public traffic to ${mode} mode?`)) return
    setModeSaving(true); setNotice('')
    const response = await fetch('/api/admin/operations/mode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.ok) setOperations((current) => current ? { ...current, ...payload } : current)
    else setNotice(payload.message || payload.error || 'Site mode could not be changed.')
    setModeSaving(false)
  }
  const saveCredential = async (event: FormEvent) => {
    event.preventDefault()
    if (credentialSaving) return
    setCredentialSaving(true); setNotice('Testing provider credentials…')
    const response = await fetch('/api/admin/providers/credentials', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: credentialProvider, apiKey: credentialKey,
        ...(credentialProvider === 'cloudflare' ? { accountId: cloudflareAccountId } : {}),
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.ok) {
      setCredentialKey(''); setNotice(`${credentialProvider} passed validation and is active.`); await load(true)
    } else setNotice(payload.error || 'Credential could not be activated.')
    setCredentialSaving(false)
  }
  const removeCredential = async (provider: string) => {
    if (!window.confirm(`Remove the admin override for ${provider}?`)) return
    const response = await fetch(`/api/admin/providers/credentials/${provider}`, { method: 'DELETE' })
    const payload = await response.json().catch(() => ({}))
    setNotice(response.ok ? `${provider} now uses its environment configuration.` : payload.error || 'Credential could not be removed.')
    if (response.ok) await load(true)
  }
  const accessAction = async (item: AccessRequest, action: 'approve' | 'reject' | 'revoke') => {
    const actionLabel = action === 'approve' ? 'Approve' : action === 'reject' ? 'Reject' : 'Revoke'
    if (!window.confirm(`${actionLabel} ${item.email}?`)) return
    setActionId(item.id); setNotice('')
    const response = await fetch(`/api/admin/access/${item.id}/${action}`, { method: 'POST' })
    const payload = await response.json().catch(() => ({}))
    setNotice(response.ok ? `Access request ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revoked'} for ${item.email}.` : payload.message || payload.error || 'Action failed.')
    if (response.ok) await load(true)
    setActionId('')
  }
  const updateFeedback = async (item: Feedback, status: 'reviewed' | 'archived') => {
    setActionId(item.id)
    const response = await fetch(`/api/admin/feedback/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    })
    if (response.ok) await load(true); else setNotice('Feedback status could not be updated.')
    setActionId('')
  }
  const checkProviderHealth = async () => {
    if (healthRefreshing) return
    setHealthRefreshing(true); setNotice('Checking transcription provider endpoints…')
    const response = await fetch('/api/admin/providers/health-check', { method: 'POST' })
    const payload = await response.json().catch(() => ({}))
    if (response.ok && Array.isArray(payload.health)) {
      setOperations((current) => current ? {
        ...current,
        providers: { ...current.providers, transcription: { ...current.providers.transcription, health: payload.health } },
      } : current)
      setNotice('Provider health check completed. This verifies control-plane access, not a full audio transcription job.')
    } else setNotice(payload.error || 'Provider health check failed.')
    setHealthRefreshing(false)
  }
  const openTranscript = async (id: string) => {
    setTranscriptDetailLoading(true); setNotice('')
    const response = await fetch(`/api/admin/transcripts/${encodeURIComponent(id)}`)
    const payload = await response.json().catch(() => ({}))
    if (response.ok) {
      const summary = transcriptMonitor?.stored.find((item) => item.id === id)
      setSelectedTranscript({ ...summary, ...payload })
    }
    else setNotice(payload.message || payload.error || 'Transcript detail could not be loaded.')
    setTranscriptDetailLoading(false)
  }
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.assign('/') }

  const normalizedQuery = customerQuery.trim().toLowerCase()
  const visibleCustomers = useMemo(() => (data?.customers || []).filter((customer) => !normalizedQuery
    || customer.email.toLowerCase().includes(normalizedQuery)
    || customer.plan.toLowerCase().includes(normalizedQuery)
    || String(customer.subscriptionStatus || customer.accessSource).toLowerCase().includes(normalizedQuery)), [data, normalizedQuery])
  const normalizedTranscriptQuery = transcriptQuery.trim().toLowerCase()
  const visibleStoredTranscripts = useMemo(() => (transcriptMonitor?.stored || []).filter((item) => !normalizedTranscriptQuery
    || item.video_title.toLowerCase().includes(normalizedTranscriptQuery)
    || item.video_channel.toLowerCase().includes(normalizedTranscriptQuery)
    || item.video_id.toLowerCase().includes(normalizedTranscriptQuery)
    || item.ownerEmail.toLowerCase().includes(normalizedTranscriptQuery)), [transcriptMonitor, normalizedTranscriptQuery])

  if (authState === 'login') return <AdminLogin />
  if (loading) return <main className="dashboard-shell centered">Loading admin…</main>
  if (authState === 'forbidden') return <main className="dashboard-shell centered"><section className="login-card"><h1>Admin only</h1><p>This account cannot open operations.</p></section></main>

  const navigation = [
    ['overview', Activity, 'Overview'], ['transcripts', FileText, 'Transcripts'], ['users', Users, 'Users & hours'], ['access', ListChecks, 'Access requests'],
    ['jobs', Server, 'Jobs & delivery'], ['ai', Bot, 'AI providers'], ['abuse', ShieldAlert, 'Abuse'],
    ['feedback', MessageSquareText, 'Feedback'], ['audit', Clock3, 'Audit log'],
  ] as const
  const stats = data?.stats || emptyStats
  const metricCards = [
    { label: 'Visitors / 24h', value: stats.visitors24h, Icon: Users },
    { label: 'Transcripts / 30d', value: stats.transcripts30d, Icon: Archive },
    { label: 'Caption hours / month', value: stats.captionHoursMonth, suffix: 'h', Icon: Gauge },
    { label: 'Fallback hours / month', value: stats.fallbackHoursMonth, suffix: 'h', Icon: Bot },
    { label: 'Active plans', value: stats.activeSubscriptions, Icon: CircleDollarSign },
    { label: 'Queued jobs', value: stats.queuedJobs, Icon: Server },
    { label: 'Errors / 30d', value: stats.transcriptErrors30d, Icon: ShieldAlert },
    { label: 'MRR estimate', value: `$${stats.estimatedMrr.toLocaleString()}`, Icon: CircleDollarSign },
  ]
  const providerName = (provider: string) => provider === 'cloudflare' ? 'Cloudflare AI' : provider === 'assemblyai' ? 'AssemblyAI' : provider === 'deepgram' ? 'Deepgram' : provider === 'fireworks' ? 'Fireworks' : provider === 'groq' ? 'Groq' : 'Transcription worker'
  const healthLabel = (status: Operations['providers']['transcription']['health'][number]['status']) => ({
    healthy: 'HEALTHY', not_configured: 'NOT CONFIGURED', unauthorized: 'UNAUTHORIZED', rate_limited: 'RATE LIMITED',
    unreachable: 'UNREACHABLE', unhealthy: 'UNHEALTHY', unknown: 'UNKNOWN',
  }[status])

  return <main className="admin-page">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="/"><span>W</span><strong>WODS</strong></a>
      <p className="admin-nav-label">CONTROL PLANE</p>
      <nav>{navigation.map(([id, Icon, label]) => <button key={id} className={view === id ? 'active' : ''} type="button" onClick={() => setView(id)}><Icon size={17} />{label}</button>)}</nav>
      <div className="admin-sidebar-foot"><a href="/dashboard">Workspace dashboard</a><button type="button" onClick={logout}><LogOut size={15} />Sign out</button></div>
    </aside>

    <section className="admin-workspace">
      <header className="admin-header">
        <div><span>ADMIN CONTROL</span><h1>{navigation.find(([id]) => id === view)?.[2]}</h1></div>
        <div className={`admin-live-state ${operations?.mode || 'offline'}`}><i />{operations?.mode || 'offline'}</div>
      </header>
      {notice && <div className="admin-notice">{notice}</div>}
      {!!data?.migrationWarnings?.length && <div className="admin-notice">Database update required: {data.migrationWarnings.join(', ')}</div>}

      {view === 'overview' && <>
        <section className="admin-command">
          <div><span>SITE MODE</span><h2>Traffic control</h2><p>Persisted across restarts. Admin and authentication routes stay available.</p></div>
          <div className="admin-mode-switch">
            <button className={operations?.mode === 'live' ? 'active' : ''} disabled={modeSaving} onClick={() => void setMode('live')}><Radio size={16} />Live</button>
            <button className={operations?.mode === 'security' ? 'active' : ''} disabled={modeSaving} onClick={() => void setMode('security')}><LockKeyhole size={16} />Security</button>
            <button className={operations?.mode === 'maintenance' ? 'active danger' : ''} disabled={modeSaving} onClick={() => void setMode('maintenance')}><ShieldAlert size={16} />Maintenance</button>
          </div>
        </section>
        <section className="admin-metrics">{metricCards.map(({ label, value, suffix, Icon }) =>
          <article className="admin-card" key={label}><Icon size={17} /><span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString() : value}{suffix || ''}</strong></article>)}</section>
        <section className="admin-panel admin-runtime-panel">
          <div className="admin-panel-title"><Activity size={17} /><h2>Live workload</h2><small>Refreshes every 15 seconds</small></div>
          <div className="admin-runtime-grid">
            <div><span>Active requests</span><strong>{operations?.runtime.activeRequests ?? 0}</strong><small>Peak {operations?.runtime.peakActiveRequests ?? 0}</small></div>
            <div><span>Active transcripts</span><strong>{operations?.runtime.activeTranscriptions ?? 0}</strong><small>{stats.pendingJobItems.toLocaleString()} queued items</small></div>
            <div><span>Requests / min</span><strong>{operations?.runtime.requestsPerMinute ?? 0}</strong><small>All API traffic</small></div>
            <div><span>Average latency</span><strong>{operations?.runtime.averageResponseMs == null ? 'N/A' : `${operations.runtime.averageResponseMs}ms`}</strong><small>{operations?.runtime.errorsPerMinute ?? 0} server errors / min</small></div>
            <div><span>Process uptime</span><strong>{fmtUptime(operations?.runtime.uptimeSeconds)}</strong><small>Since last deploy</small></div>
            <div><span>Server memory</span><strong>{operations?.runtime.memoryRssMb ?? 0} MB</strong><small>{operations?.runtime.heapUsedMb ?? 0} MB heap</small></div>
          </div>
        </section>
        <section className="admin-overview-grid">
          <article className="admin-panel"><div className="admin-panel-title"><Server size={17} /><h2>Service signal</h2></div>
            <p><span>Summary pool</span><b>{operations?.providers.summary.pool.available ?? 0} / {operations?.providers.summary.pool.configured ?? 0} ready</b></p>
            <p><span>Free transcript route</span><b>{operations?.providers.transcription.free.join(' → ') || 'not configured'}</b></p>
            <p><span>Paid transcript route</span><b>{operations?.providers.transcription.paid.join(' → ') || 'not configured'}</b></p>
            <p><span>Mode last changed</span><b>{fmtDate(operations?.changedAt)}</b></p>
          </article>
          <article className="admin-panel"><div className="admin-panel-title"><Activity size={17} /><h2>Recent traffic</h2></div>
            {(data?.recent.events || []).slice(0, 5).map((event) => <p key={`${event.event}-${event.created_at}`}><span>{event.event} · {event.path}</span><b>{fmtDate(event.created_at)}</b></p>)}
            {!data?.recent.events.length && <div className="admin-empty">No events yet.</div>}
          </article>
        </section>
      </>}

      {view === 'transcripts' && <div className="admin-transcript-stack">
        <section className="admin-metrics admin-transcript-metrics">
          <article className="admin-card"><Archive size={17} /><span>Stored archives</span><strong>{transcriptMonitor?.totals.stored ?? 0}</strong></article>
          <article className="admin-card"><Activity size={17} /><span>Anonymous completions*</span><strong>{transcriptMonitor?.totals.public ?? 0}</strong></article>
          <article className="admin-card"><Gauge size={17} /><span>Average public response</span><strong>{transcriptMonitor?.totals.averagePublicResponseMs == null ? '—' : `${transcriptMonitor.totals.averagePublicResponseMs}ms`}</strong></article>
          <article className="admin-card"><Clock3 size={17} /><span>Last counter update</span><strong className="admin-card-date">{fmtDate(transcriptMonitor?.totals.publicCounterUpdatedAt)}</strong></article>
        </section>
        <p className="admin-monitor-note">* Anonymous requests retain only operational metadata, not transcript text. The aggregate counter has tracked completions since its database migration.</p>

        <section className="admin-panel admin-customers">
          <div className="admin-panel-head"><div><h2>Stored transcript archive</h2><p>All workspace-owned transcripts. Open a row to inspect its saved text.</p></div>
            <label className="admin-search"><Search size={15} /><input value={transcriptQuery} onChange={(event) => setTranscriptQuery(event.target.value)} placeholder="Search title, channel, video or owner" /></label></div>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Video</th><th>Owner</th><th>Source</th><th>Words</th><th>Duration</th><th>Created</th><th>Inspect</th></tr></thead><tbody>
            {visibleStoredTranscripts.map((item) => <tr key={item.id}>
              <td><strong>{item.video_title}</strong><small>{item.video_channel} · {item.video_id}</small></td>
              <td><strong>{item.ownerEmail}</strong><small>{item.ownerPlan}</small></td>
              <td><span className="admin-badge">{item.caption_source.replaceAll('_', ' ')}</span></td>
              <td>{item.word_count.toLocaleString()}</td><td>{item.video_duration}</td><td>{fmtDate(item.created_at)}</td>
              <td><button className="admin-inspect-button" type="button" disabled={transcriptDetailLoading} onClick={() => void openTranscript(item.id)}><Eye size={14} /> View</button></td>
            </tr>)}
            {!visibleStoredTranscripts.length && <tr><td colSpan={7} className="admin-empty">No stored transcripts match this search.</td></tr>}
          </tbody></table></div>
        </section>

        <section className="admin-panel admin-customers">
          <div className="admin-panel-head"><div><h2>Recent public transcript activity</h2><p>Anonymous success and failure events. A visitor token identifies a browser, not a person.</p></div><span className="admin-count">AUTO REFRESH · 15S</span></div>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Status</th><th>Video</th><th>Visitor</th><th>Path</th><th>Time</th></tr></thead><tbody>
            {(transcriptMonitor?.publicEvents || []).map((item, index) => <tr key={`${item.createdAt}-${index}`}>
              <td><span className={`admin-status ${item.status === 'success' ? 'active' : ''}`}>{item.status}</span></td>
              <td>{item.videoId ? <a className="admin-video-link" href={`https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`} target="_blank" rel="noreferrer">{item.videoId}</a> : '—'}</td>
              <td><code>{item.visitor}</code></td><td>{item.path}</td><td>{fmtDate(item.createdAt)}</td>
            </tr>)}
            {!transcriptMonitor?.publicEvents.length && <tr><td colSpan={5} className="admin-empty">No public transcript events yet.</td></tr>}
          </tbody></table></div>
        </section>
      </div>}

      {view === 'users' && <section className="admin-panel admin-customers">
        <div className="admin-panel-head"><div><h2>Workspace allowances</h2><p>{data?.customers.length || 0} workspaces · current UTC billing month</p></div>
          <label className="admin-search"><Search size={15} /><input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Search email, plan or status" /></label></div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Customer</th><th>Plan</th><th>Status</th><th>Caption hours</th><th>AI fallback hours</th><th>Transcripts</th><th>Keys</th><th>Last use</th></tr></thead><tbody>
          {visibleCustomers.map((customer) => <tr key={customer.id}>
            <td><strong>{customer.email}</strong><small>Joined {new Date(customer.createdAt).toLocaleDateString()}</small></td>
            <td><span className="admin-badge">{customer.plan}</span></td>
            <td><span className={`admin-status ${activePaidStatus(customer.subscriptionStatus) ? 'active' : ''}`}>{customer.subscriptionStatus || customer.accessSource || 'manual'}</span></td>
            <td><Meter meter={customer.caption} /></td><td><Meter meter={customer.fallback} /></td>
            <td>{customer.completedTranscripts.toLocaleString()}</td><td>{customer.activeKeys}</td><td>{fmtDate(customer.lastUsedAt)}</td>
          </tr>)}
          {!visibleCustomers.length && <tr><td colSpan={8} className="admin-empty">No matching workspaces.</td></tr>}
        </tbody></table></div>
      </section>}

      {view === 'access' && <section className="admin-panel admin-customers">
        <div className="admin-panel-head"><div><h2>Access requests</h2><p>Approve a request to provision the workspace and email its one-time access key.</p></div><span className="admin-count">{stats.waitlistCount} pending</span></div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Requester</th><th>Company</th><th>Plan</th><th>Status</th><th>Submitted</th><th>Action</th></tr></thead><tbody>
          {(data?.recent.waitlist || []).map((item) => <tr key={item.id}><td><strong>{item.name || item.email}</strong><small>{item.email}</small></td><td>{item.company || '—'}</td><td><span className="admin-badge">{item.plan}</span></td><td><span className={`admin-status ${item.status === 'approved' ? 'active' : ''}`}>{item.status}</span></td><td>{fmtDate(item.created_at)}</td><td><div className="admin-row-actions">
            {item.status === 'pending' && <button disabled={actionId === item.id} onClick={() => void accessAction(item, 'approve')}>Approve</button>}
            {item.status === 'pending' && <button className="danger" disabled={actionId === item.id} onClick={() => void accessAction(item, 'reject')}>Reject</button>}
            {item.approved_user_id && item.status !== 'revoked' && <button className="danger" disabled={actionId === item.id} onClick={() => void accessAction(item, 'revoke')}>Revoke</button>}
          </div></td></tr>)}
          {!data?.recent.waitlist.length && <tr><td colSpan={6} className="admin-empty">No access requests.</td></tr>}
        </tbody></table></div>
      </section>}

      {view === 'jobs' && <div className="admin-overview-grid">
        <article className="admin-panel"><div className="admin-panel-title"><Server size={17} /><h2>Recent batch jobs</h2></div>
          {(data?.recent.jobs || []).slice(0, 15).map((job) => <p key={job.id}><span>{job.completed}/{job.total} complete · {job.failed} failed</span><b>{job.status}</b></p>)}
          {!data?.recent.jobs.length && <div className="admin-empty">No batch jobs.</div>}
        </article>
        <article className="admin-panel"><div className="admin-panel-title"><Archive size={17} /><h2>Webhook delivery</h2></div>
          {(data?.recent.webhookDeliveries || []).slice(0, 15).map((delivery) => <p key={delivery.id}><span>{delivery.event} · {delivery.attempts} attempts</span><b>{delivery.status}</b></p>)}
          {!data?.recent.webhookDeliveries.length && <div className="admin-empty">No webhook deliveries.</div>}
        </article>
        <article className="admin-panel"><div className="admin-panel-title"><CircleDollarSign size={17} /><h2>Polar events</h2></div>
          {(data?.recent.billingEvents || []).slice(0, 15).map((event) => <p key={event.id}><span>{event.event_type}</span><b>{fmtDate(event.processed_at)}</b></p>)}
          {!data?.recent.billingEvents.length && <div className="admin-empty">No Polar webhook events.</div>}
        </article>
        <article className="admin-panel"><div className="admin-panel-title"><Gauge size={17} /><h2>Provider usage / 30d</h2></div>
          {(data?.providerUsage || []).map((item) => <p key={item.provider}><span>{item.provider}</span><b>{item.usedHours.toLocaleString()}h · {item.failures} failed</b></p>)}
          {!data?.providerUsage.length && <div className="admin-empty">No provider usage recorded.</div>}
        </article>
      </div>}

      {view === 'ai' && <div className="admin-ai-stack">
        <section className="admin-provider-grid">
          <article className="admin-panel"><div className="admin-panel-title"><Bot size={17} /><h2>AI summary</h2></div><strong className="admin-provider-model">{operations?.providers.summary.model || 'Not configured'}</strong><p><span>Primary</span><b>{operations?.providers.summary.primary}</b></p><p><span>Available keys</span><b>{operations?.providers.summary.pool.available}</b></p><p><span>Busy / cooldown</span><b>{operations?.providers.summary.pool.busy} / {operations?.providers.summary.pool.coolingDown}</b></p></article>
          <article className="admin-panel"><div className="admin-panel-title"><Server size={17} /><h2>Transcript routing</h2></div><strong className="admin-provider-model">Load-balanced provider pool</strong><p><span>Free dispatch</span><b>{operations?.providers.transcription.free.join(' · ') || 'Not configured'}</b></p><p><span>Paid dispatch</span><b>{operations?.providers.transcription.paid.join(' · ') || 'Not configured'}</b></p>{(operations?.providers.transcription.pool || []).map((item) => <p key={item.provider}><span>{item.provider}</span><b>{item.active} active / {item.concurrency} slots</b></p>)}</article>
        </section>
        <section className="admin-panel admin-provider-health-panel">
          <div className="admin-panel-head"><div><h2>Transcription provider health</h2><p>Control-plane checks for every free-route candidate. This does not claim a completed audio job.</p></div><button type="button" className="admin-health-refresh" onClick={() => void checkProviderHealth()} disabled={healthRefreshing}><Activity size={15} />{healthRefreshing ? 'Checking…' : 'Check now'}</button></div>
          <div className="admin-provider-health-grid">{(operations?.providers.transcription.health || []).map((item) => <article className={`admin-health-card ${item.status}`} key={item.provider}>
            <div className="admin-health-card-head"><div><strong>{providerName(item.provider)}</strong><small>{item.freeRoute ? 'FREE ROUTE' : 'OPTIONAL'}</small></div><span>{healthLabel(item.status)}</span></div>
            <p>{item.detail}</p>
            <div className="admin-health-meta"><span>{item.latencyMs == null ? '—' : `${item.latencyMs}ms`}</span><span>{item.budget.dailyMinutes == null ? 'No daily cap' : `${item.budget.dailyMinutes}m/day`}</span><span>{item.pool ? `${item.pool.active}/${item.pool.concurrency} slots` : 'No pool slot'}</span></div>
          </article>)}</div>
          {!operations?.providers.transcription.health?.length && <div className="admin-empty">Health has not been checked yet.</div>}
        </section>
        <section className="admin-panel admin-credential-panel">
          <div className="admin-panel-head"><div><h2>Provider key control</h2><p>Every new key is tested before encrypted storage and activation.</p></div><KeyRound size={19} /></div>
          <div className="admin-credential-layout"><div className="admin-credential-list">
            {(operations?.providers.transcription.credentials || []).filter((item) => item.provider !== 'worker').map((item) => <div className="admin-credential-row" key={item.provider}>
              <div><strong>{item.provider}</strong><small>{item.configured ? `${item.source} · ${item.fingerprint || 'configured'}` : 'missing'}</small></div>
              <span className={item.configured ? 'ready' : ''}>{item.configured ? 'ACTIVE' : 'OFFLINE'}</span>
              {item.source === 'admin' && <button type="button" title="Remove admin override" onClick={() => void removeCredential(item.provider)}><Trash2 size={14} /></button>}
            </div>)}
          </div><form className="admin-credential-form" onSubmit={saveCredential}>
            <label>Provider<select value={credentialProvider} onChange={(event) => setCredentialProvider(event.target.value)}><option value="groq">Groq</option><option value="cloudflare">Cloudflare</option><option value="deepgram">Deepgram</option><option value="assemblyai">AssemblyAI</option><option value="fireworks">Fireworks</option></select></label>
            {credentialProvider === 'cloudflare' && <label>Account ID<input value={cloudflareAccountId} onChange={(event) => setCloudflareAccountId(event.target.value)} autoComplete="off" placeholder="Cloudflare account ID" /></label>}
            <label>New API key<input type="password" value={credentialKey} onChange={(event) => setCredentialKey(event.target.value)} autoComplete="new-password" placeholder="Paste key" required minLength={12} /></label>
            <button type="submit" disabled={credentialSaving}>{credentialSaving ? 'Testing…' : 'Test, save & activate'}</button>
          </form></div>
        </section>
      </div>}

      {view === 'abuse' && <section className="admin-panel admin-customers"><div className="admin-panel-head"><div><h2>Rate-limit signals</h2><p>Hashed fingerprints from the last 30 days; raw IP addresses are never displayed.</p></div><span className="admin-count">{data?.incidents.length || operations?.flaggedClients.length || 0} flagged</span></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Fingerprint</th><th>Limit hits</th><th>Last route</th><th>Last seen</th></tr></thead><tbody>
        {(data?.incidents.length ? data.incidents : operations?.flaggedClients || []).map((client) => <tr key={client.fingerprint}><td><code>{client.fingerprint}</code></td><td>{client.hits}</td><td>{client.route}</td><td>{fmtDate(client.lastSeenAt)}</td></tr>)}
        {!data?.incidents.length && !operations?.flaggedClients.length && <tr><td colSpan={4} className="admin-empty">No rate-limit incidents.</td></tr>}
      </tbody></table></div></section>}

      {view === 'feedback' && <section className="admin-feedback-list"><div className="admin-section-intro"><div><h2>Feedback inbox</h2><p>Review and archive messages without deleting their history.</p></div><span>{stats.feedbackCount} new</span></div>
        {(data?.recent.feedback || []).map((item) => <article className="admin-feedback" key={item.id}><div><strong>{item.username}</strong><time>{fmtDate(item.created_at)}</time></div><p>{item.message}</p><footer><small>{item.source} · {item.status}</small><div className="admin-row-actions">{item.status === 'new' && <button disabled={actionId === item.id} onClick={() => void updateFeedback(item, 'reviewed')}>Mark reviewed</button>} {item.status !== 'archived' && <button disabled={actionId === item.id} onClick={() => void updateFeedback(item, 'archived')}>Archive</button>}</div></footer></article>)}
        {!data?.recent.feedback.length && <div className="admin-panel admin-empty">No feedback yet.</div>}
      </section>}

      {view === 'audit' && <section className="admin-panel admin-customers"><div className="admin-panel-head"><div><h2>Administrative audit log</h2><p>Credential, access, feedback and site-mode changes.</p></div><span className="admin-count">{data?.recent.audit.length || 0} events</span></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Actor</th><th>Action</th><th>Target</th><th>Time</th></tr></thead><tbody>
        {(data?.recent.audit || []).map((item) => <tr key={item.id}><td>{item.actor_email || 'system'}</td><td><strong>{item.action.replaceAll('_', ' ')}</strong></td><td>{item.target_type}{item.target_id ? ` · ${item.target_id}` : ''}</td><td>{fmtDate(item.created_at)}</td></tr>)}
        {!data?.recent.audit.length && <tr><td colSpan={4} className="admin-empty">No audited actions yet.</td></tr>}
      </tbody></table></div></section>}
    </section>
    {selectedTranscript && <div className="admin-transcript-modal" role="dialog" aria-modal="true" aria-label="Stored transcript detail" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedTranscript(null) }}>
      <article>
        <header><div><span>STORED TRANSCRIPT</span><h2>{selectedTranscript.video_title}</h2><p>{selectedTranscript.video_channel} · {selectedTranscript.ownerEmail} · {fmtDate(selectedTranscript.created_at)}</p></div><button type="button" aria-label="Close" onClick={() => setSelectedTranscript(null)}><X size={18} /></button></header>
        <div className="admin-transcript-detail-meta"><span>{selectedTranscript.video_duration}</span><span>{selectedTranscript.word_count.toLocaleString()} words</span><span>{selectedTranscript.caption_source.replaceAll('_', ' ')}</span></div>
        <div className="admin-transcript-lines">{selectedTranscript.lines.map((line, index) => <p key={`${line.start || 0}-${index}`}><time>{formatTranscriptTime(line.start)}</time><span>{line.text}</span></p>)}</div>
      </article>
    </div>}
  </main>
}

function Meter({ meter }: { meter: HourMeter }) {
  return <div className="admin-meter"><div><b>{fmtHours(meter.usedHours)}</b><span>/ {fmtHours(meter.limitHours)}</span></div><small>{fmtHours(meter.remainingHours)} left</small><div className="admin-usage-track"><i style={{ width: `${Math.min(meter.percentage, 100)}%` }} /></div></div>
}

function activePaidStatus(value: unknown) {
  return ['active', 'trialing'].includes(String(value || '').toLowerCase())
}

function formatTranscriptTime(seconds = 0) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0))
  const minutes = Math.floor(whole / 60)
  const remainder = whole % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}
