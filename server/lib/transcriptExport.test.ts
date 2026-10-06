import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRichTranscriptExport, buildTranscriptExport, isTranscriptExportFormat } from './transcriptExport'

const transcript = {
  id: 'user-video',
  video_id: 'dQw4w9WgXcQ',
  video_title: 'Example',
  video_channel: 'EasyTran',
  video_duration: '0:10',
  word_count: 2,
  caption_source: 'youtube',
  created_at: '2026-06-20T00:00:00.000Z',
  lines: [{ text: 'Hello world', start: 1, duration: 3 }],
}

test('exports archived transcripts in owner download formats', () => {
  assert.match(buildTranscriptExport(transcript, 'txt'), /\[0:01\] Hello world/)
  assert.match(buildTranscriptExport(transcript, 'srt'), /00:00:01,000 --> 00:00:04,000/)
  assert.match(buildTranscriptExport(transcript, 'vtt'), /^WEBVTT/)
  assert.equal(JSON.parse(buildTranscriptExport(transcript, 'json')).video.id, 'dQw4w9WgXcQ')
})

test('accepts only supported transcript export formats', () => {
  assert.equal(isTranscriptExportFormat('json'), true)
  assert.equal(isTranscriptExportFormat('pdf'), true)
  assert.equal(isTranscriptExportFormat('docx'), true)
  assert.equal(isTranscriptExportFormat('mp3'), false)
  assert.equal(isTranscriptExportFormat('mp4'), false)
})

test('builds real PDF and Word transcript files', async () => {
  const pdf = Buffer.from(await buildRichTranscriptExport(transcript, 'pdf'))
  const docx = Buffer.from(await buildRichTranscriptExport(transcript, 'docx'))
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF')
  assert.equal(docx.subarray(0, 2).toString(), 'PK')
})
