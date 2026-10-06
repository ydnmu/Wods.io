import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { processPendingBatchItems } from './batch'
import { dbError, dbOk, jobVideoMeta, mockJobDatabase, operationValue } from '../lib/jobTestSupport'

const videoId = 'dQw4w9WgXcQ'
const oldDate = new Date(Date.now() - 60 * 60_000).toISOString()
type FailureStage = 'reserve' | 'quota' | 'provider' | 'store' | 'meter' | 'preflight' | 'complete'

function batchHarness(context: TestContext, options: {
  failure?: FailureStage
  quotaWithoutReservation?: boolean
  cleanupFailure?: 'result' | 'throw'
  queryFailure?: 'staleRead' | 'staleUsage' | 'recovery' | 'countsRead' | 'countsUpdate'
  staleAttempts?: number
  pendingSibling?: boolean
  refreshLease?: boolean
} = {}) {
  const item = {
    id: 'item-1', url: `https://youtu.be/${videoId}`, status: options.staleAttempts == null ? 'pending' : 'processing',
    attempts: options.staleAttempts ?? 0, batch_job_id: 'job-1', batch_jobs: { user_id: 'user-1' },
    updated_at: options.staleAttempts == null ? new Date().toISOString() : oldDate, claim_token: null as string | null,
  }
  const usage = new Map<string, string>()
  if (options.staleAttempts != null) {
    usage.set('old-reservation', 'reserved')
    usage.set('fresh-reservation', 'reserved')
  }
  let counts: Record<string, unknown> | undefined
  const events: string[] = []
  let providerCalls = 0
  const calls = mockJobDatabase(context, (request) => {
    if (request.kind === 'rpc') {
      switch (request.name) {
        case 'claim_next_batch_item':
          if (item.status !== 'pending') return dbOk([])
          item.status = 'processing'
          item.attempts += 1
          item.claim_token = 'worker-token'
          return dbOk([{ item_id: item.id, job_id: 'job-1', user_id: 'user-1', item_url: item.url, user_plan: 'business', worker_token: item.claim_token }])
        case 'reserve_transcript_usage':
          if (options.failure === 'reserve') return dbError('reservation_unavailable')
          if (options.quotaWithoutReservation) return dbOk([{ allowed: false, usage_log_id: null, used: 1000, quota_limit: 1000 }])
          usage.set('reservation-1', 'reserved')
          return dbOk([{ allowed: options.failure !== 'quota', usage_log_id: 'reservation-1', used: 0, quota_limit: 1000 }])
        case 'reserve_transcript_hours':
          if (options.failure === 'meter') return dbError('meter_unavailable')
          return dbOk([{ allowed: options.failure !== 'preflight', billable_seconds: 45 }])
        case 'complete_batch_item':
          assert.equal(request.parameters.p_usage_log_id, 'reservation-1')
          if (options.failure === 'complete') return dbError('completion_unavailable')
          usage.set('reservation-1', 'success')
          item.status = 'completed'
          return dbOk()
        case 'fail_batch_item':
          assert.equal(request.parameters.p_worker_token, 'worker-token')
          if (options.cleanupFailure === 'throw') throw new Error('cleanup_transport_failed')
          if (options.cleanupFailure === 'result') return dbError('cleanup_unavailable')
          if (request.parameters.p_usage_log_id) usage.set(String(request.parameters.p_usage_log_id), 'error')
          item.status = 'failed'
          item.claim_token = null
          return dbOk()
        default: throw new Error(`Unexpected RPC: ${request.name}`)
      }
    }
    switch (request.name) {
      case 'batch_items': {
        const update = operationValue(request, 'update') as Record<string, unknown> | undefined
        if (update) {
          if (options.queryFailure === 'recovery') return dbError('recovery_unavailable')
          assert.ok(request.operations.some((operation) => operation.method === 'lt' && operation.args[0] === 'updated_at'))
          if (options.refreshLease) return dbOk([])
          Object.assign(item, update)
          return dbOk([{ id: item.id }])
        }
        if (operationValue(request, 'select') === 'status') {
          if (options.queryFailure === 'countsRead') return dbError('counts_unavailable')
          return dbOk([{ status: item.status }, ...(options.pendingSibling ? [{ status: 'pending' }] : [])])
        }
        if (options.queryFailure === 'staleRead') return dbError('stale_unavailable')
        return dbOk(options.staleAttempts == null ? [] : [{ ...item }])
      }
      case 'usage_logs':
        if (operationValue(request, 'update')) {
          if (options.queryFailure === 'staleUsage') return dbError('stale_usage_unavailable')
          assert.ok(request.operations.some((operation) => operation.method === 'eq' && operation.args[0] === 'status' && operation.args[1] === 'reserved'))
          const cutoff = request.operations.find((operation) => operation.method === 'lt' && operation.args[0] === 'created_at')?.args[1]
          assert.ok(String(cutoff) > oldDate && String(cutoff) < new Date().toISOString())
          usage.set('old-reservation', 'error')
        }
        return dbOk()
      case 'batch_jobs':
        if (options.queryFailure === 'countsUpdate') return dbError('counts_update_unavailable')
        counts = operationValue(request, 'update') as Record<string, unknown>
        return dbOk({ id: 'job-1' })
      case 'transcripts':
        return options.failure === 'store' ? dbError('store_unavailable') : dbOk()
      default: throw new Error(`Unexpected table: ${request.name}`)
    }
  })
  const dependencies: NonNullable<Parameters<typeof processPendingBatchItems>[1]> = {
    fetchVideoMeta: async () => jobVideoMeta(videoId),
    fetchTranscriptWithFallback: async (_videoId, _plan, fallback) => {
      providerCalls += 1
      if (options.failure === 'provider') throw new Error('provider_unavailable')
      if (options.failure === 'preflight') await fallback?.beforeAiFallback?.(45)
      return { segments: [{ text: 'Test transcript', start: 0, duration: 45 }], captionSource: 'youtube' }
    },
    recordPublicTranscriptMetric: async () => ({ transcriptCount: 1, averageResponseMs: 1 }),
    fireEvent: async (_userId, event) => { events.push(event) },
  }
  return { calls, item, usage, events, dependencies, counts: () => counts, providerCalls: () => providerCalls }
}

