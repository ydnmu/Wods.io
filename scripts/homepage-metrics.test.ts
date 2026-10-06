import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HomepageMetrics, METRICS_SNAPSHOT_KEY, PENDING_METRICS_KEY } from '../src/lib/homepageMetrics'
import type { PublicTranscriptMetrics } from '../src/lib/publicMetrics'

const initial: PublicTranscriptMetrics = { transcriptCount: 21, averageResponseMs: 2400 }
const latest: PublicTranscriptMetrics = { transcriptCount: 47, averageResponseMs: 2300 }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const storage = () => {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) } }
}
const fixture = () => {
  let backend: unknown = initial
  const memory = storage()
  const fetcher = (async () => Response.json(backend)) as typeof fetch
  const session = new HomepageMetrics({ homeVisible: true, storage: memory, fetcher })
  session.attach()
  return { session, memory, fetcher, setBackend: (value: unknown) => { backend = value } }
}

test('initial reads and ordinary refreshes never animate', async () => {
  const f = fixture()
  await f.session.refreshMetrics()
  assert.deepEqual(f.session.getSnapshot(), { metrics: initial, refresh: null })
  f.setBackend(latest)
  await f.session.refreshMetrics()
  assert.deepEqual(f.session.getSnapshot(), { metrics: latest, refresh: null })
  f.session.detach()
})

test('ordinary route remount retains the visible values while the backend refresh is delayed', async () => {
  const f = fixture()
  await f.session.refreshMetrics()
  f.session.detach()
  let releaseRead!: () => void
  const gate = new Promise<void>(resolve => { releaseRead = resolve })
  const delayedFetch = (async () => { await gate; return Response.json(latest) }) as typeof fetch
  const returning = new HomepageMetrics({ homeVisible: true, storage: f.memory, fetcher: delayedFetch })
  returning.attach()
  const refresh = returning.refreshMetrics()
  await tick()
  assert.deepEqual(returning.getSnapshot(), { metrics: initial, refresh: null })
  releaseRead()
  await refresh
  assert.deepEqual(returning.getSnapshot(), { metrics: latest, refresh: null })
  returning.detach()
  const nextVisit = new HomepageMetrics({ homeVisible: true, storage: f.memory, fetcher: f.fetcher })
  assert.deepEqual(nextVisit.getSnapshot(), { metrics: latest, refresh: null })
})

test('a transient backend failure on return preserves the cached paragraph values', async () => {
  const f = fixture()
  await f.session.refreshMetrics()
  f.session.detach()
  const fetcher = (async () => { throw new Error('Offline') }) as typeof fetch
  const returning = new HomepageMetrics({ homeVisible: true, storage: f.memory, fetcher })
  returning.attach()
  await returning.refreshMetrics()
  assert.deepEqual(returning.getSnapshot(), { metrics: initial, refresh: null })
  returning.detach()
})

test('invalid cached values do not prevent authoritative initial metrics from loading', async () => {
  const f = fixture()
  f.memory.setItem(METRICS_SNAPSHOT_KEY, JSON.stringify({ transcriptCount: -1, averageResponseMs: 2400 }))
  const session = new HomepageMetrics({ homeVisible: true, storage: f.memory, fetcher: f.fetcher })
  assert.equal(session.getSnapshot().metrics, null)
  session.attach()
  await session.refreshMetrics()
  assert.deepEqual(session.getSnapshot(), { metrics: initial, refresh: null })
  session.detach()
  f.memory.setItem(METRICS_SNAPSHOT_KEY, '{broken')
  assert.equal(new HomepageMetrics({ homeVisible: true, storage: f.memory }).getSnapshot().metrics, null)
  f.session.detach()
})

