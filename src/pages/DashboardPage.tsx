import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTime } from '../lib/formatTime'
import {
  Activity,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  Clipboard,
  Download,
  FileText,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListVideo,
  LogOut,
  Moon,
  Plus,
  Radio,
  RotateCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  UploadCloud,
  Users,
  X,
} from 'lucide-react'
import { PLANS } from '../lib/plans'
import type { PlanKey } from '../lib/plans'
import type { SiteLocale } from '../hooks/useLocale'
import type { Theme } from '../hooks/useTheme'
import { SecondaryPageShell } from '../components/SecondaryPageShell'
import { DashboardLoginGate, DashboardSetupGate } from '../components/dashboard/DashboardAuth'
import '../styles/dashboard.css'
import './DashboardLogin.css'
import '../styles/dashboardProduct.css'

type ApiKey = {
  id: string
  name: string
  expires_at: string | null
  last_used_at: string | null
  created_at: string
  active: boolean
}

type UsageLog = {
  created_at: string
  status: string
  endpoint: string
  video_id: string | null
}

type HourMeter = {
  usedSeconds: number
  usedHours: number
  limitSeconds: number | null
  limitHours: number | null
  remainingSeconds: number | null
  remainingHours: number | null
  remainingPercentage: number
}

type UsageData = {
  email?: string
  username?: string
  role?: 'admin' | 'teammate'
  plan: string
  completedTranscripts: number
  resetAt: string
  captionHours?: HourMeter
  aiFallbackHours?: HourMeter
  dailyUsage: Record<string, number>
  recentLogs?: UsageLog[]
  accessSource?: string
  betaExpiresAt?: string | null
  betaExpired?: boolean
  subscriptionStatus?: string | null
}

type TranscriptRecord = {
  id: string
  video_id: string
  video_title: string
  video_channel: string
  video_duration: string
  video_thumbnail: string
  word_count: number
  created_at: string
}

type TranscriptDetail = TranscriptRecord & {
  lines: Array<{ text: string; start: number; duration: number }>
  ai_summary?: { title?: string; summary?: string; tags?: string[] } | null
}

type Webhook = {
  id: string
  url: string
  events: string[]
  active: boolean
}

type Channel = {
  id: string
  channel_id: string
  channel_name: string
  last_synced_at: string | null
  active: boolean
  created_at: string
  schedule_frequency: 'every_15_minutes' | 'hourly' | 'daily'
  schedule_time: string
  timezone: string
  auto_summary: boolean
  ai_fallback: boolean
  backfill_limit: number
  paused: boolean
  next_run_at: string | null
  last_run_started_at: string | null
  last_run_completed_at: string | null
  last_run_status: string
  last_run_error: string | null
  last_run_processed: number
  last_run_failed: number
}

type BatchJob = {
  id: string
  total: number
  completed: number
  failed: number
  status: string
  created_at?: string
  completed_at?: string | null
}

type BatchResultItem = {
  id: string
  url: string
  status: string
  transcript_id: string | null
  error: string | null
  transcript: TranscriptRecord | null
}

type BatchResultView = {
  job: BatchJob
  items: BatchResultItem[]
  total: number
}

type SourceInspection = {
  type: 'video' | 'playlist' | 'channel' | 'bulk'
  title: string
  videoCount: number
  totalSeconds: number
  estimatedWords: number
  estimatedSegments: number
  estimatedMinutes: number
  thumbnailUrl?: string
  truncated: boolean
  breakdown?: { videos: number; shorts: number; live: number }
  captionSampleSize?: number
  captionedSampleCount?: number
  fallbackSampleCount?: number
  estimatedCaptionedVideos?: number
  estimatedAiFallbackVideos?: number
  captionEstimateExact?: boolean
  captionedContentMinutes?: number
  aiFallbackContentMinutes?: number
  estimatedCaptionProcessingMinutes?: number
  estimatedAiFallbackProcessingMinutes?: number
  processingConcurrency?: number
}

type TeamMember = {
  id: string
  username: string
  email: string
  role: 'admin' | 'teammate'
  active: boolean
  last_login_at: string | null
  created_at: string
}

type View = 'overview' | 'usage' | 'archive' | 'keys' | 'webhooks' | 'channels' | 'transcribe' | 'team' | 'settings'
type TranscriptExportFormat = 'json' | 'txt' | 'srt' | 'vtt' | 'pdf' | 'docx'
type SettingsSection = 'account' | 'language' | 'output' | 'developer' | 'billing'
type DashboardTheme = 'dark' | 'light'

const dashboardLocaleOptions: Array<{ value: SiteLocale; code: string; label: string }> = [
  { value: 'en', code: 'EN', label: 'English' },
  { value: 'zh', code: '中文', label: '简体中文' },
  { value: 'tr', code: 'TR', label: 'Türkçe' },
  { value: 'es', code: 'ES', label: 'Español' },
]

type DashboardPreferences = {
  defaultExport: TranscriptExportFormat
  includeTimestamps: boolean
  compactLibrary: boolean
}

