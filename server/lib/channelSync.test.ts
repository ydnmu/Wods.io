import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { syncChannelSubscription, type ChannelSubscription } from './channelSync'
import { dbError, dbOk, jobVideoMeta, mockJobDatabase, operationValue } from './jobTestSupport'

const videoId = 'dQw4w9WgXcQ'
const secondVideoId = 'abcdefghijk'
const subscription: ChannelSubscription = {
  id: 'channel-1', user_id: 'user-1', channel_id: 'UC-test', channel_name: 'Test channel',
  schedule_frequency: 'hourly', schedule_time: '09:00:00', timezone: 'Europe/Istanbul', auto_summary: false,
  ai_fallback: true, backfill_limit: 0, paused: false, next_run_at: null, last_run_status: 'pending',
  last_run_started_at: null, users: [{ plan: 'business' }],
}
type FailureStage = 'reserve' | 'quota' | 'provider' | 'store' | 'meter' | 'preflight' | 'complete'

function channelHarness(context: TestContext, options: {
  failure?: FailureStage
  quotaWithoutReservation?: boolean
  cleanupFailure?: 'result' | 'throw'
  completionFailure?: boolean
  secondVideo?: boolean
  claimed?: boolean
  speech?: boolean
} = {}) {
  const usage = new Map<string, string>()
  const videos = new Map<string, { status: string; attempts: number }>()
  const events: Array<{ event: string; payload: unknown }> = []
  const runs: Array<Record<string, unknown>> = []
  let providerCalls = 0
  let currentVideo = ''
  let reservationNumber = 0
  let failure = options.failure
  let normalizedSubscription: ChannelSubscription | undefined
  const calls = mockJobDatabase(context, (request) => {
    if (request.kind === 'rpc') {
      switch (request.name) {
        case 'claim_channel_sync': return dbOk(options.claimed ?? true)
        case 'claim_channel_video': {
          currentVideo = String(request.parameters.p_video_id)
          const previous = videos.get(currentVideo)
          if (previous?.status === 'completed') return dbOk([])
          videos.set(currentVideo, { status: 'processing', attempts: (previous?.attempts ?? 0) + 1 })
          return dbOk([{ processed_video_id: `processed-${currentVideo}`, claim_token: 'claim-token' }])
        }
        case 'reserve_transcript_usage':
          if (failure === 'reserve' && currentVideo === videoId) return dbError('reservation_unavailable')
          if (options.quotaWithoutReservation) return dbOk([{ allowed: false, usage_log_id: null, used: 1000, quota_limit: 1000 }])
          reservationNumber += 1
          usage.set(`reservation-${reservationNumber}`, 'reserved')
          return dbOk([{ allowed: !(failure === 'quota' && currentVideo === videoId), usage_log_id: `reservation-${reservationNumber}`, used: 0, quota_limit: 1000 }])
        case 'reserve_transcript_hours':
          if (failure === 'meter' && currentVideo === videoId) return dbError('meter_unavailable')
          return dbOk([{ allowed: !(failure === 'preflight' && currentVideo === videoId), billable_seconds: 45 }])
        case 'complete_channel_video':
          if (failure === 'complete' && currentVideo === videoId) return dbError('completion_unavailable')
          usage.set(String(request.parameters.p_usage_log_id), 'success')
          videos.get(currentVideo)!.status = 'completed'
          return dbOk()
        case 'fail_channel_video':
          assert.equal(request.parameters.p_claim_token, 'claim-token')
          if (options.cleanupFailure === 'throw') throw new Error('cleanup_transport_failed')
          if (options.cleanupFailure === 'result') return dbError('cleanup_unavailable')
          if (request.parameters.p_usage_log_id) usage.set(String(request.parameters.p_usage_log_id), 'error')
          videos.get(currentVideo)!.status = 'failed'
          return dbOk()
        default: throw new Error(`Unexpected RPC: ${request.name}`)
      }
    }
    if (request.name === 'transcripts') {
      return failure === 'store' && currentVideo === videoId ? dbError('store_unavailable') : dbOk()
    }
    if (request.name === 'channel_subscriptions') {
      runs.push(operationValue(request, 'update') as Record<string, unknown>)
      return options.completionFailure ? dbError('run_store_unavailable') : dbOk()
    }
    if (request.name === 'usage_logs') return dbOk()
    throw new Error(`Unexpected table: ${request.name}`)
  })
  const dependencies: NonNullable<Parameters<typeof syncChannelSubscription>[2]> = {
    fetchChannelVideos: async (current) => {
      normalizedSubscription = current
      return [{ videoId, title: 'Test' }, ...(options.secondVideo ? [{ videoId: secondVideoId, title: 'Second' }] : [])]
    },
    fetchVideoMeta: async (id) => jobVideoMeta(id),
    fetchCaptions: async () => {
      providerCalls += 1
      if (failure === 'provider' && currentVideo === videoId) throw new Error('provider_unavailable')
      return [{ text: 'Caption transcript', start: 0, duration: 45 }]
    },
    fetchTranscriptWithFallback: async (_id, _plan, fallback) => {
      providerCalls += 1
      if (failure === 'provider' && currentVideo === videoId) throw new Error('provider_unavailable')
      if (failure === 'preflight' && currentVideo === videoId) await fallback?.beforeAiFallback?.(45)
      const segments = [{ text: 'Transcript', start: 0, duration: 45 }]
      return options.speech
        ? { segments, captionSource: 'speech_to_text', speechProvider: 'groq', speechProviders: ['groq'], aiFallbackSeconds: 45 }
        : { segments, captionSource: 'youtube' }
    },
    generateTranscriptSummary: async () => { throw new Error('unexpected_summary_call') },
    fireEvent: async (_userId, event, payload) => { events.push({ event, payload }) },
  }
  return {
    calls, videos, usage, events, runs, dependencies, providerCalls: () => providerCalls,
    clearFailure: () => { failure = undefined }, normalizedSubscription: () => normalizedSubscription,
  }
}

