import { processSpeechAudioChunks, type SpeechAudioChunk } from './audioChunks'
import { normalizePlan } from './plans'
import {
  reserveSpeechProviderBudget,
  type BudgetedSpeechProvider,
} from './speechProviderBudget'
import {
  getSpeechProviderCredential,
  speechProviderConfigured,
} from './speechProviderCredentials'
import type { TranscriptSegment } from './youtube'

export type SpeechProvider = BudgetedSpeechProvider
export type SpeechProviderResult = SpeechProvider | 'mixed'

type SegmentResponse = {
  text?: string
  transcript?: string
  start?: number
  end?: number
  duration?: number
}

type WhisperResponse = {
  text?: string
  duration?: number
  segments?: SegmentResponse[]
}

type AssemblyWord = {
  text?: string
  start?: number
  end?: number
}

type AssemblyResponse = {
  id?: string
  status?: 'queued' | 'processing' | 'completed' | 'error'
  error?: string
  text?: string
  audio_duration?: number
  words?: AssemblyWord[]
}

type WorkerResponse = {
  segments?: SegmentResponse[]
}

type DeepgramResponse = {
  results?: {
    utterances?: SegmentResponse[]
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string
        words?: Array<{
          word?: string
          punctuated_word?: string
          start?: number
          end?: number
        }>
      }>
    }>
  }
}

type CloudflareResponse = {
  success?: boolean
  errors?: Array<{ message?: string }>
  result?: WhisperResponse
}

const timeoutMs = () => Number(process.env.SPEECH_TO_TEXT_TIMEOUT_MS || 600_000)
const providerCooldowns = new Map<SpeechProvider, number>()
const providerInFlight = new Map<SpeechProvider, number>()
let providerDispatchCursor = 0

async function responseError(prefix: string, response: Response) {
  const detail = (await response.text()).trim().slice(0, 500)
  const retryAfter = Number(response.headers.get('retry-after') || 0)
  const error = new Error(`${prefix}_${response.status}${detail ? `: ${detail}` : ''}`)
  Object.assign(error, { status: response.status, retryAfter })
  return error
}

const configuredProvider = speechProviderConfigured

const providerConcurrency = (provider: SpeechProvider) => {
  const defaults: Record<SpeechProvider, number> = {
    // Deepgram was materially faster in the local 10-minute benchmark, so it
    // receives more simultaneous work while the other providers remain active.
    deepgram: 4,
    groq: 2,
    cloudflare: 2,
    assemblyai: 2,
    fireworks: 2,
    worker: 1,
  }
  const configured = Number(process.env[`SPEECH_PROVIDER_CONCURRENCY_${provider.toUpperCase()}`])
  return Math.min(16, Math.max(1, Number.isFinite(configured) ? configured : defaults[provider]))
}

const orderedProvidersForDispatch = (providers: SpeechProvider[]) => {
  if (providers.length < 2) return providers
  const cursor = providerDispatchCursor++ % providers.length
  const rotated = [...providers.slice(cursor), ...providers.slice(0, cursor)]
  return rotated.sort((left, right) => {
    const leftLoad = (providerInFlight.get(left) ?? 0) / providerConcurrency(left)
    const rightLoad = (providerInFlight.get(right) ?? 0) / providerConcurrency(right)
    return leftLoad - rightLoad
  })
}

export function getSpeechProviderPoolSnapshot(plan?: string | null) {
  return getSpeechProviderOrder(plan).map((provider) => ({
    provider,
    active: providerInFlight.get(provider) ?? 0,
    concurrency: providerConcurrency(provider),
    coolingDownUntil: providerCooldowns.get(provider) || null,
  }))
}

const parseProviderOrder = (value: string | undefined, fallback: SpeechProvider[]) => {
  const allowed = new Set<SpeechProvider>([
    'groq',
    'cloudflare',
    'fireworks',
    'deepgram',
    'assemblyai',
    'worker',
  ])
  const parsed = String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is SpeechProvider => allowed.has(item as SpeechProvider))
  return [...new Set(parsed.length ? parsed : fallback)]
}

