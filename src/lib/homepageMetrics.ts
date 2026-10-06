import { parsePublicTranscriptMetrics, type PublicTranscriptMetrics } from './publicMetrics'

export const PENDING_METRICS_KEY = 'easytran-pending-home-metrics'
export const METRICS_SNAPSHOT_KEY = 'easytran-home-metrics-snapshot'
export type MetricRefresh = { id: number; previous: PublicTranscriptMetrics }
type MetricView = { metrics: PublicTranscriptMetrics | null; refresh: MetricRefresh | null }
type Completion = { completionId: string; responseMs: number }
type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// A browser-side completion write can outlive the homepage route.
let completionWrite: Promise<void> | null = null

export class HomepageMetrics {
  private view: MetricView
  private pendingRefresh = false
  private homeVisible: boolean
  private attached = false
  private generation = 0
  private refreshId = 0
  private controller: AbortController | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private listeners = new Set<() => void>()
  private storage: SessionStorage | null
  private fetcher: typeof fetch

  constructor({ homeVisible, storage, fetcher = (input, init) => fetch(input, init) }: {
    homeVisible: boolean; storage: SessionStorage | null; fetcher?: typeof fetch
  }) {
    this.homeVisible = homeVisible
    this.storage = storage
    this.fetcher = fetcher
    let previous: PublicTranscriptMetrics | null = null
    try {
      previous = parsePublicTranscriptMetrics(JSON.parse(storage?.getItem(METRICS_SNAPSHOT_KEY) || 'null'))
    } catch { /* A missing or invalid snapshot falls back to the backend. */ }
    try {
      const saved = JSON.parse(storage?.getItem(PENDING_METRICS_KEY) || 'null')
      if (saved?.version === 1 && saved.pending === true) {
        previous = parsePublicTranscriptMetrics(saved.snapshot) ?? previous
        this.pendingRefresh = true
      }
    } catch { /* Session storage is optional; the backend is still authoritative. */ }
    this.view = { metrics: previous, refresh: null }
  }

  getSnapshot = () => this.view
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  attach = () => { this.attached = true }
  detach = () => {
    this.attached = false
    this.generation++
    this.controller?.abort()
    clearTimeout(this.refreshTimer)
  }
  hold = () => { this.homeVisible = false }

  private publish(view: MetricView) {
    this.view = view
    this.listeners.forEach(listener => listener())
  }
  private savePending() {
    try {
      this.storage?.setItem(PENDING_METRICS_KEY, JSON.stringify({
        version: 1, pending: true, snapshot: this.view.metrics,
      }))
    } catch { /* Keep the in-memory snapshot if session storage is unavailable. */ }
  }
  private clearPending() {
    this.pendingRefresh = false
    try { this.storage?.removeItem(PENDING_METRICS_KEY) } catch { /* Optional session storage. */ }
  }

  finishRefresh = (id: number) => {
    if (this.view.refresh?.id !== id) return
    clearTimeout(this.refreshTimer)
    this.publish({ metrics: this.view.metrics, refresh: null })
  }

  private commit(next: PublicTranscriptMetrics) {
    const previous = this.view.metrics
    const changed = previous?.transcriptCount !== next.transcriptCount
      || previous?.averageResponseMs !== next.averageResponseMs
    const animate = this.pendingRefresh && previous !== null && changed
    // Restore the last visible values immediately when the homepage remounts.
    try {
      this.storage?.setItem(METRICS_SNAPSHOT_KEY, JSON.stringify(next))
    } catch { /* The visible values remain usable if storage is unavailable. */ }
    this.clearPending()
    // An identical read must not interrupt a ticker that is already running.
    if (!changed) return
    clearTimeout(this.refreshTimer)
    const refresh = animate ? { id: ++this.refreshId, previous } : null
    this.publish({ metrics: next, refresh })
    if (refresh) this.refreshTimer = setTimeout(() => this.finishRefresh(refresh.id), 400)
  }

  private async request(completion?: Completion, prepareOnly = false) {
    this.controller?.abort()
    const controller = completion ? null : new AbortController()
    this.controller = controller
    const generation = ++this.generation
    try {
      const response = await this.fetcher(completion ? '/api/public-metrics/completion' : '/api/public-metrics', {
        signal: controller?.signal,
        cache: 'no-store',
        ...(completion ? { method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(completion) } : {}),
      })
      if (!response.ok || generation !== this.generation) return
      const next = parsePublicTranscriptMetrics(await response.json())
      if (next && generation === this.generation && this.attached && this.homeVisible && !prepareOnly) this.commit(next)
    } catch { /* Preserve the snapshot and pending refresh on transient failures. */ }
  }

  refreshMetrics = async () => {
    // Wait for real completion recording before reading, including across route remounts.
    if (completionWrite) await completionWrite
    if (this.attached) await this.request()
  }
  completed = (completion?: Completion) => {
    this.homeVisible = false
    this.pendingRefresh = true
    this.savePending()
    const preparing = this.request(completion, true)
    if (completion) {
      const barrier = preparing.finally(() => { if (completionWrite === barrier) completionWrite = null })
      completionWrite = barrier
    }
  }
  returnHome = () => {
    this.homeVisible = true
    void this.refreshMetrics()
  }
}