for (const stage of ['reserve', 'quota', 'provider', 'store', 'meter', 'preflight', 'complete'] as const) {
  test(`channel ${stage} failure awaits fail RPC and releases the same reservation`, async (context) => {
    const harness = channelHarness(context, { failure: stage })
    assert.deepEqual(await syncChannelSubscription(subscription, {}, harness.dependencies), { claimed: true, processed: 0, failed: 1 })
    const failures = harness.calls.filter((call) => call.name === 'fail_channel_video')
    assert.equal(failures.length, 1)
    assert.equal(failures[0].parameters.p_processed_video_id, `processed-${videoId}`)
    assert.equal(failures[0].parameters.p_usage_log_id, stage === 'reserve' ? null : 'reservation-1')
    assert.equal(harness.videos.get(videoId)?.status, 'failed')
    if (stage !== 'reserve') assert.equal(harness.usage.get('reservation-1'), 'error')
    assert.equal(harness.runs.at(-1)?.last_run_status, 'failed')
    assert.equal(harness.runs.at(-1)?.last_run_failed, 1)
    assert.deepEqual(harness.events, [])
    if (stage === 'quota' || stage === 'reserve') assert.equal(harness.providerCalls(), 0)
  })
}

test('channel quota denial without a reservation fails the video and stops the run', async (context) => {
  const harness = channelHarness(context, { quotaWithoutReservation: true, secondVideo: true })
  assert.deepEqual(await syncChannelSubscription(subscription, {}, harness.dependencies), { claimed: true, processed: 0, failed: 1 })
  const failures = harness.calls.filter((call) => call.name === 'fail_channel_video')
  assert.equal(failures.length, 1)
  assert.equal(failures[0].parameters.p_usage_log_id, null)
  assert.equal(failures[0].parameters.p_error, 'quota_exceeded')
  assert.equal(harness.calls.filter((call) => call.name === 'claim_channel_video').length, 1)
  assert.equal(harness.videos.get(videoId)?.status, 'failed')
  assert.equal(harness.usage.size, 0)
  assert.equal(harness.providerCalls(), 0)
})