for (const stage of ['reserve', 'quota', 'provider', 'store', 'meter', 'preflight', 'complete'] as const) {
  test(`batch ${stage} failure awaits fail RPC and preserves its reservation`, async (context) => {
    const harness = batchHarness(context, { failure: stage })
    assert.equal(await processPendingBatchItems(1, harness.dependencies), 1)
    const failures = harness.calls.filter((call) => call.name === 'fail_batch_item')
    assert.equal(failures.length, 1)
    assert.equal(failures[0].parameters.p_usage_log_id, stage === 'reserve' ? null : 'reservation-1')
    assert.equal(harness.item.status, 'failed')
    if (stage !== 'reserve') assert.equal(harness.usage.get('reservation-1'), 'error')
    assert.equal(harness.counts()?.failed, 1)
    assert.equal(harness.counts()?.completed, 0)
    assert.equal(harness.counts()?.status, 'completed')
    assert.deepEqual(harness.events, ['batch.completed'])
    if (stage === 'quota' || stage === 'reserve') assert.equal(harness.providerCalls(), 0)
  })
}

test('batch quota denial without a reservation still fails its claimed item', async (context) => {
  const harness = batchHarness(context, { quotaWithoutReservation: true })
  assert.equal(await processPendingBatchItems(1, harness.dependencies), 1)
  const failures = harness.calls.filter((call) => call.name === 'fail_batch_item')
  assert.equal(failures.length, 1)
  assert.equal(failures[0].parameters.p_usage_log_id, null)
  assert.equal(failures[0].parameters.p_error, 'quota_exceeded')
  assert.equal(harness.item.status, 'failed')
  assert.equal(harness.usage.size, 0)
  assert.equal(harness.providerCalls(), 0)
})

