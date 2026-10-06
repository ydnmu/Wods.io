import { Innertube, Constants } from 'youtubei.js'
import type { Types } from 'youtubei.js'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

type AudioSource = {
  url: string
  mimeType: string
  userAgent: string
  durationSeconds: number
}

let client: Innertube | null = null

async function generatePoToken(visitorData: string): Promise<string> {
  const { JSDOM } = await import('jsdom')
  const { BG } = await import('bgutils-js')
  const dom = new JSDOM()
  Object.assign(globalThis, { window: dom.window, document: dom.window.document })

  const bgConfig = {
    fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init),
    globalObj: globalThis as Record<string, unknown>,
    identifier: visitorData,
    requestKey: 'O43z0dpjhgX20SCx4KAo',
  }
  const challenge = await BG.Challenge.create(bgConfig)
  if (!challenge) throw new Error('Could not get BotGuard challenge')
  const script = challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue
  if (!script) throw new Error('Could not load BotGuard VM')
  new Function(script)()
  const result = await BG.PoToken.generate({
    program: challenge.program,
    globalName: challenge.globalName,
    bgConfig,
  })
  return result.poToken
}

async function getClient() {
  if (client) return client
  const bare = await Innertube.create({ retrieve_player: false })
  const visitorData = bare.session.context.client.visitorData
  let poToken: string | undefined
  if (visitorData) {
    try {
      poToken = await generatePoToken(visitorData)
    } catch (error) {
      console.warn('[ytsnip-audio] PO token unavailable:', error instanceof Error ? error.message : error)
    }
  }
  client = await Innertube.create({ po_token: poToken, visitor_data: visitorData })
  return client
}

const CLIENT_ORDER: Types.InnerTubeClient[] = ['ANDROID_VR', 'IOS', 'WEB']

async function resolveAudioSource(videoId: string): Promise<AudioSource> {
  const yt = await getClient()
  const errors: string[] = []

  for (const innerTubeClient of CLIENT_ORDER) {
    try {
      const info = await yt.getBasicInfo(videoId, { client: innerTubeClient })
      if (info.playability_status?.status && info.playability_status.status !== 'OK') {
        errors.push(`${innerTubeClient}: ${info.playability_status.status}`)
        continue
      }
      const audios = (info.streaming_data?.adaptive_formats ?? [])
        .filter((format) => format.has_audio && !format.has_video)
      if (!audios.length) {
        errors.push(`${innerTubeClient}: no audio stream`)
        continue
      }

      const m4a = audios.filter((format) => format.mime_type.includes('mp4a'))
      const pool = m4a.length ? m4a : audios
      pool.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
      const audio = pool[0]
      const url = await audio.decipher(yt.session.player)
      if (!url) throw new Error('failed to decipher audio URL')
      const constants = (Constants.CLIENTS as Record<string, { USER_AGENT?: string }>)[innerTubeClient]
      return {
        url,
        mimeType: audio.mime_type,
        userAgent: constants?.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        durationSeconds: Math.max(1, Number(info.basic_info.duration || 0)),
      }
    } catch (error) {
      errors.push(`${innerTubeClient}: ${error instanceof Error ? error.message : error}`)
    }
  }
  throw new Error(errors.join(' | ') || 'Unable to resolve audio stream')
}

const CHUNK_SIZE = 10 * 1024 * 1024

async function downloadAudioToFile(url: string, userAgent: string, mimeType: string) {
  let offset = 0
  let total = Number.POSITIVE_INFINITY
  const maxBytes = Number(process.env.SPEECH_TO_TEXT_MAX_AUDIO_MB || 2048) * 1024 * 1024
  const directory = await mkdtemp(path.join(tmpdir(), 'easytran-source-'))
  const extension = /webm/i.test(mimeType) ? 'webm' : /ogg|opus/i.test(mimeType) ? 'ogg' : 'm4a'
  const filePath = path.join(directory, `source.${extension}`)
  const handle = await open(filePath, 'w')

  try {
    while (offset < total) {
      const end = total === Number.POSITIVE_INFINITY
        ? offset + CHUNK_SIZE - 1
        : Math.min(offset + CHUNK_SIZE, total) - 1
      const response = await fetch(url, {
        headers: { 'user-agent': userAgent, range: `bytes=${offset}-${end}` },
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status !== 206 && response.status !== 200) {
        throw new Error(`audio source returned HTTP ${response.status}`)
      }
      if (response.status === 200 && offset > 0) throw new Error('audio_source_range_ignored')
      const contentRange = response.headers.get('content-range')
      const match = contentRange?.match(/\/(\d+)/)
      if (match) total = Number(match[1])
      if (total > maxBytes) throw new Error('audio_too_large')
      const chunk = Buffer.from(await response.arrayBuffer())
      if (!chunk.length) throw new Error('empty audio chunk')
      await handle.write(chunk, 0, chunk.length, offset)
      offset += chunk.length
      if (offset > maxBytes) throw new Error('audio_too_large')
      if (response.status === 200) break
    }
    return {
      filePath,
      byteLength: offset,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  } finally {
    await handle.close()
  }
}

export async function fetchYtSnipAudio(videoId: string) {
  const source = await resolveAudioSource(videoId)
  const downloaded = await downloadAudioToFile(source.url, source.userAgent, source.mimeType)
  return {
    audioPath: downloaded.filePath,
    audioBytes: downloaded.byteLength,
    mimeType: source.mimeType,
    durationSeconds: source.durationSeconds,
    cleanup: downloaded.cleanup,
  }
}