export function getSpeechProviderOrder(plan?: string | null): SpeechProvider[] {
  const paidPlan = normalizePlan(plan) !== 'free'
  const freeOnly = String(process.env.SPEECH_PROVIDER_FREE_ONLY ?? 'true').toLowerCase() !== 'false'
  const freeDefault: SpeechProvider[] = ['groq', 'cloudflare', 'fireworks', 'deepgram', 'assemblyai', 'worker']
  const paidDefault: SpeechProvider[] = ['worker', 'cloudflare', 'groq', 'fireworks', 'assemblyai', 'deepgram']
  const order = freeOnly
    ? parseProviderOrder(process.env.SPEECH_PROVIDER_ORDER_FREE, freeDefault)
    : paidPlan
      ? parseProviderOrder(process.env.SPEECH_PROVIDER_ORDER_PAID, paidDefault)
      : parseProviderOrder(process.env.SPEECH_PROVIDER_ORDER_FREE, freeDefault)
  return order.filter(configuredProvider)
}

export function hasSpeechToTextProvider(plan?: string | null) {
  return getSpeechProviderOrder(plan).length > 0
}

function normalizeSegments(segments: SegmentResponse[]) {
  return segments.map((segment) => {
    const start = Number(segment.start || 0)
    const duration = Number(segment.duration ?? Math.max(0, Number(segment.end || start) - start))
    return {
      text: String(segment.text || segment.transcript || '').trim(),
      start,
      duration,
    }
  }).filter((segment) => segment.text)
}

function groupWords(words: Array<{ text?: string; start?: number; end?: number }>): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  let group: Array<{ text?: string; start?: number; end?: number }> = []

  const flush = () => {
    if (!group.length) return
    const start = Number(group[0].start || 0)
    const end = Number(group.at(-1)?.end || start)
    segments.push({
      text: group.map((word) => String(word.text || '')).join(' ').replace(/\s+([,.!?;:])/g, '$1').trim(),
      start,
      duration: Math.max(0, end - start),
    })
    group = []
  }

  for (const word of words) {
    group.push(word)
    const text = String(word.text || '')
    const groupStart = Number(group[0].start || 0)
    const groupEnd = Number(word.end || groupStart)
    if (/[.!?]$/.test(text) || group.length >= 30 || groupEnd - groupStart >= 12) flush()
  }
  flush()
  return segments.filter((segment) => segment.text)
}

function groupAssemblyWords(words: AssemblyWord[]) {
  return groupWords(words.map((word) => ({
    text: word.text,
    start: Number(word.start || 0) / 1000,
    end: Number(word.end || 0) / 1000,
  })))
}