for (const cleanupFailure of ['result', 'throw'] as const) {
  test(`batch cleanup ${cleanupFailure} failure rejects without counts or success events`, async (context) => {
    const harness = batchHarness(context, { failure: 'provider', cleanupFailure })
    await assert.rejects(processPendingBatchItems(1, harness.dependencies), (error: unknown) => {
      assert.ok(error instanceof AggregateError)
      assert.match(error.message, /batch_failure_cleanup_failed/)
      assert.equal(error.errors[0].message, 'provider_unavailable')
      assert.match((error.cause as Error).message, /cleanup_/)
      return true
    })
    assert.equal(harness.calls.filter((call) => call.name === 'fail_batch_item').length, 1)
    assert.equal(harness.usage.get('reservation-1'), 'reserved')
    assert.equal(harness.item.status, 'processing')
    assert.equal(harness.counts(), undefined)
    assert.deepEqual(harness.events, [])
  })
}

test('batch failure keeps a job processing while another item is pending', async (context) => {
  const harness = batchHarness(context, { failure: 'provider', pendingSibling: true })
  await processPendingBatchItems(1, harness.dependencies)
  assert.equal(harness.counts()?.status, 'processing')
  assert.equal(harness.counts()?.completion_notified, false)
  assert.deepEqual(harness.events, [])
})

test('batch metadata failure waits for in-flight fallback before releasing its reservation', { timeout: 5000 }, async (context) => {
  const harness = batchHarness(context)
  let releaseProvider!: () => void
  let providerEntered!: () => void
  const waitingProvider = new Promise<void>((resolve) => { releaseProvider = resolve })
  const providerStarted = new Promise<void>((resolve) => { providerEntered = resolve })
  const pass = processPendingBatchItems(1, {
    ...harness.dependencies,
    fetchVideoMeta: async () => { throw new Error('metadata_unavailable') },
    fetchTranscriptWithFallback: async (_id, _plan, fallback) => {
      providerEntered()
      await waitingProvider
      await fallback?.beforeAiFallback?.(45)
      assert.equal(harness.usage.get('reservation-1'), 'reserved')
      return { segments: [{ text: 'Test', start: 0, duration: 45 }], captionSource: 'youtube' }
    },
  })
  await providerStarted
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(harness.calls.filter((call) => call.name === 'fail_batch_item').length, 0)
  releaseProvider()
  assert.equal(await pass, 1)
  const failure = harness.calls.find((call) => call.name === 'fail_batch_item')!
  assert.equal(failure.parameters.p_usage_log_id, 'reservation-1')
  assert.equal(failure.parameters.p_error, 'metadata_unavailable')
  assert.equal(harness.usage.get('reservation-1'), 'error')
})

test('stale batch item retries below three attempts and clears only its old reservation', async (context) => {
  const harness = batchHarness(context, { staleAttempts: 2 })
  assert.equal(await processPendingBatchItems(1, harness.dependencies), 1)
  assert.equal(harness.item.attempts, 3)
  assert.equal(harness.item.status, 'completed')
  assert.equal(harness.usage.get('old-reservation'), 'error')
  assert.equal(harness.usage.get('fresh-reservation'), 'reserved')
  assert.equal(harness.usage.get('reservation-1'), 'success')
  assert.equal(harness.counts()?.completed, 1)
  assert.equal(harness.counts()?.failed, 0)
})

test('stale batch item stops retrying at three attempts and updates failure counts', async (context) => {
  const harness = batchHarness(context, { staleAttempts: 3 })
  assert.equal(await processPendingBatchItems(1, harness.dependencies), 0)
  assert.equal(harness.item.attempts, 3)
  assert.equal(harness.item.status, 'failed')
  assert.equal(harness.providerCalls(), 0)
  assert.equal(harness.usage.get('old-reservation'), 'error')
  assert.equal(harness.counts()?.failed, 1)
  assert.deepEqual(harness.events, ['batch.completed'])
})

