import type { TranscriptSegment } from './types'

const pad = (value: number, length = 2) => String(value).padStart(length, '0')

const subtitleTime = (seconds: number, separator: ',' | '.') => {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const remainingSeconds = Math.floor((milliseconds % 60_000) / 1000)
  const remainingMilliseconds = milliseconds % 1000
  return `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}${separator}${pad(remainingMilliseconds, 3)}`
}

export const toSrt = (segments: TranscriptSegment[]) =>
  segments.map((segment, index) => (
    `${index + 1}\n${subtitleTime(segment.start, ',')} --> ${subtitleTime(segment.start + Math.max(segment.duration, 0.01), ',')}\n${segment.text}`
  )).join('\n\n')

export const toVtt = (segments: TranscriptSegment[]) =>
  `WEBVTT\n\n${segments.map((segment, index) => (
    `${index + 1}\n${subtitleTime(segment.start, '.')} --> ${subtitleTime(segment.start + Math.max(segment.duration, 0.01), '.')}\n${segment.text}`
  )).join('\n\n')}`
