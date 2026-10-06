import type { TranscriptSegment } from './youtube'

const timestamp = '(?:\\d{2,}:)?\\d{2}:\\d{2}[.,]\\d{1,3}'
const timingLine = new RegExp(`^(${timestamp})\\s+-->\\s+(${timestamp})(?:\\s+.*)?$`)

function seconds(value: string) {
  const parts = value.replace(',', '.').split(':').map(Number)
  const [hours, minutes, secs] = parts.length === 3 ? parts : [0, ...parts]
  if (!parts.every(Number.isFinite) || minutes >= 60 || secs >= 60) return NaN
  return hours * 3600 + minutes * 60 + secs
}

function captionText(value: string) {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return value.replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (!code.startsWith('#')) return entities[code.toLowerCase()] ?? entity
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity
  }).replace(/\s+/g, ' ').trim()
}

// Providers return both WebVTT and SRT, sometimes with CRLF or unsorted cues.
export function parseCaptionTrack(input: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  const blocks = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/)
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (/^(NOTE(?:\s|$)|STYLE$|REGION$)/.test(lines[0])) continue
    const index = lines.findIndex(line => timingLine.test(line.trim()))
    if (index < 0) continue
    const match = lines[index].trim().match(timingLine)!
    const start = seconds(match[1])
    const end = seconds(match[2])
    const text = captionText(lines.slice(index + 1).join(' '))
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue
    segments.push({ text, start, duration: end - start })
  }
  return segments.sort((left, right) => left.start - right.start)
}
