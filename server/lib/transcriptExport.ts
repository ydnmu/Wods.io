import { toSrt, toTxt, toVtt, type TranscriptSegment } from './youtube'

export const TRANSCRIPT_EXPORT_FORMATS = ['json', 'txt', 'srt', 'vtt', 'pdf', 'docx'] as const
export type TranscriptExportFormat = typeof TRANSCRIPT_EXPORT_FORMATS[number]

type TranscriptExportRecord = {
  id: string
  video_id: string
  video_title: string
  video_channel: string
  video_duration: string
  word_count: number
  caption_source: string
  created_at: string
  lines: TranscriptSegment[]
}

export function isTranscriptExportFormat(value: string): value is TranscriptExportFormat {
  return TRANSCRIPT_EXPORT_FORMATS.includes(value as TranscriptExportFormat)
}

export function buildTranscriptExport(record: TranscriptExportRecord, format: TranscriptExportFormat) {
  if (format === 'txt') return toTxt(record.lines)
  if (format === 'srt') return toSrt(record.lines)
  if (format === 'vtt') return toVtt(record.lines)

  return JSON.stringify({
    id: record.id,
    video: {
      id: record.video_id,
      title: record.video_title,
      channel: record.video_channel,
      duration: record.video_duration,
      sourceUrl: `https://www.youtube.com/watch?v=${record.video_id}`,
    },
    wordCount: record.word_count,
    captionSource: record.caption_source,
    createdAt: record.created_at,
    segments: record.lines,
  }, null, 2)
}

const transcriptLines = (record: TranscriptExportRecord) => record.lines.map((line) => {
  const totalSeconds = Math.max(0, Math.floor(Number(line.start) || 0))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const timestamp = hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
  return `[${timestamp}] ${line.text}`
})

export async function buildRichTranscriptExport(record: TranscriptExportRecord, format: 'pdf' | 'docx') {
  if (format === 'docx') {
    const { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx')
    const document = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun(record.video_title || 'Transcript')],
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [new TextRun({
              text: `${record.video_channel || 'Unknown channel'} · ${record.word_count.toLocaleString()} words`,
              color: '666666',
            })],
          }),
          new Paragraph({ text: `https://www.youtube.com/watch?v=${record.video_id}` }),
          ...transcriptLines(record).map((line) => new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun(line)],
          })),
        ],
      }],
    })
    return new Uint8Array(await Packer.toBuffer(document))
  }

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const safe = (value: string) => value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '')
  const pageWidth = 595
  const pageHeight = 842
  const margin = 48
  const bodySize = 10
  const lineHeight = 15
  const wrap = (value: string, font = regular, size = bodySize, maxWidth = pageWidth - margin * 2) => {
    const words = safe(value).split(/\s+/).filter(Boolean)
    const rows: string[] = []
    let row = ''
    for (const word of words) {
      const candidate = row ? `${row} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) row = candidate
      else {
        if (row) rows.push(row)
        row = word
      }
    }
    if (row) rows.push(row)
    return rows.length ? rows : ['']
  }

  let page = pdf.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin
  const ensureSpace = (height: number) => {
    if (y - height >= margin) return
    page = pdf.addPage([pageWidth, pageHeight])
    y = pageHeight - margin
  }
  const drawRows = (rows: string[], options: { font?: typeof regular; size?: number; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = options.size ?? bodySize
    const gap = options.gap ?? lineHeight
    ensureSpace(rows.length * gap)
    for (const row of rows) {
      page.drawText(row, { x: margin, y, font: options.font ?? regular, size, color: options.color ?? rgb(0.12, 0.12, 0.12) })
      y -= gap
    }
  }

  drawRows(wrap(record.video_title || 'Transcript', bold, 20), { font: bold, size: 20, gap: 25 })
  drawRows(wrap(`${record.video_channel || 'Unknown channel'} · ${record.word_count.toLocaleString()} words`), { color: rgb(0.4, 0.4, 0.4) })
  drawRows([`https://www.youtube.com/watch?v=${safe(record.video_id)}`], { color: rgb(0.25, 0.38, 0.5) })
  y -= 14
  for (const line of transcriptLines(record)) {
    const rows = wrap(line)
    drawRows(rows)
    y -= 4
  }
  return await pdf.save()
}

export function transcriptExportContentType(format: TranscriptExportFormat) {
  if (format === 'pdf') return 'application/pdf'
  if (format === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (format === 'json') return 'application/json; charset=utf-8'
  if (format === 'vtt') return 'text/vtt; charset=utf-8'
  return 'text/plain; charset=utf-8'
}