async function transcribeWithAssemblyAI(chunk: SpeechAudioChunk) {
  const apiKey = String(getSpeechProviderCredential('assemblyai').apiKey || '')
  const headers = { authorization: apiKey }
  const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { ...headers, 'content-type': chunk.mimeType },
    body: Uint8Array.from(chunk.audio),
    signal: AbortSignal.timeout(timeoutMs()),
  })
  if (!uploadResponse.ok) throw await responseError('assemblyai_upload_failed', uploadResponse)
  const upload = await uploadResponse.json() as { upload_url?: string }
  if (!upload.upload_url) throw new Error('assemblyai_upload_url_missing')

  const submitResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: upload.upload_url,
      speech_models: [process.env.ASSEMBLYAI_MODEL || 'universal-2'],
      language_detection: true,
    }),
    signal: AbortSignal.timeout(timeoutMs()),
  })
  if (!submitResponse.ok) throw await responseError('assemblyai_submit_failed', submitResponse)
  let transcript = await submitResponse.json() as AssemblyResponse
  if (!transcript.id) throw new Error('assemblyai_transcript_id_missing')

  const deadline = Date.now() + timeoutMs()
  while (transcript.status === 'queued' || transcript.status === 'processing') {
    if (Date.now() >= deadline) throw new Error('assemblyai_timeout')
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcript.id}`, {
      headers,
      signal: AbortSignal.timeout(Math.min(30_000, timeoutMs())),
    })
    if (!pollResponse.ok) throw await responseError('assemblyai_poll_failed', pollResponse)
    transcript = await pollResponse.json() as AssemblyResponse
  }

  if (transcript.status === 'error') throw new Error(`assemblyai_failed: ${transcript.error || 'unknown_error'}`)
  const segments = groupAssemblyWords(transcript.words ?? [])
  if (segments.length) return segments
  if (transcript.text?.trim()) {
    return [{ text: transcript.text.trim(), start: 0, duration: Number(transcript.audio_duration || chunk.durationSeconds) }]
  }
  throw new Error('assemblyai_empty')
}

const whisperForm = (chunk: SpeechAudioChunk, model: string) => {
  const form = new FormData()
  const extension = /flac/i.test(chunk.mimeType)
    ? 'flac'
    : /wav/i.test(chunk.mimeType)
      ? 'wav'
      : /webm/i.test(chunk.mimeType)
        ? 'webm'
        : /ogg|opus/i.test(chunk.mimeType)
          ? 'ogg'
          : /mpeg|mp3/i.test(chunk.mimeType)
            ? 'mp3'
            : 'm4a'
  form.set('file', new Blob([Uint8Array.from(chunk.audio)], { type: chunk.mimeType }), `chunk-${chunk.index}.${extension}`)
  form.set('model', model)
  form.set('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  return form
}

async function transcribeWithFireworks(chunk: SpeechAudioChunk) {
  const form = whisperForm(chunk, process.env.FIREWORKS_TRANSCRIPTION_MODEL || 'whisper-v3-turbo')
  form.set('vad_model', 'silero')
  const response = await fetch(
    process.env.FIREWORKS_AUDIO_URL || 'https://audio-turbo.api.fireworks.ai/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: { Authorization: String(getSpeechProviderCredential('fireworks').apiKey || '') },
      body: form,
      signal: AbortSignal.timeout(timeoutMs()),
    },
  )
  if (!response.ok) throw await responseError('fireworks_failed', response)
  return normalizeWhisperPayload(await response.json() as WhisperResponse, chunk.durationSeconds, 'fireworks')
}

async function transcribeWithGroq(chunk: SpeechAudioChunk) {
  const form = whisperForm(chunk, process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo')
  form.set('temperature', '0')
  const response = await fetch(
    process.env.GROQ_AUDIO_URL || 'https://api.groq.com/openai/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${String(getSpeechProviderCredential('groq').apiKey || '')}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs()),
    },
  )
  if (!response.ok) throw await responseError('groq_failed', response)
  return normalizeWhisperPayload(await response.json() as WhisperResponse, chunk.durationSeconds, 'groq')
}

function normalizeWhisperPayload(payload: WhisperResponse, durationSeconds: number, provider: string) {
  const segments = normalizeSegments(payload.segments ?? [])
  if (segments.length) return segments
  if (payload.text?.trim()) {
    return [{ text: payload.text.trim(), start: 0, duration: Number(payload.duration || durationSeconds) }]
  }
  throw new Error(`${provider}_empty`)
}

async function transcribeWithCloudflare(chunk: SpeechAudioChunk) {
  const credential = getSpeechProviderCredential('cloudflare')
  const accountId = String(credential.accountId || '')
  const model = process.env.CLOUDFLARE_TRANSCRIPTION_MODEL || '@cf/openai/whisper-large-v3-turbo'
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(credential.apiKey || '')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio: chunk.audio.toString('base64'),
        task: 'transcribe',
        vad_filter: true,
        condition_on_previous_text: false,
      }),
      signal: AbortSignal.timeout(timeoutMs()),
    },
  )
  if (!response.ok) throw await responseError('cloudflare_failed', response)
  const payload = await response.json() as CloudflareResponse
  if (payload.success === false) {
    throw new Error(`cloudflare_failed: ${payload.errors?.map((error) => error.message).filter(Boolean).join('; ') || 'unknown_error'}`)
  }
  return normalizeWhisperPayload(payload.result ?? {}, chunk.durationSeconds, 'cloudflare')
}

async function transcribeWithDeepgram(chunk: SpeechAudioChunk) {
  const url = new URL(process.env.DEEPGRAM_AUDIO_URL || 'https://api.deepgram.com/v1/listen')
  url.searchParams.set('model', process.env.DEEPGRAM_TRANSCRIPTION_MODEL || 'nova-3')
  url.searchParams.set('smart_format', 'true')
  url.searchParams.set('punctuate', 'true')
  url.searchParams.set('utterances', 'true')
  url.searchParams.set('detect_language', 'true')
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${String(getSpeechProviderCredential('deepgram').apiKey || '')}`,
      'content-type': chunk.mimeType,
    },
    body: Uint8Array.from(chunk.audio),
    signal: AbortSignal.timeout(timeoutMs()),
  })
  if (!response.ok) throw await responseError('deepgram_failed', response)
  const payload = await response.json() as DeepgramResponse
  const utterances = normalizeSegments(payload.results?.utterances ?? [])
  if (utterances.length) return utterances

  const alternative = payload.results?.channels?.[0]?.alternatives?.[0]
  const words = (alternative?.words ?? []).map((word) => ({
    text: word.punctuated_word || word.word,
    start: word.start,
    end: word.end,
  }))
  const segments = groupWords(words)
  if (segments.length) return segments
  if (alternative?.transcript?.trim()) {
    return [{ text: alternative.transcript.trim(), start: 0, duration: chunk.durationSeconds }]
  }
  throw new Error('deepgram_empty')
}