test('success freezes the visible snapshot until return and uses authoritative values, not +1', async () => {
  const f = fixture()
  await f.session.refreshMetrics()
  f.session.hold()
  f.setBackend(latest)
  await f.session.refreshMetrics()
  assert.deepEqual(f.session.getSnapshot().metrics, initial)
  f.session.completed()
  await tick()
  assert.deepEqual(f.session.getSnapshot(), { metrics: initial, refresh: null })
  assert.ok(f.memory.getItem(PENDING_METRICS_KEY))
  f.session.returnHome()
  await tick()
  assert.deepEqual(f.session.getSnapshot().metrics, latest)
  assert.deepEqual(f.session.getSnapshot().refresh?.previous, initial)
  assert.equal(f.memory.getItem(PENDING_METRICS_KEY), null)
  f.session.detach()
})

test('failed or cancelled work returns without a ticker', async () => {
  const f = fixture()
  await f.session.refreshMetrics()
  f.session.hold()
  f.setBackend(latest)
  f.session.returnHome()
  await tick()
  assert.deepEqual(f.session.getSnapshot(), { metrics: latest, refresh: null })
  assert.equal(f.memory.getItem(PENDING_METRICS_KEY), null)
  f.session.detach()
})

test('unchanged success consumes the pending refresh without animating', async () => {
  const f = fixture()
  await f.session.refreshMetrics()
  f.session.completed()
  f.session.returnHome()
  await tick()
  assert.deepEqual(f.session.getSnapshot(), { metrics: initial, refresh: null })
  assert.equal(f.memory.getItem(PENDING_METRICS_KEY), null)
  f.session.detach()
})

test('pending snapshot survives unmount, and consuming it prevents reload replay', async () => {
  const f = fixture()
  await f.session.refreshMetrics()
  f.session.completed()
  f.session.detach()
  f.setBackend(latest)
  const resultSession = new HomepageMetrics({ homeVisible: false, storage: f.memory, fetcher: f.fetcher })
  resultSession.attach()
  await resultSession.refreshMetrics()
  assert.deepEqual(resultSession.getSnapshot().metrics, initial)
  resultSession.returnHome()
  await tick()
  assert.ok(resultSession.getSnapshot().refresh)
  resultSession.detach()
  const reload = new HomepageMetrics({ homeVisible: true, storage: f.memory, fetcher: f.fetcher })
  reload.attach()
  await reload.refreshMetrics()
  assert.deepEqual(reload.getSnapshot(), { metrics: latest, refresh: null })
  reload.detach()
})

test('malformed metric response keeps the old snapshot and pending flag for a real retry', async () => {
  const f = fixture()
  await f.session.refreshMetrics()
  f.session.completed()
  f.setBackend({})
  f.session.returnHome()
  await tick()
  assert.deepEqual(f.session.getSnapshot(), { metrics: initial, refresh: null })
  assert.ok(f.memory.getItem(PENDING_METRICS_KEY))
  f.setBackend(latest)
  await f.session.refreshMetrics()
  assert.deepEqual(f.session.getSnapshot().refresh?.previous, initial)
  f.session.detach()
})

test('return after route unmount waits for a pending browser completion write', async () => {
  const memory = storage()
  let backend = initial
  let releaseWrite!: () => void
  const writeGate = new Promise<void>(resolve => { releaseWrite = resolve })
  const requests: RequestInit[] = []
  const fetcher = (async (_url: RequestInfo | URL, options?: RequestInit) => {
    requests.push(options ?? {})
    if (options?.method === 'POST') { await writeGate; backend = latest }
    return Response.json(backend)
  }) as typeof fetch
  const before = new HomepageMetrics({ homeVisible: true, storage: memory, fetcher })
  before.attach()
  await before.refreshMetrics()
  before.completed({ completionId: 'backend-completion', responseMs: 1830 })
  before.detach()
  const after = new HomepageMetrics({ homeVisible: true, storage: memory, fetcher })
  after.attach()
  const refreshing = after.refreshMetrics()
  await tick()
  assert.equal(requests.length, 2)
  assert.equal(requests[1].keepalive, true)
  assert.deepEqual(after.getSnapshot().metrics, initial)
  releaseWrite()
  await refreshing
  assert.deepEqual(after.getSnapshot().metrics, latest)
  assert.deepEqual(after.getSnapshot().refresh?.previous, initial)
  after.detach()
})
