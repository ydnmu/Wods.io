import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import ffmpegStatic from 'ffmpeg-static'
import { prepareSpeechAudioChunks } from './audioChunks'

const execFileAsync = promisify(execFile)

test('keeps short uploads in memory without invoking ffmpeg', async () => {
  const audio = Buffer.from('short audio fixture')
  const chunks = await prepareSpeechAudioChunks({
    audio,
    mimeType: 'audio/mpeg',
    durationSeconds: 30,
    videoId: 'fixture',
  })

  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].audio, audio)
  assert.equal(chunks[0].durationSeconds, 30)
  assert.equal(chunks[0].offsetSeconds, 0)
})

// Long audio is the case that actually needs ffmpeg on the host. Without a real
// run, a deploy target missing ffmpeg looks healthy until live traffic hits it.
test('splits long audio into flac chunks through ffmpeg', async () => {
  assert.ok(ffmpegStatic, 'ffmpeg-static should resolve a binary for this platform')

  const previousChunkSeconds = process.env.SPEECH_CHUNK_SECONDS
  const previousDirectMb = process.env.SPEECH_DIRECT_UPLOAD_MB
  process.env.SPEECH_CHUNK_SECONDS = '60'
  process.env.SPEECH_DIRECT_UPLOAD_MB = '0'

  const directory = await mkdtemp(path.join(tmpdir(), 'easytran-chunk-test-'))
  const sourcePath = path.join(directory, 'tone.m4a')

  try {
    await execFileAsync(ffmpegStatic as string, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=150',
      '-c:a', 'aac', sourcePath,
    ])

    const chunks = await prepareSpeechAudioChunks({
      audio: await readFile(sourcePath),
      mimeType: 'audio/mp4',
      durationSeconds: 150,
      videoId: 'chunk-fixture',
    })

    assert.equal(chunks.length, 3)
    assert.deepEqual(chunks.map((chunk) => chunk.offsetSeconds), [0, 60, 120])
    for (const chunk of chunks) {
      assert.equal(chunk.mimeType, 'audio/flac')
      assert.ok(chunk.audio.byteLength > 0, `chunk ${chunk.index} should carry audio bytes`)
    }
  } finally {
    if (previousChunkSeconds === undefined) delete process.env.SPEECH_CHUNK_SECONDS
    else process.env.SPEECH_CHUNK_SECONDS = previousChunkSeconds
    if (previousDirectMb === undefined) delete process.env.SPEECH_DIRECT_UPLOAD_MB
    else process.env.SPEECH_DIRECT_UPLOAD_MB = previousDirectMb
    await rm(directory, { recursive: true, force: true })
  }
})