test('stale recovery does not overwrite a refreshed lease or update its job counts', async (context) => {
  const harness = batchHarness(context, { staleAttempts: 2, refreshLease: true })
  assert.equal(await processPendingBatchItems(1, harness.dependencies), 0)
  assert.equal(harness.item.status, 'processing')
  assert.equal(harness.counts(), undefined)
  assert.equal(harness.providerCalls(), 0)
})

for (const queryFailure of ['staleRead', 'staleUsage', 'recovery', 'countsRead', 'countsUpdate'] as const) {
  test(`batch ${queryFailure} query failure is not reported as a successful pass`, async (context) => {
    const harness = batchHarness(context, { queryFailure, staleAttempts: 3 })
    await assert.rejects(processPendingBatchItems(1, harness.dependencies), /batch_.*_failed/)
    assert.equal(harness.providerCalls(), 0)
    assert.deepEqual(harness.events, [])
  })
}

test('batch waits for the other worker to drain before reporting cleanup failure', { timeout: 5000 }, async (context) => {
  const previousConcurrency = process.env.BATCH_WORKER_CONCURRENCY
  process.env.BATCH_WORKER_CONCURRENCY = '2'
  context.after(() => {
    if (previousConcurrency == null) delete process.env.BATCH_WORKER_CONCURRENCY
    else process.env.BATCH_WORKER_CONCURRENCY = previousConcurrency
  })
  let releaseProvider!: () => void
  let providerEntered!: () => void
  const waitingProvider = new Promise<void>((resolve) => { releaseProvider = resolve })
  const providerStarted = new Promise<void>((resolve) => { providerEntered = resolve })
  let claims = 0
  let completed = false
  const calls = mockJobDatabase(context, (request) => {
    if (request.kind === 'rpc') {
      if (request.name === 'claim_next_batch_item') {
        claims += 1
        return dbOk([{ item_id: `item-${claims}`, job_id: 'job-1', user_id: 'user-1', item_url: `https://youtu.be/${claims === 1 ? videoId : 'abcdefghijk'}`, user_plan: 'business', worker_token: `token-${claims}` }])
      }
      if (request.name === 'reserve_transcript_usage') return dbOk([{ allowed: true, usage_log_id: `usage-${request.parameters.p_video_id}` }])
      if (request.name === 'reserve_transcript_hours') return dbOk([{ allowed: true, billable_seconds: 45 }])
      if (request.name === 'fail_batch_item') return dbError('cleanup_unavailable')
      if (request.name === 'complete_batch_item') {
        completed = true
        return dbOk()
      }
      throw new Error(`Unexpected RPC: ${request.name}`)
    }
    if (request.name === 'batch_items') return dbOk(operationValue(request, 'select') === 'status' ? [{ status: 'processing' }, { status: 'completed' }] : [])
    if (request.name === 'batch_jobs') return dbOk({ id: 'job-1' })
    if (request.name === 'transcripts') return dbOk()
    throw new Error(`Unexpected table: ${request.name}`)
  })
  const dependencies: NonNullable<Parameters<typeof processPendingBatchItems>[1]> = {
    fetchVideoMeta: async (id) => jobVideoMeta(id),
    fetchTranscriptWithFallback: async (id) => {
      if (id === videoId) throw new Error('provider_unavailable')
      providerEntered()
      await waitingProvider
      return { segments: [{ text: 'Test', start: 0, duration: 45 }], captionSource: 'youtube' }
    },
    recordPublicTranscriptMetric: async () => ({ transcriptCount: 1, averageResponseMs: 1 }),
    fireEvent: async () => undefined,
  }
  let settled = false
  const pass = processPendingBatchItems(2, dependencies)
  void pass.then(() => { settled = true }, () => { settled = true })
  await providerStarted
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(calls.filter((call) => call.name === 'fail_batch_item').length, 1)
  assert.equal(settled, false)
  assert.equal(completed, false)
  releaseProvider()
  await assert.rejects(pass, /batch_failure_cleanup_failed/)
  assert.equal(completed, true)
  assert.equal(calls.filter((call) => call.name === 'complete_batch_item').length, 1)
})