async function transcribeWithWorker(chunk: SpeechAudioChunk, videoId: string) {
  const workerUrl = String(process.env.SPEECH_TO_TEXT_URL || '').replace(/\/$/, '')
  const form = new FormData()
  form.set('file', new Blob([Uint8Array.from(chunk.audio)], { type: chunk.mimeType }), `${videoId}-${chunk.index}.audio`)
  form.set('model', process.env.SPEECH_TO_TEXT_MODEL || 'turbo')
  form.set('vad_filter', 'true')
  form.set('word_timestamps', 'false')

  const response = await fetch(`${workerUrl}/transcribe`, {
    method: 'POST',
    headers: getSpeechProviderCredential('worker').apiKey
      ? { Authorization: `Bearer ${getSpeechProviderCredential('worker').apiKey}` }
      : undefined,
    body: form,
    signal: AbortSignal.timeout(timeoutMs()),
  })
  if (!response.ok) throw await responseError('speech_to_text_failed', response)
  const payload = await response.json() as WorkerResponse
  const segments = normalizeSegments(payload.segments ?? [])
  if (!segments.length) throw new Error('speech_to_text_empty')
  return segments
}

async function runProvider(provider: SpeechProvider, chunk: SpeechAudioChunk, videoId: string) {
  switch (provider) {
    case 'assemblyai':
      return transcribeWithAssemblyAI(chunk)
    case 'fireworks':
      return transcribeWithFireworks(chunk)
    case 'groq':
      return transcribeWithGroq(chunk)
    case 'cloudflare':
      return transcribeWithCloudflare(chunk)
    case 'deepgram':
      return transcribeWithDeepgram(chunk)
    case 'worker':
      return transcribeWithWorker(chunk, videoId)
  }
}

const providerAvailableNow = (provider: SpeechProvider) =>
  (providerCooldowns.get(provider) ?? 0) <= Date.now()

function markProviderFailure(provider: SpeechProvider, error: unknown) {
  const status = Number((error as { status?: number })?.status || 0)
  const retryAfter = Number((error as { retryAfter?: number })?.retryAfter || 0)
  const cooldownMs = retryAfter > 0
    ? retryAfter * 1_000
    : status === 429
      ? 60_000
      : status >= 500
        ? 20_000
        : 5_000
  providerCooldowns.set(provider, Date.now() + Math.min(cooldownMs, 10 * 60_000))
}