for (const cleanupFailure of ['result', 'throw'] as const) {
  test(`channel cleanup ${cleanupFailure} failure rejects and persists a failed run`, async (context) => {
    const harness = channelHarness(context, { failure: 'provider', cleanupFailure, secondVideo: true })
    await assert.rejects(syncChannelSubscription(subscription, {}, harness.dependencies), (error: unknown) => {
      assert.ok(error instanceof AggregateError)
      assert.match(error.message, /channel_video_failure_cleanup_failed/)
      assert.equal(error.errors[0].message, 'provider_unavailable')
      assert.match((error.cause as Error).message, /cleanup_/)
      return true
    })
    assert.equal(harness.calls.filter((call) => call.name === 'fail_channel_video').length, 1)
    assert.equal(harness.usage.get('reservation-1'), 'reserved')
    assert.equal(harness.videos.get(videoId)?.status, 'processing')
    assert.equal(harness.videos.has(secondVideoId), false)
    assert.equal(harness.runs.at(-1)?.last_run_status, 'failed')
    assert.match(String(harness.runs.at(-1)?.last_run_error), /failure_cleanup_failed/)
    assert.deepEqual(harness.events, [])
  })
}

test('channel quota denial cleans up once and stops fetching later videos', async (context) => {
  const harness = channelHarness(context, { failure: 'quota', secondVideo: true })
  await syncChannelSubscription(subscription, {}, harness.dependencies)
  assert.equal(harness.calls.filter((call) => call.name === 'claim_channel_video').length, 1)
  assert.equal(harness.calls.filter((call) => call.name === 'fail_channel_video').length, 1)
  assert.equal(harness.providerCalls(), 0)
})

