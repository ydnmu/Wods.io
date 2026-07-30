export type TranscriptSegment = {
  text: string
  start: number
  duration: number
}

export type TranscriptResponse = {
  title?: string
  videoId: string
  sourceUrl: string
  thumbnail?: string
  segments: TranscriptSegment[]
  plainText: string
  captionSource?: 'youtube' | 'vimeo' | 'ted' | 'dailymotion' | 'bilibili' | 'speech_to_text'
}

export type TranscriptParagraph = {
  index: number
  start: number
  text: string
  segmentIndexes: number[]
}

export type SummaryResponse = {
  title: string
  summary: string
  tags: string[]
}

export type NoCaptionsVideo = {
  title: string
  sourceUrl?: string
  message: string
}