async function transcribeChunkWithFallback(
  chunk: SpeechAudioChunk,
  providers: SpeechProvider[],
  videoId: string,
) {
  const errors: string[] = []
  const capacityDeadline = Date.now() + 60_000
  while (true) {
    let temporarilyUnavailable = false
    for (const provider of orderedProvidersForDispatch(providers)) {
      if (!providerAvailableNow(provider)) {
        temporarilyUnavailable = true
        continue
      }

      const active = providerInFlight.get(provider) ?? 0
      if (active >= providerConcurrency(provider)) {
        temporarilyUnavailable = true
        continue
      }
      providerInFlight.set(provider, active + 1)

      const lease = await reserveSpeechProviderBudget(provider, chunk.durationSeconds).catch((error) => {
        providerInFlight.set(provider, Math.max(0, (providerInFlight.get(provider) ?? 1) - 1))
        throw error
      })
      if (!lease) {
        providerInFlight.set(provider, Math.max(0, (providerInFlight.get(provider) ?? 1) - 1))
        errors.push(`${provider}_free_budget_exhausted`)
        continue
      }

      try {
        const segments = await runProvider(provider, chunk, videoId)
        await lease.release('success')
        providerCooldowns.delete(provider)
        return { segments, provider }
      } catch (error) {
        await lease.release('error').catch(() => undefined)
        markProviderFailure(provider, error)
        errors.push(error instanceof Error ? error.message : `${provider}_failed`)
        temporarilyUnavailable = true
      } finally {
        providerInFlight.set(provider, Math.max(0, (providerInFlight.get(provider) ?? 1) - 1))
      }
    }
    if (!temporarilyUnavailable || Date.now() >= capacityDeadline) break
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error([...new Set(errors)].join('; ') || 'no_speech_provider_available')
}

export async function transcribeAudio(params: {
  audio?: Buffer
  audioPath?: string
  mimeType: string
  videoId: string
  plan?: string | null
  durationSeconds?: number
}): Promise<{
  segments: TranscriptSegment[]
  provider: SpeechProviderResult
  providers: SpeechProvider[]
  audioSeconds: number
}> {
  const providers = getSpeechProviderOrder(params.plan)
  if (!providers.length) throw new Error('speech_to_text_not_configured')

  const durationSeconds = Math.max(1, Number(params.durationSeconds || 0))
  const segments: TranscriptSegment[] = []
  const usedProviders: SpeechProvider[] = []
  const errors: string[] = []
  let audioSeconds = 0
  await processSpeechAudioChunks({
    audio: params.audio,
    audioPath: params.audioPath,
    mimeType: params.mimeType,
    durationSeconds,
    videoId: params.videoId,
  }, async (chunk) => {
    try {
      const result = await transcribeChunkWithFallback(chunk, providers, params.videoId)
      usedProviders.push(result.provider)
      audioSeconds += chunk.durationSeconds
      segments.push(...result.segments.map((segment) => ({
        ...segment,
        start: segment.start + chunk.offsetSeconds,
      })))
    } catch (error) {
      errors.push(`chunk_${chunk.index}: ${error instanceof Error ? error.message : 'failed'}`)
      throw error
    }
  }).catch(() => undefined)

  if (errors.length || !segments.length) {
    throw new Error(`speech_to_text_failed: ${errors.join('; ') || 'empty_transcript'}`)
  }

  segments.sort((left, right) => left.start - right.start)
  const uniqueProviders = [...new Set(usedProviders)]
  return {
    segments,
    provider: uniqueProviders.length === 1 ? uniqueProviders[0] : 'mixed',
    providers: uniqueProviders,
    audioSeconds,
  }
}

export function resetSpeechProviderCooldownsForTests() {
  providerCooldowns.clear()
  providerInFlight.clear()
  providerDispatchCursor = 0
}