test('channel metadata failure waits for in-flight fallback before releasing its reservation', { timeout: 5000 }, async (context) => {
  const harness = channelHarness(context)
  let releaseProvider!: () => void
  let providerEntered!: () => void
  const waitingProvider = new Promise<void>((resolve) => { releaseProvider = resolve })
  const providerStarted = new Promise<void>((resolve) => { providerEntered = resolve })
  const pass = syncChannelSubscription(subscription, {}, {
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
  assert.equal(harness.calls.filter((call) => call.name === 'fail_channel_video').length, 0)
  releaseProvider()
  assert.deepEqual(await pass, { claimed: true, processed: 0, failed: 1 })
  const failure = harness.calls.find((call) => call.name === 'fail_channel_video')!
  assert.equal(failure.parameters.p_usage_log_id, 'reservation-1')
  assert.equal(failure.parameters.p_error, 'metadata_unavailable')
  assert.equal(harness.usage.get('reservation-1'), 'error')
})

test('channel records partial counts when a later video succeeds', async (context) => {
  const harness = channelHarness(context, { failure: 'provider', secondVideo: true })
  assert.deepEqual(await syncChannelSubscription(subscription, {}, harness.dependencies), { claimed: true, processed: 1, failed: 1 })
  assert.equal(harness.runs.at(-1)?.last_run_status, 'partial')
  assert.equal(harness.runs.at(-1)?.last_run_processed, 1)
  assert.equal(harness.runs.at(-1)?.last_run_failed, 1)
  assert.equal(harness.usage.get('reservation-1'), 'error')
  assert.equal(harness.usage.get('reservation-2'), 'success')
  assert.equal(harness.events.length, 1)
})

test('channel failed video can retry with a fresh reservation while completed videos are skipped', async (context) => {
  const harness = channelHarness(context, { failure: 'provider' })
  await syncChannelSubscription(subscription, {}, harness.dependencies)
  harness.clearFailure()
  assert.deepEqual(await syncChannelSubscription(subscription, {}, harness.dependencies), { claimed: true, processed: 1, failed: 0 })
  assert.equal(harness.videos.get(videoId)?.attempts, 2)
  assert.equal(harness.usage.get('reservation-1'), 'error')
  assert.equal(harness.usage.get('reservation-2'), 'success')
  assert.deepEqual(await syncChannelSubscription(subscription, {}, harness.dependencies), { claimed: true, processed: 0, failed: 0 })
  assert.equal(harness.providerCalls(), 2)
  assert.equal(harness.events.length, 1)
})

test('channel run persistence failure rejects instead of returning successful counts', async (context) => {
  const harness = channelHarness(context, { completionFailure: true })
  await assert.rejects(syncChannelSubscription(subscription, {}, harness.dependencies), /channel_run_completion_failed/)
  assert.equal(harness.usage.get('reservation-1'), 'success')
  assert.equal(harness.calls.filter((call) => call.name === 'fail_channel_video').length, 0)
})

test('channel preserves cleanup failure when failed-run persistence also fails', async (context) => {
  const harness = channelHarness(context, { failure: 'provider', cleanupFailure: 'result', completionFailure: true })
  await assert.rejects(syncChannelSubscription(subscription, {}, harness.dependencies), (error: unknown) => {
    assert.ok(error instanceof AggregateError)
    assert.match(error.message, /channel_run_failure_persistence_failed/)
    assert.match(error.errors[0].message, /channel_video_failure_cleanup_failed/)
    assert.match(error.errors[1].message, /channel_run_completion_failed/)
    return true
  })
  assert.equal(harness.usage.get('reservation-1'), 'reserved')
  assert.deepEqual(harness.events, [])
})

test('an unclaimed channel does not reserve usage, run providers, or write counts', async (context) => {
  const harness = channelHarness(context, { claimed: false })
  assert.deepEqual(await syncChannelSubscription(subscription, {}, harness.dependencies), { claimed: false, processed: 0, failed: 0 })
  assert.equal(harness.calls.length, 1)
  assert.equal(harness.runs.length, 0)
  assert.equal(harness.providerCalls(), 0)
})

test('caption-only channel failure follows the same reservation cleanup path', async (context) => {
  const harness = channelHarness(context, { failure: 'provider' })
  await syncChannelSubscription({ ...subscription, ai_fallback: false }, {}, harness.dependencies)
  assert.equal(harness.usage.get('reservation-1'), 'error')
  assert.equal(harness.videos.get(videoId)?.status, 'failed')
})

test('channel normalizes stored schedule values before fetching and scheduling its next run', async (context) => {
  const harness = channelHarness(context)
  const invalidSchedule = { ...subscription, schedule_frequency: 'invalid', schedule_time: '26:90', timezone: 'Not/AZone' } as unknown as ChannelSubscription
  await syncChannelSubscription(invalidSchedule, {}, harness.dependencies)
  assert.equal(harness.normalizedSubscription()?.schedule_frequency, 'daily')
  assert.equal(harness.normalizedSubscription()?.schedule_time, '09:00')
  assert.equal(harness.normalizedSubscription()?.timezone, 'UTC')
  assert.equal(new Date(String(harness.runs.at(-1)?.next_run_at)).toISOString().slice(11, 16), '09:00')
})

test('channel speech transcript retains typed provenance and fallback usage', async (context) => {
  const harness = channelHarness(context, { speech: true })
  await syncChannelSubscription(subscription, {}, harness.dependencies)
  const stored = operationValue(harness.calls.find((call) => call.name === 'transcripts')!, 'upsert') as Record<string, unknown>
  assert.deepEqual(stored.speech_providers, ['groq'])
  assert.equal(stored.ai_fallback_seconds, 45)
  const metered = harness.calls.find((call) => call.name === 'reserve_transcript_hours')!
  assert.equal(metered.parameters.p_route, 'ai_fallback')
  assert.equal(metered.parameters.p_source_seconds, 45)
  assert.equal(harness.usage.get('reservation-1'), 'success')
})
