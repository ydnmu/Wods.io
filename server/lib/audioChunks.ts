import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import ffmpegStatic from 'ffmpeg-static'

const execFileAsync = promisify(execFile)

// Chunking is a hard dependency for any audio longer than SPEECH_CHUNK_SECONDS,
// so ffmpeg has to resolve on every deploy target. FFMPEG_PATH wins (a VPS with
// apt-installed ffmpeg should use it), then the bundled static binary, which is
// what makes managed Node hosts work where apt-get is unavailable.
export const ffmpegBinary = () => process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg'

export type SpeechAudioChunk = {
  audio: Buffer
  mimeType: string
  durationSeconds: number
  offsetSeconds: number
  index: number
}

type SpeechAudioInput = {
  audio?: Buffer
  audioPath?: string
  mimeType: string
  durationSeconds: number
  videoId: string
}

const extensionForMime = (mimeType: string) => {
  if (/webm/i.test(mimeType)) return 'webm'
  if (/ogg|opus/i.test(mimeType)) return 'ogg'
  if (/wav/i.test(mimeType)) return 'wav'
  if (/mpeg|mp3/i.test(mimeType)) return 'mp3'
  return 'm4a'
}

const boundedChunkSeconds = () => {
  const requested = Number(process.env.SPEECH_CHUNK_SECONDS || 600)
  return Math.min(1_800, Math.max(60, Number.isFinite(requested) ? requested : 600))
}

const boundedChunkConcurrency = () => {
  const requested = Number(process.env.SPEECH_CHUNK_CONCURRENCY || 4)
  return Math.min(8, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 4))
}

export async function processSpeechAudioChunks<T>(
  params: SpeechAudioInput,
  processChunk: (chunk: SpeechAudioChunk) => Promise<T>,
): Promise<T[]> {
  const chunkSeconds = boundedChunkSeconds()
  const maxDirectBytes = Number(process.env.SPEECH_DIRECT_UPLOAD_MB || 18) * 1024 * 1024
  const durationSeconds = Math.max(1, Number(params.durationSeconds || 0))

  if (params.audio && durationSeconds <= chunkSeconds && params.audio.byteLength <= maxDirectBytes) {
    return [await processChunk({
      audio: params.audio,
      mimeType: params.mimeType,
      durationSeconds,
      offsetSeconds: 0,
      index: 0,
    })]
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'easytran-audio-'))
  const safeVideoId = params.videoId.replace(/[^\w-]/g, '').slice(0, 64) || 'audio'
  const inputPath = params.audioPath || path.join(directory, `${safeVideoId}.${extensionForMime(params.mimeType)}`)
  const outputPattern = path.join(directory, 'chunk-%05d.flac')

  try {
    if (!params.audioPath) {
      if (!params.audio) throw new Error('audio_input_missing')
      await writeFile(inputPath, params.audio)
    }
    try {
      await execFileAsync(ffmpegBinary(), [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', inputPath,
        '-map', '0:a:0',
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'flac',
        '-f', 'segment',
        '-segment_time', String(chunkSeconds),
        '-reset_timestamps', '1',
        outputPattern,
      ], { timeout: Math.max(120_000, Math.ceil(durationSeconds * 250)), maxBuffer: 2 * 1024 * 1024 })
    } catch (error) {
      // A bare ENOENT here reads as a generic provider failure and hides the real
      // cause, which is a host that never provisioned ffmpeg.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new Error(
          `ffmpeg_not_available: could not run "${ffmpegBinary()}". Install ffmpeg on the host or set FFMPEG_PATH.`,
          { cause: error },
        )
      }
      throw error
    }

    const files = (await readdir(directory))
      .filter((file) => /^chunk-\d+\.flac$/.test(file))
      .sort()
    if (!files.length) throw new Error('audio_chunking_empty')

    const chunks = files.flatMap((file, index) => {
      const offsetSeconds = index * chunkSeconds
      const remainingSeconds = durationSeconds - offsetSeconds
      // Segment muxers can emit a millisecond-scale tail at an exact boundary.
      // Sending that tail creates an empty/invalid provider request and can make
      // an otherwise successful long transcript fail after its final chunk.
      if (remainingSeconds <= 0.5) return []
      return [{ file, index, offsetSeconds, remainingSeconds }]
    })
    const results = new Array<T>(chunks.length)
    let cursor = 0
    const worker = async () => {
      while (cursor < chunks.length) {
        const resultIndex = cursor
        cursor += 1
        const chunk = chunks[resultIndex]
        results[resultIndex] = await processChunk({
          audio: await readFile(path.join(directory, chunk.file)),
          mimeType: 'audio/flac',
          durationSeconds: Math.max(1, Math.min(chunkSeconds, chunk.remainingSeconds)),
          offsetSeconds: chunk.offsetSeconds,
          index: chunk.index,
        })
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(boundedChunkConcurrency(), chunks.length) },
      worker,
    ))
    return results
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'
    throw new Error(`audio_chunking_failed: ${message}`, { cause: error })
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function prepareSpeechAudioChunks(params: SpeechAudioInput): Promise<SpeechAudioChunk[]> {
  return processSpeechAudioChunks(params, async (chunk) => chunk)
}