const DASHBOARD_PREFERENCES_KEY = 'easytran-dashboard-preferences'
const DASHBOARD_THEME_KEY = 'easytran-dashboard-theme'
const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const automationTimezones = [...new Set([localTimezone, 'UTC', 'Europe/Istanbul', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'])]
const defaultDashboardPreferences: DashboardPreferences = {
  defaultExport: 'txt',
  includeTimestamps: true,
  compactLibrary: false,
}

const formatAnalysisMinutes = (minutes?: number) => {
  if (minutes === undefined) return '—'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

const formatBatchResultError = (error?: string | null) => {
  if (!error) return 'Transcript was not saved.'
  const knownErrors: Record<string, string> = {
    worker_timeout_after_3_attempts: 'Worker timed out after 3 attempts.',
    worker_restarted: 'Worker restarted before this video completed.',
    quota_exceeded: 'Workspace hours were exhausted.',
    caption_hours_exceeded: 'Caption hours were exhausted.',
    ai_fallback_hours_exceeded: 'AI fallback hours were exhausted.',
    invalid_url: 'The video URL was invalid.',
  }
  if (knownErrors[error]) return knownErrors[error]
  const readable = error.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
  return readable.endsWith('.') ? readable : `${readable}.`
}

function getSavedDashboardPreferences(): DashboardPreferences {
  try {
    const saved = window.localStorage.getItem(DASHBOARD_PREFERENCES_KEY)
    return saved ? { ...defaultDashboardPreferences, ...JSON.parse(saved) } : defaultDashboardPreferences
  } catch {
    return defaultDashboardPreferences
  }
}

function getSavedDashboardTheme(): DashboardTheme {
  try {
    const saved = window.localStorage.getItem(DASHBOARD_THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function relativeTime(value: string): string {
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Math.max(0, Date.now() - then)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return 'just now'
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`
  if (diff < day) return `${Math.floor(diff / hour)}h ago`
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`
  return new Date(value).toLocaleDateString()
}


function CodeBlock() {
  const [copied, setCopied] = useState(false)
  const command = `curl -X POST https://easytran.app/v1/transcripts \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ"}'`

  const copy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="lang"><span className="dots"><span /><span /><span /></span>terminal</span>
        <button className="icon-btn" type="button" title="Copy" onClick={copy}><Clipboard size={14} /> {copied ? 'Copied' : ''}</button>
      </div>
      <pre><code>{command}</code></pre>
    </div>
  )
}

export function DashboardPage({
  locale,
  onLocaleChange,
  appearance = 'dark',
}: {
  locale: SiteLocale
  onLocaleChange: (locale: SiteLocale) => void
  appearance?: Theme
}) {
  const [dashboardNow] = useState(() => Date.now())
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [archive, setArchive] = useState<TranscriptRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(false)
  const [onboardingRequired, setOnboardingRequired] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [featureErrors, setFeatureErrors] = useState<Record<string, string>>({})
  const [view, setView] = useState<View>('overview')
  const [keyModalOpen, setKeyModalOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyExpiryDays, setNewKeyExpiryDays] = useState('90')
  const [keyModalError, setKeyModalError] = useState('')
  const [creatingKey, setCreatingKey] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newWebhookUrl, setNewWebhookUrl] = useState('')
  const [newWebhookSecret, setNewWebhookSecret] = useState('')
  const [copied, setCopied] = useState(false)
  const [transcribeUrl, setTranscribeUrl] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeResult, setTranscribeResult] = useState<TranscriptRecord | null>(null)
  const [batchInput, setBatchInput] = useState('')
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null)
  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([])
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [batchResultView, setBatchResultView] = useState<BatchResultView | null>(null)
  const [batchResultsLoading, setBatchResultsLoading] = useState(false)
  const [channelUrl, setChannelUrl] = useState('')
  const [channelFrequency, setChannelFrequency] = useState<Channel['schedule_frequency']>('daily')
  const [channelTime, setChannelTime] = useState('09:00')
  const [channelTimezone, setChannelTimezone] = useState(localTimezone)
  const [channelAutoSummary, setChannelAutoSummary] = useState(true)
  const [channelAiFallback, setChannelAiFallback] = useState(true)
  const [channelBackfill, setChannelBackfill] = useState(0)
  const [channelSavingId, setChannelSavingId] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [archiveQuery, setArchiveQuery] = useState('')
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [selectedTranscript, setSelectedTranscript] = useState<TranscriptDetail | null>(null)
  const [visibleTranscriptLineCount, setVisibleTranscriptLineCount] = useState(250)
  const [exportFormat, setExportFormat] = useState<TranscriptExportFormat>(() => getSavedDashboardPreferences().defaultExport)
  const [sourceInput, setSourceInput] = useState('')
  const [sourceInspection, setSourceInspection] = useState<SourceInspection | null>(null)
  const [sourceInspecting, setSourceInspecting] = useState(false)
  const [sourceInspectProgress, setSourceInspectProgress] = useState(0)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [teamUsername, setTeamUsername] = useState('')
  const [teamEmail, setTeamEmail] = useState('')
  const [teamRole, setTeamRole] = useState<'admin' | 'teammate'>('teammate')
  const [teamSection, setTeamSection] = useState<'invite' | 'members'>('invite')
  const [issuedTeamKey, setIssuedTeamKey] = useState('')
  const [preferences, setPreferences] = useState<DashboardPreferences>(() => getSavedDashboardPreferences())
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account')
  const [dashboardTheme, setDashboardTheme] = useState<DashboardTheme>(getSavedDashboardTheme)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const [profilePhoto, setProfilePhoto] = useState(() => {
    try { return window.localStorage.getItem('easytran-dashboard-profile-photo') || '' } catch { return '' }
  })

  const planKey = (usage?.plan && usage.plan in PLANS ? usage.plan : 'free') as PlanKey
  const plan = PLANS[planKey]
  const isBusiness = planKey === 'business' || planKey === 'custom'
  const hasApi = plan.apiAccess
  const emptyHourMeter: HourMeter = {
    usedSeconds: 0,
    usedHours: 0,
    limitSeconds: null,
    limitHours: null,
    remainingSeconds: null,
    remainingHours: null,
    remainingPercentage: 100,
  }
  const captionHours = usage?.captionHours ?? emptyHourMeter
  const aiFallbackHours = usage?.aiFallbackHours ?? emptyHourMeter
  const remainingPercentage = Math.min(captionHours.remainingPercentage, aiFallbackHours.remainingPercentage)
  const formatHours = (value: number | null) => value === null
    ? 'Unlimited'
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`

  const nav = useMemo(() => [
    { id: 'overview' as const, icon: LayoutDashboard, label: 'Home', visible: true },
    { id: 'usage' as const, icon: Activity, label: 'Usage', visible: true, tail: `${remainingPercentage}%` },
    { id: 'archive' as const, icon: FileText, label: 'Library', visible: isBusiness, tail: archive.length ? String(archive.length) : undefined },
    { id: 'keys' as const, icon: KeyRound, label: 'API Keys', visible: hasApi, tail: keys.length ? String(keys.length) : undefined },
    { id: 'webhooks' as const, icon: Link2, label: 'Webhooks', visible: hasApi, tail: webhooks.length ? String(webhooks.length) : undefined },
    { id: 'channels' as const, icon: CalendarClock, label: 'Automations', visible: isBusiness },
    { id: 'team' as const, icon: Users, label: 'Team', visible: isBusiness && usage?.role === 'admin', tail: team.length ? String(team.length) : undefined },
    { id: 'settings' as const, icon: Settings, label: 'Settings', visible: true },
  ], [archive.length, hasApi, isBusiness, keys.length, remainingPercentage, team.length, usage?.role, webhooks.length])

  const loadAll = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const sessionRes = await fetch('/api/auth/session')
      if (sessionRes.status === 401) {
        setAuthError(true)
        return
      }
      if (!sessionRes.ok) {
        setLoadError('Dashboard access is temporarily unavailable.')
        return
      }
      const session = await sessionRes.json()
      if (session.onboardingRequired) {
        setOnboardingRequired(true)
        return
      }
      setOnboardingRequired(false)
      const [keysRes, usageRes, webhooksRes, channelsRes, archiveRes, batchesRes, teamRes] = await Promise.all([
        fetch('/api/dashboard/keys'),
        fetch('/api/dashboard/usage'),
        fetch('/api/dashboard/webhooks'),
        fetch('/api/dashboard/channels'),
        fetch('/api/dashboard/transcripts'),
        fetch('/api/dashboard/batches'),
        fetch('/api/dashboard/team'),
      ])

      if (keysRes.status === 401 || usageRes.status === 401) {
        setAuthError(true)
        return
      }

      if (!usageRes.ok) {
        setLoadError('Dashboard data is temporarily unavailable. Please try again shortly.')
        return
      }

      const nextFeatureErrors: Record<string, string> = {}
      if (!channelsRes.ok) nextFeatureErrors.channels = 'Automations are unavailable until the channel database migration is applied.'
      if (!teamRes.ok) nextFeatureErrors.team = 'Team access is unavailable until the workspace member database migration is applied.'
      if (!keysRes.ok) nextFeatureErrors.keys = 'API keys could not be loaded.'
      if (!webhooksRes.ok) nextFeatureErrors.webhooks = 'Webhooks could not be loaded.'
      if (!archiveRes.ok) nextFeatureErrors.archive = 'Transcript archives could not be loaded.'
      if (!batchesRes.ok) nextFeatureErrors.batches = 'Recent jobs could not be loaded.'
      setFeatureErrors(nextFeatureErrors)

      setKeys(keysRes.ok ? await keysRes.json() : [])
      setUsage(usageRes.ok ? await usageRes.json() : null)
      setWebhooks(webhooksRes.ok ? await webhooksRes.json() : [])
      setChannels(channelsRes.ok ? await channelsRes.json() : [])
      setArchive(archiveRes.ok ? await archiveRes.json() : [])
      setBatchJobs(batchesRes.ok ? await batchesRes.json() : [])
      setTeam(teamRes.ok ? await teamRes.json() : [])
    } catch {
      setAuthError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void Promise.resolve().then(loadAll)
  }, [])

  useEffect(() => {
    try { window.localStorage.setItem(DASHBOARD_THEME_KEY, dashboardTheme) } catch { /* storage is optional */ }
  }, [dashboardTheme])

  useEffect(() => {
    if (!profileMenuOpen) return
    const closeProfileMenu = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeProfileMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeProfileMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [profileMenuOpen])

  useEffect(() => {
    const hasActiveJobs = batchJobs.some((job) => !['completed', 'failed', 'cancelled'].includes(job.status))
    if (!hasActiveJobs) return
    const refreshJobs = () => {
      Promise.all([
        fetch('/api/dashboard/batches'),
        fetch('/api/dashboard/transcripts'),
      ])
        .then(async ([jobsResponse, archiveResponse]) => ({
          jobs: jobsResponse.ok ? await jobsResponse.json() as BatchJob[] : [],
          archive: archiveResponse.ok ? await archiveResponse.json() as TranscriptRecord[] : null,
        }))
        .then(({ jobs, archive: refreshedArchive }) => {
          setBatchJobs(jobs)
          setBatchJob((current) => current ? jobs.find((job) => job.id === current.id) || current : current)
          if (refreshedArchive) setArchive(refreshedArchive)
        })
        .catch(() => undefined)
    }
    const timer = window.setInterval(refreshJobs, 3000)
    return () => window.clearInterval(timer)
  }, [batchJobs])

  const createKey = async () => {
    setCreatingKey(true)
    setKeyModalError('')
    try {
      const response = await fetch('/api/dashboard/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim(),
          expiresAt: new Date(Date.now() + Number(newKeyExpiryDays) * 86_400_000).toISOString(),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setKeyModalError(payload.message || 'API key could not be created.')
        return
      }
      setNewKey(payload.key || '')
      setNewKeyName('')
      setNewKeyExpiryDays('90')
      setKeyModalOpen(false)
      await loadAll()
    } catch {
      setKeyModalError('API key service is temporarily unavailable.')
    } finally {
      setCreatingKey(false)
    }
  }

  const deleteKey = async (id: string) => {
    await fetch(`/api/dashboard/keys/${id}`, { method: 'DELETE' })
    await loadAll()
  }

  const addWebhook = async () => {
    if (!newWebhookUrl.trim()) return
    const response = await fetch('/api/dashboard/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: newWebhookUrl, events: ['transcript.completed', 'batch.completed'] }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      setActionMessage(payload.error === 'valid_public_https_url_required'
        ? 'Enter a public HTTPS endpoint. Local and private network addresses are blocked.'
        : payload.error === 'webhook_limit_reached'
          ? `This workspace can use up to ${payload.max ?? plan.maxWebhooks} webhooks.`
          : 'Webhook could not be created.')
      return
    }
    setNewWebhookSecret(payload.secret || '')
    setNewWebhookUrl('')
    await loadAll()
  }

  const deleteWebhook = async (id: string) => {
    await fetch(`/api/dashboard/webhooks/${id}`, { method: 'DELETE' })
    await loadAll()
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.assign('/')
  }

  const openBillingPortal = async () => {
    setActionMessage('Opening secure billing portal...')
    const response = await fetch('/api/billing/portal', { method: 'POST' })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.url) {
      setActionMessage(payload.message || 'Billing portal is temporarily unavailable.')
      return
    }
    window.location.assign(payload.url)
  }

  const copyKey = async () => {
    await navigator.clipboard.writeText(newKey)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const updateProfilePhoto = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 2_000_000) {
      setActionMessage('Choose a JPG, PNG, or WebP image smaller than 2 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : ''
      setProfilePhoto(value)
      try { window.localStorage.setItem('easytran-dashboard-profile-photo', value) } catch { /* optional */ }
    }
    reader.readAsDataURL(file)
  }

  const transcribeVideo = async () => {
    if (!transcribeUrl.trim()) return
    setTranscribing(true)
    setActionMessage('')
    try {
      const response = await fetch('/api/dashboard/transcripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: transcribeUrl.trim() }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || payload.error || 'Transcript failed.')
      setTranscribeResult({
        id: payload.id,
        video_id: payload.video.videoId,
        video_title: payload.video.title,
        video_channel: payload.video.channel,
        video_duration: payload.video.duration,
        video_thumbnail: payload.video.thumbnail,
        word_count: payload.wordCount,
        created_at: new Date().toISOString(),
      })
      setTranscribeUrl('')
      setActionMessage('Transcript completed and saved.')
      await loadAll()
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Transcript failed.')
    } finally {
      setTranscribing(false)
    }
  }

  const queueBatch = async () => {
    const urls = batchInput.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)
    if (!urls.length) return
    setBatchSubmitting(true)
    setActionMessage('')
    const response = await fetch('/api/dashboard/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      setActionMessage(payload.error || 'Batch could not be queued.')
    } else {
      setBatchJob({ id: payload.batch_id, total: payload.total, completed: 0, failed: 0, status: payload.status })
      setBatchJobs((jobs) => [{ id: payload.batch_id, total: payload.total, completed: 0, failed: 0, status: payload.status }, ...jobs])
      setBatchInput('')
    }
    setBatchSubmitting(false)
  }

  const addChannel = async () => {
    if (!channelUrl.trim()) return
    setActionMessage('')
    const response = await fetch('/api/dashboard/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelUrl: channelUrl.trim(),
        settings: {
          schedule_frequency: channelFrequency,
          schedule_time: channelTime,
          timezone: channelTimezone,
          auto_summary: channelAutoSummary,
          ai_fallback: channelAiFallback,
          backfill_limit: channelBackfill,
        },
      }),
    })
    const payload = await response.json()
    if (!response.ok) {
      setActionMessage(payload.message || payload.error || 'Channel could not be added.')
      return
    }
    setChannelUrl('')
    setActionMessage('Channel added. New uploads will be picked up by scheduled sync.')
    await loadAll()
  }

  const updateChannel = async (channel: Channel, updates: Partial<Channel>) => {
    setChannelSavingId(channel.id)
    setActionMessage('')
    const response = await fetch(`/api/dashboard/channels/${channel.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      setActionMessage(payload.error || 'Automation settings could not be saved.')
    } else {
      setChannels((items) => items.map((item) => item.id === channel.id ? payload : item))
    }
    setChannelSavingId('')
  }

  const runChannelNow = async (channel: Channel) => {
    setChannelSavingId(channel.id)
    setActionMessage('')
    const response = await fetch(`/api/dashboard/channels/${channel.id}/run`, { method: 'POST' })
    const payload = await response.json().catch(() => ({}))
    setActionMessage(response.ok
      ? `${channel.channel_name} sync started. This page will show the result after the worker finishes.`
      : payload.error || 'Channel sync could not be started.')
    setChannelSavingId('')
    if (response.ok) window.setTimeout(() => { void loadAll() }, 1800)
  }

  const deleteChannel = async (id: string) => {
    await fetch(`/api/dashboard/channels/${id}`, { method: 'DELETE' })
    await loadAll()
  }

  const searchArchive = async () => {
    setArchiveLoading(true)
    setSelectedTranscript(null)
    try {
      const response = await fetch(`/api/dashboard/transcripts?q=${encodeURIComponent(archiveQuery.trim())}`)
      const payload = await response.json()
      setArchive(response.ok ? payload : [])
      if (!response.ok) setActionMessage(payload.error || 'Archive search failed.')
    } finally {
      setArchiveLoading(false)
    }
  }

  const openTranscript = async (id: string) => {
    setArchiveLoading(true)
    try {
      const response = await fetch(`/api/dashboard/transcripts/${encodeURIComponent(id)}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Transcript could not be opened.')
      setVisibleTranscriptLineCount(250)
      setSelectedTranscript(payload)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Transcript could not be opened.')
    } finally {
      setArchiveLoading(false)
    }
  }

  const loadBatchResults = async (job: BatchJob, append = false) => {
    setBatchResultsLoading(true)
    setActionMessage('')
    try {
      const offset = append ? batchResultView?.items.length ?? 0 : 0
      const response = await fetch(`/api/dashboard/batches/${encodeURIComponent(job.id)}/results?limit=100&offset=${offset}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Job results could not be opened.')
      const items = Array.isArray(payload.items) ? payload.items as BatchResultItem[] : []
      setBatchResultView((current) => ({
        job,
        items: append && current?.job.id === job.id ? [...current.items, ...items] : items,
        total: Number(payload.total || items.length),
      }))
      setSelectedTranscript(null)
      setView('archive')
      if (!append && items.length === 1 && items[0].transcript_id) {
        await openTranscript(items[0].transcript_id)
      }
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Job results could not be opened.')
    } finally {
      setBatchResultsLoading(false)
    }
  }

  const transcriptText = selectedTranscript?.lines
    .map((line) => preferences.includeTimestamps ? `[${formatTime(line.start)}] ${line.text}` : line.text)
    .join('\n') ?? ''

  const copyArchivedTranscript = async () => {
    await navigator.clipboard.writeText(transcriptText)
    setActionMessage('Transcript copied.')
  }

  const selectView = (nextView: View) => {
    setActionMessage('')
    setView(nextView)
  }

  const sourceLines = sourceInput.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)

  const inspectSource = async () => {
    if (!sourceLines.length || sourceInspecting) return
    setSourceInspecting(true)
    setSourceInspectProgress(4)
    setActionMessage('')
    const progressTimer = window.setInterval(() => {
      setSourceInspectProgress((current) => {
        if (current >= 94) return current
        const increment = current < 30 ? 7 : current < 72 ? 4 : 1
        return Math.min(94, current + increment)
      })
    }, 420)
    try {
      const response = await fetch('/api/dashboard/sources/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: sourceInput }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || payload.error || 'Source inspection failed.')
      setSourceInspectProgress(100)
      setSourceInspection(payload)
    } catch (error) {
      setSourceInspection(null)
      setSourceInspectProgress(0)
      setActionMessage(error instanceof Error ? error.message : 'Source inspection failed.')
    } finally {
      window.clearInterval(progressTimer)
      setSourceInspecting(false)
    }
  }

  const queueSource = async () => {
    if (!sourceInspection || batchSubmitting) return
    setBatchSubmitting(true)
    setActionMessage('')
    try {
      const response = await fetch('/api/dashboard/sources/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: sourceInput }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || payload.error || 'Source could not be queued.')
      const job = { id: payload.batch_id, total: payload.total, completed: 0, failed: 0, status: payload.status }
      setBatchJob(job)
      setBatchJobs((jobs) => [job, ...jobs])
      setBatchInput(sourceInput)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Source could not be queued.')
    } finally {
      setBatchSubmitting(false)
    }
  }

  const createTeamMember = async () => {
    if (!teamUsername.trim() || !teamEmail.trim()) return
    setActionMessage('')
    const response = await fetch('/api/dashboard/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: teamUsername, email: teamEmail, role: teamRole }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      setActionMessage(payload.message || payload.error || 'Member could not be created.')
      return
    }
    setIssuedTeamKey(payload.key)
    setTeamUsername('')
    setTeamEmail('')
    await loadAll()
  }

  const updateTeamMember = async (member: TeamMember, updates: { role?: 'admin' | 'teammate'; active?: boolean }) => {
    setActionMessage('')
    const response = await fetch(`/api/dashboard/team/${encodeURIComponent(member.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: updates.role ?? member.role, active: updates.active ?? member.active }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      setActionMessage(payload.error || 'Member could not be updated.')
      return
    }
    await loadAll()
  }

  const rotateTeamKey = async (member: TeamMember) => {
    const response = await fetch(`/api/dashboard/team/${encodeURIComponent(member.id)}/rotate-key`, { method: 'POST' })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      setActionMessage(payload.error || 'Key could not be rotated.')
      return
    }
    setIssuedTeamKey(payload.key)
  }

  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'login') return <DashboardLoginGate locale={locale} onLocaleChange={onLocaleChange} appearance={appearance} />

  if (authError) return <DashboardLoginGate locale={locale} onLocaleChange={onLocaleChange} appearance={appearance} />

  if (onboardingRequired) return <DashboardSetupGate locale={locale} onLocaleChange={onLocaleChange} appearance={appearance} />

  if (loading) {
    return (
      <SecondaryPageShell context="dashboard" appearance={appearance} locale={locale} onLocaleChange={onLocaleChange} className="dashboard-shell">
        <div className="secondary-state" role="status">Loading dashboard…</div>
      </SecondaryPageShell>
    )
  }


  if (loadError) {
    return (
      <SecondaryPageShell context="dashboard" appearance={appearance} locale={locale} onLocaleChange={onLocaleChange} className="dashboard-shell">
        <div className="secondary-state">
          <span className="dash-logo">EasyTran</span>
          <h1>Dashboard unavailable</h1>
          <p>{loadError}</p>
          <button className="page-action" type="button" onClick={loadAll}>Try again</button>
        </div>
      </SecondaryPageShell>
    )
  }

  const accountName = usage?.username || (usage?.email ? usage.email.split('@')[0] : 'there')
  const greetingName = accountName.toLowerCase() === 'developer' ? 'John Doe' : accountName
  const updatePreference = <Key extends keyof DashboardPreferences>(key: Key, value: DashboardPreferences[Key]) => {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    if (key === 'defaultExport') setExportFormat(value as TranscriptExportFormat)
    try { window.localStorage.setItem(DASHBOARD_PREFERENCES_KEY, JSON.stringify(next)) } catch { /* storage is optional */ }
  }

  return (
    <SecondaryPageShell context="dashboard" appearance={dashboardTheme} locale={locale} onLocaleChange={onLocaleChange} className={`dashboard-shell dashboard-glass dashboard-theme-${dashboardTheme}`}>
      <section className="dash">
        <aside className="sidebar">
          <div className="dashboard-glow-brand" aria-label="EasyTran">
            <span className="dashboard-brand-mark" aria-hidden="true" />
            <strong>EasyTran</strong>
          </div>

          <button className="dashboard-new-task" type="button" onClick={() => {
            setSourceInspection(null)
            setSourceInspectProgress(0)
            setBatchResultView(null)
            setSelectedTranscript(null)
            selectView('overview')
          }}>
            <Plus size={16} />
            New transcript
          </button>

          <button className="dashboard-history-search" type="button" onClick={() => selectView('archive')}>
            <Search size={15} />
            Search
          </button>

          <nav className="dashboard-section-nav" aria-label="Workspace navigation">
            {nav.filter(item => item.visible).map(item => <button type="button" key={item.id}
              className={view === item.id ? 'is-active' : ''} aria-current={view === item.id ? 'page' : undefined}
              onClick={() => selectView(item.id)}><item.icon size={15} /><span>{item.label}</span></button>)}
          </nav>

          <nav className="dashboard-task-history" aria-label="Recent transcripts">
            <span className="dashboard-task-history-label">Recent</span>
            {archive.slice(0, 14).map((transcript) => (
              <button
                key={transcript.id}
                className={selectedTranscript?.id === transcript.id ? 'is-active' : ''}
                type="button"
                onClick={() => {
                  setBatchResultView(null)
                  selectView('archive')
                  void openTranscript(transcript.id)
                }}
                title={transcript.video_title}
                data-no-translate
              >
                <span>{transcript.video_title}</span>
                <small>{relativeTime(transcript.created_at)}</small>
              </button>
            ))}
            {!archive.length && <p>No transcripts yet</p>}
          </nav>

          <div className="dashboard-sidebar-spacer" />

          {usage && (
            <div className="dashboard-profile-menu-wrap" ref={profileMenuRef}>
              {profileMenuOpen && (
                <div className="dashboard-profile-menu" role="menu">
                  <div className="dashboard-profile-menu-account">
                    <strong data-no-translate>{greetingName}</strong>
                    <span>{usage.email}</span>
                  </div>
                  <nav aria-label="Workspace sections">
                    {nav.filter((item) => item.visible && item.id !== 'overview').map((item) => (
                      <button key={item.id} className={view === item.id ? 'is-active' : ''} type="button" role="menuitem" onClick={() => {
                        selectView(item.id)
                        setProfileMenuOpen(false)
                      }}>
                        <item.icon size={15} />
                        <span>{item.label}</span>
                        {item.tail && <small>{item.tail}</small>}
                      </button>
                    ))}
                  </nav>
                  <div className="dashboard-theme-picker" aria-label="Dashboard theme">
                    <button className={dashboardTheme === 'light' ? 'is-active' : ''} type="button" onClick={() => setDashboardTheme('light')}><Sun size={14} /> Light</button>
                    <button className={dashboardTheme === 'dark' ? 'is-active' : ''} type="button" onClick={() => setDashboardTheme('dark')}><Moon size={14} /> Dark</button>
                  </div>
                  <button className="dashboard-profile-sign-out" type="button" role="menuitem" onClick={logout}><LogOut size={15} /> Sign out</button>
                </div>
              )}
              <button
                className={`dashboard-sidebar-profile is-${usage.role || 'teammate'}`}
                type="button"
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                onClick={() => setProfileMenuOpen((open) => !open)}
              >
                <span className="dashboard-sidebar-avatar" aria-hidden="true">
                  {profilePhoto
                    ? <img src={profilePhoto} alt="" />
                    : greetingName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <strong data-no-translate>{greetingName}</strong>
                <ChevronDown size={14} />
              </button>
            </div>
          )}
        </aside>

        <section className="dash-main">
          {view === 'overview' && usage && !isBusiness && (
            <article className="usage-workspace developer-home">
              <header className="usage-workspace-head">
                <span>DEVELOPER WORKSPACE</span>
                <h1>Hours at a glance</h1>
                <p>Caption and AI fallback time are metered separately.</p>
              </header>
              <div className="usage-hour-grid">
                {([['Caption video', captionHours], ['AI fallback', aiFallbackHours]] as const).map(([label, meter]) => (
                  <section className="usage-meter-card usage-hour-card" key={label}>
                    <div className="usage-meter-primary"><span>{label} remaining</span><strong>{formatHours(meter.remainingHours)}</strong><small>{formatHours(meter.usedHours)} of {formatHours(meter.limitHours)} used</small></div>
                    <div className="usage-meter-percent">{meter.remainingPercentage}% remaining</div>
                    <div className="usage-meter-track" aria-label={`${meter.remainingPercentage}% of ${label} allowance remaining`}><i style={{ width: `${meter.remainingPercentage}%` }} /></div>
                  </section>
                ))}
              </div>
              <div className="developer-home-actions">
                <button className="qa-card" type="button" onClick={() => selectView('keys')}><span className="ico"><KeyRound size={18} /></span><span><strong>API keys</strong><span>{keys.length} active</span></span><ArrowRight size={16} /></button>
                <button className="qa-card" type="button" onClick={() => selectView('webhooks')}><span className="ico"><Link2 size={18} /></span><span><strong>Webhooks</strong><span>{webhooks.length} of {plan.maxWebhooks}</span></span><ArrowRight size={16} /></button>
                <a className="qa-card" href="/docs"><span className="ico"><FileText size={18} /></span><span><strong>API docs</strong><span>Endpoints and examples</span></span><ArrowRight size={16} /></a>
              </div>
            </article>
          )}

          {view === 'overview' && usage && isBusiness && (
            <div className={`dashboard-home-stack dashboard-home-bento ${sourceInspection ? 'has-report' : ''}`}>
              {!sourceInspection && (
                <header className="dashboard-home-intro">
                  <span>Workspace</span>
                  <h1>New transcript</h1>
                </header>
              )}

              <section className="source-workbench source-workbench-home dashboard-source-focus">
                {!sourceInspection && (
                  <>
                    <header className="dashboard-source-card-head">
                      <span>Source</span>
                      <div aria-label="Supported source types">
                        <span>Video</span>
                        <span>Playlist</span>
                        <span>Channel</span>
                      </div>
                    </header>
                    <div className="dashboard-url-focus">
                      <textarea
                        value={sourceInput}
                        onChange={(event) => {
                          setSourceInput(event.target.value)
                          setSourceInspection(null)
                          setSourceInspectProgress(0)
                          setActionMessage('')
                        }}
                        placeholder={'Paste a URL\n—or paste one video URL per line'}
                        rows={4}
                        aria-label="Video, channel, playlist or bulk URLs"
                      />
                    </div>
                    {sourceInspecting ? (
                      <div className="source-analysis-progress" role="status" aria-live="polite">
                        <div className="source-analysis-progress-head">
                            <div>
                              <span>Analyzing source</span>
                              <strong>{sourceInspectProgress < 30 ? 'Reading source' : sourceInspectProgress < 72 ? 'Checking captions' : 'Preparing report'}</strong>
                            </div>
                          <b>{sourceInspectProgress}%</b>
                        </div>
                        <div className="source-analysis-track" aria-label={`Source analysis ${sourceInspectProgress}% complete`}>
                          <i style={{ width: `${sourceInspectProgress}%` }} />
                        </div>
                      </div>
                    ) : (
                      <div className="source-preflight">
                        <button type="button" disabled={!sourceLines.length} onClick={inspectSource}>Analyze <ArrowRight size={16} /></button>
                      </div>
                    )}
                  </>
                )}
                {sourceInspection && (
                  <article className="source-report">
                    <header className="source-report-hero">
                      <div className={`source-report-artwork is-${sourceInspection.type}`}>
                          {sourceInspection.thumbnailUrl
                            ? <img src={sourceInspection.thumbnailUrl} alt="" referrerPolicy="no-referrer" />
                            : <ListVideo size={30} aria-hidden="true" />}
                      </div>
                      <div className="source-report-title">
                        <h1 data-no-translate>{sourceInspection.title}</h1>
                        <p>
                          {sourceInspection.captionSampleSize
                            ? sourceInspection.captionEstimateExact
                              ? `${sourceInspection.captionSampleSize} ${sourceInspection.captionSampleSize === 1 ? 'video' : 'videos'} checked`
                              : `Caption estimate based on ${sourceInspection.captionSampleSize} videos sampled across the source`
                            : 'Caption sampling unavailable'}
                          {sourceInspection.truncated ? ' · workspace limit applied' : ''}
                        </p>
                      </div>
                      <button type="button" className="source-report-change" onClick={() => {
                        setSourceInspection(null)
                        setSourceInspectProgress(0)
                        setActionMessage('')
                      }}><RotateCw size={14} /> Change</button>
                    </header>

                    <section className="source-report-inventory" aria-label="Source inventory">
                      <div><strong>{sourceInspection.videoCount.toLocaleString()}</strong><span>Total</span></div>
                      <div><strong>{(sourceInspection.breakdown?.videos ?? sourceInspection.videoCount).toLocaleString()}</strong><span>Videos</span></div>
                      <div><strong>{(sourceInspection.breakdown?.shorts ?? 0).toLocaleString()}</strong><span>Shorts</span></div>
                      <div><strong>{(sourceInspection.breakdown?.live ?? 0).toLocaleString()}</strong><span>Live</span></div>
                      <p>
                        <span>Estimated output</span>
                        {sourceInspection.type === 'video' && sourceInspection.estimatedAiFallbackVideos === 1
                          ? <><strong>? words</strong><strong>? segments</strong></>
                          : <><strong>~{sourceInspection.estimatedWords.toLocaleString()} words</strong><strong>~{sourceInspection.estimatedSegments.toLocaleString()} segments</strong></>}
                      </p>
                    </section>

                    <section className="source-report-processing">
                      <div className="source-report-section-title">
                        <h2>Processing route</h2>
                        <span>{sourceInspection.processingConcurrency ?? 6} parallel workers</span>
                      </div>
                      <div className="source-report-route">
                        <FileText size={17} />
                        <div>
                          <strong>Captions ready</strong>
                          <span className="source-report-route-detail">
                            <b>{sourceInspection.estimatedCaptionedVideos?.toLocaleString() ?? '?'}</b>
                            <em>{sourceInspection.estimatedCaptionedVideos === 1 ? 'video' : 'videos'}</em>
                            <small>· {formatAnalysisMinutes(sourceInspection.captionedContentMinutes)} source runtime</small>
                          </span>
                        </div>
                        <b>~{formatAnalysisMinutes(sourceInspection.estimatedCaptionProcessingMinutes)}</b>
                      </div>
                      <div className="source-report-route is-fallback">
                        <Sparkles size={17} />
                        <div>
                          <strong>AI fallback</strong>
                          <span className="source-report-route-detail">
                            <b>{sourceInspection.estimatedAiFallbackVideos?.toLocaleString() ?? '?'}</b>
                            <em>{sourceInspection.estimatedAiFallbackVideos === 1 ? 'video' : 'videos'}</em>
                            <small>· {formatAnalysisMinutes(sourceInspection.aiFallbackContentMinutes)} source runtime</small>
                          </span>
                        </div>
                        <b>~{formatAnalysisMinutes(sourceInspection.estimatedAiFallbackProcessingMinutes)}</b>
                      </div>
                    </section>

                    <footer className="source-report-footer">
                      <div><span>Expected completion</span><strong>~{formatAnalysisMinutes(sourceInspection.estimatedMinutes)}</strong><small>Estimate may shift with provider load.</small></div>
                      <button type="button" disabled={batchSubmitting} onClick={queueSource}>{batchSubmitting ? 'Starting…' : 'Start transcript job'} <ArrowRight size={16} /></button>
                    </footer>
                  </article>
                )}
                {actionMessage && <p className="source-error">{actionMessage}</p>}
              </section>

              {!sourceInspection && (
                <section className="dashboard-home-usage-card" aria-label="Workspace usage">
                  <header>
                    <span>Usage</span>
                    <button type="button" onClick={() => selectView('usage')} aria-label="Open usage">Open <ArrowRight size={14} /></button>
                  </header>
                  {([['Captions', captionHours], ['AI fallback', aiFallbackHours]] as const).map(([label, meter]) => (
                    <div className="dashboard-home-usage-row" key={label}>
                      <div><span>{label}</span><strong>{formatHours(meter.remainingHours)}</strong></div>
                      <div className="dashboard-home-usage-track" aria-label={`${meter.remainingPercentage}% remaining`}><i style={{ width: `${meter.remainingPercentage}%` }} /></div>
                      <small>{meter.remainingPercentage}%</small>
                    </div>
                  ))}
                  <footer>Resets {usage.resetAt ? new Date(usage.resetAt).toLocaleDateString() : '—'}</footer>
                </section>
              )}

              {batchJobs.length > 0 && <section className="dashboard-home-recent">
                <div className="dashboard-home-recent-head">
                  <h2>Recent jobs</h2>
                  <button type="button" onClick={() => selectView('archive')}>Library <ArrowRight size={14} /></button>
                </div>
                <div className="dashboard-job-grid">
                  {batchJobs.slice(0, 6).map((job) => {
                    const processed = job.completed + job.failed
                    const percentage = Math.round((processed / Math.max(job.total, 1)) * 100)
                    const displayStatus = job.status === 'completed' && job.failed > 0 ? 'partial' : job.status
                    return (
                      <button
                        className="dashboard-job-card"
                        type="button"
                        key={job.id}
                        onClick={() => void loadBatchResults(job)}
                        aria-label={`Open job ${job.id.slice(0, 8)} transcripts`}
                      >
                        <div><span>JOB {job.id.slice(0, 8)}</span><b className={`job-status status-${displayStatus}`}>{displayStatus}</b></div>
                        <strong>{job.total.toLocaleString()} {job.total === 1 ? 'video' : 'videos'}</strong>
                        <div className="dashboard-job-progress"><i style={{ width: `${percentage}%` }} /></div>
                        <footer><span>{processed}/{job.total} processed</span><span>{job.failed ? `${job.failed} failed` : `${percentage}%`}</span></footer>
                        {!processed && !['completed', 'failed', 'cancelled'].includes(job.status) && <p className="dashboard-job-note">Worker active · AI fallback can take several minutes</p>}
                      </button>
                    )
                  })}
                </div>
              </section>}
            </div>
          )}

          {view === 'usage' && usage && (
            <article className="usage-workspace">
              <header className="usage-workspace-head">
                <h1>Usage</h1>
              </header>
              <div className="usage-hour-grid">
                {([['Caption video', captionHours], ['AI fallback', aiFallbackHours]] as const).map(([label, meter]) => (
                  <section className="usage-meter-card usage-hour-card" key={label}>
                    <div className="usage-meter-primary"><span>{label} remaining</span><strong>{formatHours(meter.remainingHours)}</strong><small>{formatHours(meter.usedHours)} of {formatHours(meter.limitHours)} used</small></div>
                    <div className="usage-meter-percent">{meter.remainingPercentage}% remaining</div>
                    <div className="usage-meter-track" aria-label={`${meter.remainingPercentage}% of ${label} allowance remaining`}><i style={{ width: `${meter.remainingPercentage}%` }} /></div>
                    <footer className="usage-hour-footer"><div><span>Used</span><strong>{formatHours(meter.usedHours)}</strong></div><div><span>Resets</span><strong>{usage.resetAt ? new Date(usage.resetAt).toLocaleDateString() : '—'}</strong></div></footer>
                  </section>
                ))}
              </div>
            </article>
          )}

          {view === 'transcribe' && (
            <article className="panel">
              <div className="panel-head"><div><h2>Business Transcribe</h2><p>Process a video and save it to this workspace.</p></div></div>
              <div className="inline-form wide">
                <input value={transcribeUrl} onChange={(event) => setTranscribeUrl(event.target.value)} placeholder="https://youtube.com/watch?v=..." />
                <button type="button" disabled={transcribing} onClick={transcribeVideo}>{transcribing ? 'Processing...' : 'Start'}</button>
              </div>
              {actionMessage && <p className="dashboard-empty">{actionMessage}</p>}
              {transcribeResult && (
                <a className="qa-card" href={`https://youtube.com/watch?v=${transcribeResult.video_id}`} target="_blank" rel="noreferrer">
                  <span className="ico"><Check size={18} /></span>
                  <span><strong data-no-translate>{transcribeResult.video_title}</strong><span>{transcribeResult.word_count.toLocaleString()} words saved</span></span>
                  <ArrowRight size={16} />
                </a>
              )}
              <div className="batch-tool">
                <div className="panel-head"><div><h2>Batch queue</h2><p>Up to {plan.maxBatchUrls.toLocaleString()} URLs per job.</p></div></div>
                <textarea
                  value={batchInput}
                  onChange={(event) => setBatchInput(event.target.value)}
                  placeholder={'https://youtube.com/watch?v=...\nhttps://youtu.be/...'}
                  rows={6}
                  aria-label="Batch YouTube URLs"
                />
                <button type="button" disabled={batchSubmitting || !batchInput.trim()} onClick={queueBatch}>
                  <UploadCloud size={14} /> {batchSubmitting ? 'Queueing...' : 'Queue batch'}
                </button>
                {batchJob && (
                  <div className="batch-progress-card">
                    <div className="batch-status">
                      <strong>{batchJob.status === 'completed' ? 'Completed' : 'Processing'}</strong>
                      <span>{batchJob.completed + batchJob.failed} / {batchJob.total}</span>
                      <span>{Math.round(((batchJob.completed + batchJob.failed) / Math.max(batchJob.total, 1)) * 100)}%</span>
                    </div>
                    <div className="batch-progress-track">
                      <i style={{ width: `${Math.round(((batchJob.completed + batchJob.failed) / Math.max(batchJob.total, 1)) * 100)}%` }} />
                    </div>
                    <small>{batchJob.failed ? `${batchJob.failed} failed` : 'No failures'}</small>
                  </div>
                )}
                {batchJobs.length > 0 && (
                  <div className="batch-history">
                    {batchJobs.slice(0, 5).map((job) => (
                      <button type="button" key={job.id} onClick={() => setBatchJob(job)}>
                        <span>{job.id.slice(0, 8)}</span>
                        <span>{job.completed + job.failed}/{job.total}</span>
                        <strong>{job.status}</strong>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </article>
          )}

          {view === 'archive' && (
            <article className="panel archive-panel">
              <div className="panel-head">
                <div>
                  <h2>{batchResultView ? `Job ${batchResultView.job.id.slice(0, 8)}` : 'Transcript Archive'}</h2>
                  {batchResultView && <p>{batchResultView.job.completed} completed · {batchResultView.job.failed} failed</p>}
                </div>
                {batchResultView ? (
                  <button className="btn" type="button" onClick={() => { setBatchResultView(null); setSelectedTranscript(null) }}>All transcripts</button>
                ) : (
                  <form className="inline-form archive-search" onSubmit={(event) => { event.preventDefault(); void searchArchive() }}>
                    <input value={archiveQuery} onChange={(event) => setArchiveQuery(event.target.value)} placeholder="Search video title or channel" />
                    <button type="submit" disabled={archiveLoading}><Search size={14} /> Search</button>
                  </form>
                )}
              </div>
              {actionMessage && <p className="dashboard-empty">{actionMessage}</p>}
              {selectedTranscript ? (
                <div className="archive-detail">
                  <div className="archive-detail-head">
                    <div>
                      <button className="panel-link" type="button" onClick={() => setSelectedTranscript(null)}>← Back to archive</button>
                      <h2 data-no-translate>{selectedTranscript.video_title}</h2>
                      <p><span data-no-translate>{selectedTranscript.video_channel}</span> · {selectedTranscript.word_count.toLocaleString()} words · {new Date(selectedTranscript.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="actions">
                      <button className="btn" type="button" onClick={copyArchivedTranscript}><Clipboard size={14} /> Copy</button>
                      <div className="archive-export">
                        <select
                          aria-label="Transcript download format"
                          value={exportFormat}
                          onChange={(event) => setExportFormat(event.target.value as TranscriptExportFormat)}
                        >
                          {(['txt', 'srt', 'vtt', 'json', 'pdf', 'docx'] as TranscriptExportFormat[]).map((format) => (
                            <option value={format} key={format}>{format.toUpperCase()}</option>
                          ))}
                        </select>
                        <a
                          className="btn"
                          href={`/api/dashboard/transcripts/${encodeURIComponent(selectedTranscript.id)}/export?format=${exportFormat}`}
                        ><Download size={14} /> Download</a>
                      </div>
                      <a className="btn" href={`https://youtube.com/watch?v=${selectedTranscript.video_id}`} target="_blank" rel="noreferrer">YouTube <ArrowRight size={14} /></a>
                    </div>
                  </div>
                  {selectedTranscript.ai_summary?.summary && (
                    <section className="archive-ai-brief">
                      <div>
                        <span>AI brief</span>
                        <h3 data-no-translate>{selectedTranscript.ai_summary.title || selectedTranscript.video_title}</h3>
                      </div>
                      <p data-no-translate>{selectedTranscript.ai_summary.summary}</p>
                      <footer>
                        <div data-no-translate>{selectedTranscript.ai_summary.tags?.map((tag) => <span key={tag}>{tag}</span>)}</div>
                        <button className="btn" type="button" onClick={() => navigator.clipboard.writeText(selectedTranscript.ai_summary?.summary || '')}><Clipboard size={14} /> Copy brief</button>
                      </footer>
                    </section>
                  )}
                  <div className="archive-transcript">
                    {selectedTranscript.lines.slice(0, visibleTranscriptLineCount).map((line, index) => (
                      <p key={`${line.start}-${index}`}><time>{formatTime(line.start)}</time><span data-no-translate>{line.text}</span></p>
                    ))}
                  </div>
                  {visibleTranscriptLineCount < selectedTranscript.lines.length && (
                    <button
                      className="btn archive-load-more"
                      type="button"
                      onClick={() => setVisibleTranscriptLineCount((count) => count + 250)}
                    >
                      Show 250 more segments
                    </button>
                  )}
                </div>
              ) : batchResultView ? (
                <div className="batch-result-view">
                  {batchResultsLoading && batchResultView.items.length === 0 && <p className="dashboard-empty">Loading job transcripts...</p>}
                  {!batchResultsLoading && batchResultView.items.length === 0 && <p className="dashboard-empty">This job has no saved transcript results.</p>}
                  <div className={`recent-list ${preferences.compactLibrary ? 'compact' : ''}`}>
                    {batchResultView.items.map((item) => {
                      const transcript = item.transcript
                      const canOpen = Boolean(item.transcript_id)
                      return (
                        <button
                          className={`recent-item batch-result-item status-${item.status}`}
                          type="button"
                          key={item.id}
                          disabled={!canOpen}
                          onClick={() => item.transcript_id && void openTranscript(item.transcript_id)}
                        >
                          <div className="recent-thumb">
                            {transcript
                              ? <img src={transcript.video_thumbnail || `https://img.youtube.com/vi/${transcript.video_id}/mqdefault.jpg`} alt="" loading="lazy" />
                              : <span className="batch-result-placeholder"><FileText size={18} /></span>}
                            <span className={`dur ${item.status === 'completed' ? 'ok' : ''}`}>{item.status}</span>
                          </div>
                          <div>
                            <div className="title" data-no-translate>{transcript?.video_title || item.url}</div>
                            <div className="sub">
                              <span data-no-translate={transcript?.video_channel ? true : undefined}>{transcript?.video_channel || (item.error ? 'Could not transcribe' : 'Transcript result')}</span>
                              <span>{transcript ? `${transcript.word_count.toLocaleString()} words · ${transcript.video_duration}` : item.status === 'failed' ? formatBatchResultError(item.error) : 'Waiting for worker'}</span>
                            </div>
                          </div>
                          {canOpen && <span className="arrow"><ArrowRight size={16} /></span>}
                        </button>
                      )
                    })}
                  </div>
                  {batchResultView.items.length < batchResultView.total && (
                    <button className="btn archive-load-more" type="button" disabled={batchResultsLoading} onClick={() => void loadBatchResults(batchResultView.job, true)}>
                      {batchResultsLoading ? 'Loading…' : `Show ${Math.min(100, batchResultView.total - batchResultView.items.length)} more results`}
                    </button>
                  )}
                </div>
              ) : (
                <div className={`recent-list ${preferences.compactLibrary ? 'compact' : ''}`}>
                  {archiveLoading && <p className="dashboard-empty">Searching archive...</p>}
                  {!archiveLoading && archive.length === 0 && <p className="dashboard-empty">No transcripts match this search.</p>}
                  {!archiveLoading && archive.map((transcript) => (
                    <button className="recent-item" type="button" key={transcript.id} onClick={() => void openTranscript(transcript.id)}>
                      <div className="recent-thumb">
                        <img src={transcript.video_thumbnail || `https://img.youtube.com/vi/${transcript.video_id}/mqdefault.jpg`} alt="" loading="lazy" />
                        <span className="dur ok">{transcript.video_duration || `${transcript.word_count} words`}</span>
                      </div>
                      <div><div className="title" data-no-translate>{transcript.video_title}</div><div className="sub"><span>{relativeTime(transcript.created_at)}</span><span><span data-no-translate>{transcript.video_channel}</span> · {transcript.word_count.toLocaleString()} words</span></div></div>
                      <span className="arrow"><ArrowRight size={16} /></span>
                    </button>
                  ))}
                </div>
              )}
            </article>
          )}

          {view === 'keys' && (
            <article className="panel">
              {keyModalOpen && (
                <div className="dashboard-key-modal-backdrop" role="presentation" onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setKeyModalOpen(false)
                }}>
                  <form className="dashboard-key-modal" role="dialog" aria-modal="true" aria-labelledby="create-key-title" onSubmit={(event) => {
                    event.preventDefault()
                    void createKey()
                  }}>
                    <button className="dashboard-key-modal-close" type="button" onClick={() => setKeyModalOpen(false)} aria-label="Close"><X size={16} /></button>
                    <span className="dashboard-key-modal-kicker">API access</span>
                    <h2 id="create-key-title">Create an API key</h2>
                    <p>This key uses the workspace’s shared caption and AI fallback hours. Set an expiry to control access.</p>
                    <label>
                      <span>Name</span>
                      <input autoFocus required maxLength={64} value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} placeholder="Production" />
                    </label>
                    <div className="dashboard-key-modal-grid single">
                      <label>
                        <span>Expires after</span>
                        <select required value={newKeyExpiryDays} onChange={(event) => setNewKeyExpiryDays(event.target.value)}>
                          <option value="30">30 days</option>
                          <option value="50">50 days</option>
                          <option value="90">90 days</option>
                          <option value="365">1 year</option>
                        </select>
                      </label>
                    </div>
                    <small>Usage is measured from completed video duration and shared workspace hours.</small>
                    {keyModalError && <div className="dashboard-key-modal-error">{keyModalError}</div>}
                    <button className="dashboard-key-modal-submit" type="submit" disabled={creatingKey || !newKeyName.trim()}>{creatingKey ? 'Creating…' : 'Create key'}</button>
                  </form>
                </div>
              )}
              {newKey && (
                <div className="reveal-key">
                  <span>Save this key. It is shown only once.</span>
                  <code>{newKey}</code>
                  <div>
                    <button type="button" onClick={copyKey}><Clipboard size={14} /> {copied ? 'Copied' : 'Copy key'}</button>
                    <button type="button" onClick={() => setNewKey('')}>I've saved it</button>
                  </div>
                </div>
              )}
              <div className="panel-head">
                <div><h2>API keys</h2><p>Use Bearer tokens to authenticate API calls.</p></div>
                <button className="dashboard-create-key" type="button" onClick={() => { setKeyModalError(''); setKeyModalOpen(true) }}><Plus size={14} /> Create key</button>
              </div>
              <div className="key-list">
                {keys.length === 0 && <p className="dashboard-empty">No API keys yet.</p>}
                {keys.map((key) => {
                  const expired = Boolean(key.expires_at && new Date(key.expires_at).getTime() <= dashboardNow)
                  const status = expired ? 'Expired' : key.active ? 'Active' : 'Revoked'
                  return (
                    <div className="key-row dashboard-policy-key" key={key.id}>
                      <div className="name">
                        <div className="icon"><KeyRound size={15} /></div>
                        <div>
                          <strong data-no-translate>{key.name}</strong>
                          <div className="preview">Created {new Date(key.created_at).toLocaleDateString()}</div>
                        </div>
                      </div>
                      <div className="key-policy-meta"><span>Usage pool</span><strong>Workspace hours</strong></div>
                      <div className="key-policy-meta"><span>Expires</span><strong>{key.expires_at ? new Date(key.expires_at).toLocaleDateString() : 'No expiry'}</strong></div>
                      <div className="key-policy-meta"><span>Last used</span><strong>{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}</strong></div>
                      <span className={`status ${status === 'Active' ? '' : 'revoked'}`}>{status}</span>
                      <button className="icon-btn danger" type="button" onClick={() => deleteKey(key.id)} aria-label="Revoke key"><Trash2 size={14} /></button>
                    </div>
                  )
                })}
              </div>
            </article>
          )}

          {view === 'webhooks' && (
            <article className="panel webhooks-panel">
              <div className="panel-head">
                <div><h2>Webhooks</h2><p>Get notified when transcripts and batches finish.</p></div>
                <div className="inline-form webhook-create">
                  <input value={newWebhookUrl} onChange={(event) => setNewWebhookUrl(event.target.value)} placeholder="https://your-app.com/webhook" />
                  <button type="button" onClick={addWebhook}><Plus size={14} /> Add</button>
                </div>
              </div>
              {newWebhookSecret && (
                <div className="reveal-key">
                  <span>Webhook signing secret. Sign timestamp + period + raw body. It is shown only once.</span>
                  <code>{newWebhookSecret}</code>
                  <div>
                    <button type="button" onClick={() => navigator.clipboard.writeText(newWebhookSecret)}><Clipboard size={14} /> Copy secret</button>
                    <button type="button" onClick={() => setNewWebhookSecret('')}>I've saved it</button>
                  </div>
                </div>
              )}
              {actionMessage && <p className="dashboard-empty">{actionMessage}</p>}
              <div className="key-list">
                {webhooks.length === 0 && <p className="dashboard-empty">No webhooks configured.</p>}
                {webhooks.map((webhook) => (
                  <div className="webhook-row" key={webhook.id}>
                    <span className={webhook.active ? 'health-dot' : 'health-dot warn'} />
                    <div>
                      <div className="url">{webhook.url}</div>
                      <div className="events">{webhook.events.map((event) => <span key={event}>{event}</span>)}</div>
                    </div>
                    <span className="status">{webhook.active ? 'Active' : 'Paused'}</span>
                    <button className="icon-btn danger" type="button" onClick={() => deleteWebhook(webhook.id)} aria-label="Delete webhook"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </article>
          )}

          {view === 'channels' && (
            <article className="panel automation-panel">
              <div className="panel-head"><div><h2>Channel automations</h2><p>Choose what runs, when it runs, and what should be saved to your workspace.</p></div></div>
              <section className="automation-create">
                <div className="automation-source-row">
                  <input value={channelUrl} onChange={(event) => setChannelUrl(event.target.value)} placeholder="Paste a YouTube channel URL or @handle" />
                  <button type="button" onClick={addChannel} disabled={!channelUrl.trim()}><Plus size={15} /> Add automation</button>
                </div>
                <div className="automation-create-settings">
                  <label><span>Frequency</span><select value={channelFrequency} onChange={(event) => setChannelFrequency(event.target.value as Channel['schedule_frequency'])}><option value="every_15_minutes">Every 15 minutes</option><option value="hourly">Hourly</option><option value="daily">Daily</option></select></label>
                  {channelFrequency === 'daily' && <label><span>Run at</span><input type="time" value={channelTime} onChange={(event) => setChannelTime(event.target.value)} /></label>}
                  <label><span>Timezone</span><select value={channelTimezone} onChange={(event) => setChannelTimezone(event.target.value)}>{automationTimezones.map((timezone) => <option value={timezone} key={timezone}>{timezone}</option>)}</select></label>
                  <label><span>First run</span><select value={channelBackfill} onChange={(event) => setChannelBackfill(Number(event.target.value))}><option value="0">New uploads only</option><option value="25">Latest 25 videos</option><option value="100">Latest 100 videos</option><option value="250">Latest 250 videos</option></select></label>
                  <button className={`automation-option ${channelAutoSummary ? 'active' : ''}`} type="button" aria-pressed={channelAutoSummary} onClick={() => setChannelAutoSummary((value) => !value)}><Sparkles size={15} /><span><strong>AI brief</strong><small>Automatic summary</small></span></button>
                  <button className={`automation-option ${channelAiFallback ? 'active' : ''}`} type="button" aria-pressed={channelAiFallback} onClick={() => setChannelAiFallback((value) => !value)}><Activity size={15} /><span><strong>AI fallback</strong><small>Caption backup</small></span></button>
                </div>
                <p>The first run begins immediately after the automation is added.</p>
              </section>
              {actionMessage && <p className="dashboard-empty">{actionMessage}</p>}
              <div className="automation-list">
                {featureErrors.channels
                  ? <p className="dashboard-empty">{featureErrors.channels}</p>
                  : channels.length === 0 && <p className="dashboard-empty">No channels connected.</p>}
                {channels.map((channel) => (
                  <article className={`automation-channel ${channel.paused ? 'is-paused' : ''}`} key={channel.id}>
                    <header>
                      <div className="automation-channel-name"><span><Radio size={17} /></span><div data-no-translate><h3>{channel.channel_name}</h3><p>{channel.channel_id}</p></div></div>
                      <span className={`automation-run-state is-${channel.last_run_status}`}>{channel.paused ? 'Paused' : channel.last_run_status || 'Pending'}</span>
                    </header>
                    <div className="automation-run-grid">
                      <div><span>Schedule</span><strong>{channel.schedule_frequency === 'every_15_minutes' ? 'Every 15 min' : channel.schedule_frequency === 'hourly' ? 'Hourly' : `Daily · ${String(channel.schedule_time).slice(0, 5)}`}</strong></div>
                      <div><span>Next run</span><strong>{channel.paused ? 'Paused' : channel.next_run_at ? new Date(channel.next_run_at).toLocaleString() : 'Pending'}</strong></div>
                      <div><span>Last delivery</span><strong>{channel.last_synced_at ? relativeTime(channel.last_synced_at) : 'Not run yet'}</strong></div>
                      <div><span>Last result</span><strong>{channel.last_run_processed || channel.last_run_failed ? `${channel.last_run_processed} saved · ${channel.last_run_failed} failed` : 'No videos yet'}</strong></div>
                    </div>
                    {channel.last_run_error && <p className="automation-run-error">{channel.last_run_error}</p>}
                    <div className="automation-channel-controls">
                      <label><span>Frequency</span><select value={channel.schedule_frequency} disabled={channelSavingId === channel.id} onChange={(event) => void updateChannel(channel, { schedule_frequency: event.target.value as Channel['schedule_frequency'] })}><option value="every_15_minutes">Every 15 minutes</option><option value="hourly">Hourly</option><option value="daily">Daily</option></select></label>
                      {channel.schedule_frequency === 'daily' && <label><span>Run at</span><input key={channel.schedule_time} type="time" defaultValue={String(channel.schedule_time).slice(0, 5)} disabled={channelSavingId === channel.id} onBlur={(event) => void updateChannel(channel, { schedule_time: event.target.value })} /></label>}
                      <label><span>Timezone</span><select value={channel.timezone} disabled={channelSavingId === channel.id} onChange={(event) => void updateChannel(channel, { timezone: event.target.value })}>{[...new Set([channel.timezone, ...automationTimezones])].map((timezone) => <option value={timezone} key={timezone}>{timezone}</option>)}</select></label>
                      <label><span>Next run scope</span><select value={channel.backfill_limit} disabled={channelSavingId === channel.id} onChange={(event) => void updateChannel(channel, { backfill_limit: Number(event.target.value) })}><option value="0">New uploads</option><option value="25">Latest 25</option><option value="100">Latest 100</option><option value="250">Latest 250</option></select></label>
                      <button className={`automation-option ${channel.auto_summary ? 'active' : ''}`} type="button" aria-pressed={channel.auto_summary} disabled={channelSavingId === channel.id} onClick={() => void updateChannel(channel, { auto_summary: !channel.auto_summary })}><Sparkles size={14} /><span><strong>AI brief</strong><small>Automatic summary</small></span></button>
                      <button className={`automation-option ${channel.ai_fallback ? 'active' : ''}`} type="button" aria-pressed={channel.ai_fallback} disabled={channelSavingId === channel.id} onClick={() => void updateChannel(channel, { ai_fallback: !channel.ai_fallback })}><Activity size={14} /><span><strong>AI fallback</strong><small>Caption backup</small></span></button>
                    </div>
                    <footer>
                      <button type="button" disabled={channelSavingId === channel.id} onClick={() => void runChannelNow(channel)}><RotateCw size={14} /> Run now</button>
                      <button type="button" disabled={channelSavingId === channel.id} onClick={() => void updateChannel(channel, { paused: !channel.paused })}>{channel.paused ? <><Check size={14} /> Resume</> : <><CalendarClock size={14} /> Pause</>}</button>
                      <button className="danger" type="button" disabled={channelSavingId === channel.id} onClick={() => deleteChannel(channel.id)}><Trash2 size={14} /> Remove</button>
                    </footer>
                  </article>
                ))}
              </div>
            </article>
          )}

          {view === 'team' && usage?.role === 'admin' && (
            <article className="panel team-panel team-workspace">
              <header className="team-workspace-head">
                <div>
                  <h2>Workspace team</h2>
                  <p>Invite people with a private access key. Roles and access stay under your control.</p>
                </div>
                <div className="team-workspace-stats" aria-label="Workspace member summary">
                  <span><strong>{team.length}</strong> members</span>
                  <span><strong>{team.filter((member) => member.role === 'admin').length}</strong> admins</span>
                  <span><strong>{team.filter((member) => member.active).length}</strong> active</span>
                </div>
              </header>

              <nav className="team-page-nav" aria-label="Team sections">
                <button type="button" className={teamSection === 'invite' ? 'active' : ''} onClick={() => setTeamSection('invite')}>Grant access</button>
                <button type="button" className={teamSection === 'members' ? 'active' : ''} onClick={() => setTeamSection('members')}>Members <span>{team.length}</span></button>
              </nav>

              {teamSection === 'invite' && issuedTeamKey && (
                <div className="reveal-key team-key-reveal">
                  <span><KeyRound size={15} /> New private access key</span>
                  <small>Copy it now. For security, this key will not be shown again.</small>
                  <code>{issuedTeamKey}</code>
                  <div>
                    <button type="button" onClick={() => navigator.clipboard.writeText(issuedTeamKey)}><Clipboard size={14} /> Copy key</button>
                    <button type="button" onClick={() => setIssuedTeamKey('')}>Done</button>
                  </div>
                </div>
              )}

              {teamSection === 'invite' && <section className="team-invite">
                <div className="team-section-head">
                  <div>
                    <h3>Grant workspace access</h3>
                  </div>
                  <KeyRound size={18} />
                </div>
                <form className="team-create" onSubmit={(event) => { event.preventDefault(); void createTeamMember() }}>
                  <label>
                    <span>Username</span>
                    <input value={teamUsername} onChange={(event) => setTeamUsername(event.target.value)} placeholder="e.g. Jane Doe" autoComplete="off" />
                  </label>
                  <label>
                    <span>Email address</span>
                    <input type="email" value={teamEmail} onChange={(event) => setTeamEmail(event.target.value)} placeholder="jane@company.com" autoComplete="email" />
                  </label>
                  <label className="team-role-field">
                    <span>Access role</span>
                    <select value={teamRole} onChange={(event) => setTeamRole(event.target.value as 'admin' | 'teammate')} aria-label="Member role">
                      <option value="teammate">Teammate</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                  <button type="submit" disabled={!teamUsername.trim() || !teamEmail.trim()}><Plus size={15} /> Issue access key</button>
                </form>
                <p className="team-invite-note"><ShieldCheck size={14} /> Keys are shown once. You can rotate or revoke access at any time.</p>
              </section>}

              {actionMessage && <p className="dashboard-empty">{actionMessage}</p>}
              {teamSection === 'members' && <section className="team-directory">
                <div className="team-directory-head">
                  <div>
                    <h3>Workspace members</h3>
                  </div>
                  <strong>{team.length} total</strong>
                </div>
                <div className="team-list">
                  {team.map((member) => (
                    <div className={`team-row ${member.active ? '' : 'inactive'}`} key={member.id}>
                      <div className="team-avatar">{member.username.slice(0, 2).toUpperCase()}</div>
                      <div className="team-person">
                        <strong data-no-translate>{member.username}</strong>
                        <span data-no-translate>{member.email}</span>
                      </div>
                      <span className={`team-role ${member.role}`}><ShieldCheck size={13} /> {member.role}</span>
                      <span className="team-login">{member.last_login_at ? `Last login ${relativeTime(member.last_login_at)}` : 'Never signed in'}</span>
                      <div className="team-actions">
                        <button type="button" onClick={() => updateTeamMember(member, { role: member.role === 'admin' ? 'teammate' : 'admin' })}>
                          {member.role === 'admin' ? 'Make teammate' : 'Make admin'}
                        </button>
                        <button className="icon-only" type="button" onClick={() => rotateTeamKey(member)} title="Rotate access key" aria-label={`Rotate ${member.username} access key`}><RotateCw size={14} /></button>
                        <button className={member.active ? 'danger' : ''} type="button" onClick={() => updateTeamMember(member, { active: !member.active })}>
                          {member.active ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {featureErrors.team && (
                    <div className="team-empty-state is-warning">
                      <ShieldCheck size={21} />
                      <strong>Workspace access is not ready</strong>
                      <span>{featureErrors.team}</span>
                    </div>
                  )}
                  {!featureErrors.team && team.length === 0 && (
                    <div className="team-empty-state">
                      <Users size={21} />
                      <strong>No members yet</strong>
                      <span>Issue the first private access key above.</span>
                    </div>
                  )}
                </div>
              </section>}
            </article>
          )}

          {view === 'settings' && (
            <section className="settings-workspace">
              <header className="settings-workspace-head"><h1>Settings</h1></header>
              <nav className="settings-page-nav" aria-label="Settings sections">
                {([
                  ['account', 'Account'],
                  ['language', 'Language'],
                  ['output', 'Output'],
                  ['developer', 'Developer'],
                  ['billing', 'Billing'],
                ] as Array<[SettingsSection, string]>).map(([id, label]) => (
                  <button type="button" className={settingsSection === id ? 'active' : ''} onClick={() => setSettingsSection(id)} key={id}>{label}</button>
                ))}
              </nav>
              <div className="settings-page">
                {settingsSection === 'account' && (
                  <article className="panel settings-profile">
                    <div className="settings-photo-row">
                      <span className={`settings-photo-preview is-${usage?.role || 'teammate'}`}>
                        {profilePhoto ? <img src={profilePhoto} alt="Profile" /> : greetingName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                      <div><strong>Profile photo</strong><small>Shown in this dashboard on this device.</small></div>
                      <label className="btn settings-photo-button">Choose image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => updateProfilePhoto(event.target.files?.[0])} /></label>
                    </div>
                    <div className="settings-account-row"><span>Username</span><strong data-no-translate>{greetingName}</strong></div>
                    <div className="settings-account-row"><span>Email</span><strong data-no-translate>{usage?.email || '—'}</strong></div>
                    <div className="settings-account-row"><span>Role</span><strong>{usage?.role || 'teammate'}</strong></div>
                    <div className="settings-account-actions"><a className="btn" href="/docs" target="_blank" rel="noreferrer">Open documentation</a></div>
                  </article>
                )}
                {settingsSection === 'language' && (
                  <article className="panel settings-language">
                    <div className="panel-head">
                      <div>
                        <h2>Language &amp; region</h2>
                        <p>Choose the language used throughout your dashboard.</p>
                      </div>
                    </div>
                    <div className="settings-language-grid" role="radiogroup" aria-label="Dashboard language">
                      {dashboardLocaleOptions.map((option) => (
                        <button
                          className={locale === option.value ? 'settings-language-option active' : 'settings-language-option'}
                          type="button"
                          role="radio"
                          aria-checked={locale === option.value}
                          onClick={() => onLocaleChange(option.value)}
                          key={option.value}
                          data-no-translate
                        >
                          <span>{option.code}</span>
                          <strong>{option.label}</strong>
                          {locale === option.value ? <Check size={16} aria-hidden="true" /> : null}
                        </button>
                      ))}
                    </div>
                    <p className="settings-language-note">The preference is saved on this device and also applies to the public site, Docs, Pricing, and Checkout.</p>
                  </article>
                )}
                {settingsSection === 'output' && (
                  <article className="panel settings-preferences">
                    <div className="panel-head"><div><h2>Output defaults</h2><p>Saved in this browser for future dashboard sessions.</p></div></div>
                    <label className="settings-select-row"><span><strong>Download format</strong><small>Choose subtitles, structured data, PDF, or an editable Word document.</small></span><select value={preferences.defaultExport} onChange={(event) => updatePreference('defaultExport', event.target.value as TranscriptExportFormat)}>{(['txt', 'pdf', 'docx', 'srt', 'vtt', 'json'] as TranscriptExportFormat[]).map((format) => <option key={format} value={format}>{format === 'docx' ? 'WORD (.DOCX)' : format.toUpperCase()}</option>)}</select></label>
                    <label className="settings-toggle-row"><span><strong>Include timestamps</strong><small>Keep timestamps in copied transcript output.</small></span><input type="checkbox" checked={preferences.includeTimestamps} onChange={(event) => updatePreference('includeTimestamps', event.target.checked)} /></label>
                    <label className="settings-toggle-row"><span><strong>Compact library rows</strong><small>Show more saved transcripts at once.</small></span><input type="checkbox" checked={preferences.compactLibrary} onChange={(event) => updatePreference('compactLibrary', event.target.checked)} /></label>
                  </article>
                )}
                {settingsSection === 'developer' && (
                  <article className="panel">
                    <div className="panel-head"><div><h2>API connection test</h2><p>Only needed when connecting EasyTran to your own app. This command sends one authenticated transcript request.</p></div></div>
                    <CodeBlock />
                  </article>
                )}
                {settingsSection === 'billing' && (
                  <article className="panel">
                    <div className="panel-head"><div><h2>Billing</h2><p>Your current subscription and secure payment access.</p></div></div>
                    <div className="settings-billing-summary">
                      <div><span>Current plan</span><strong>{plan.name}</strong></div>
                      <div><span>Status</span><strong>{usage?.subscriptionStatus || (usage?.accessSource === 'beta' ? 'Beta access' : planKey === 'free' ? 'No subscription' : 'Active')}</strong></div>
                      <div><span>Payment method</span><strong>{usage?.accessSource === 'polar' ? 'Managed by Polar' : 'Not connected'}</strong></div>
                    </div>
                    {usage?.accessSource === 'beta' && usage.betaExpiresAt && <p className="dashboard-empty">Beta access {usage.betaExpired ? 'expired' : `ends ${new Date(usage.betaExpiresAt).toLocaleDateString()}`}.</p>}
                    {usage?.accessSource === 'polar' ? (
                      <button className="qa-card" type="button" onClick={openBillingPortal}><span className="ico"><Sparkles size={18} /></span><span><strong>Manage subscription</strong><span>Update billing details, payment methods, or cancellation in Polar.</span></span><ArrowRight size={16} /></button>
                    ) : (
                      <a className="qa-card" href="/business"><span className="ico"><Sparkles size={18} /></span><span><strong>{usage?.accessSource === 'beta' ? 'Beta workspace' : 'View plans'}</strong><span>{usage?.accessSource === 'beta' ? 'Billing remains disabled during private beta.' : 'Open pricing and checkout pages.'}</span></span><ArrowRight size={16} /></a>
                    )}
                    {actionMessage && <p className="dashboard-empty">{actionMessage}</p>}
                  </article>
                )}
              </div>
            </section>
          )}
        </section>
      </section>
    </SecondaryPageShell>
  )
}
