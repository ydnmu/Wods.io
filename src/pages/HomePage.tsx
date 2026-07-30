import {
  ArrowLeft,
  Check,
  Clipboard,
  Download,
  Fingerprint,
  Infinity as InfinityIcon,
  Languages,
  Link,
  Loader2,
  MegaphoneOff,
  Play,
  Search,
  Share2,
  Sparkles,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { NoCaptionsModal } from '../components/NoCaptionsModal'
import { SiteTopbar } from '../components/SiteTopbar'
import { Footer } from '../components/Footer'
import { ThemeBackdrop } from '../components/ThemeBackdrop'
import { trackEvent } from '../lib/analytics'
import { ClientYoutubeError, fetchYoutubeTranscriptFromClient, isYoutubeUrl } from '../lib/clientYoutube'
import { formatTime } from '../lib/formatTime'
import { LANGUAGES } from '../lib/languages'
import { toSrt, toVtt } from '../lib/transcriptFormat'
import type {
  TranscriptSegment,
  TranscriptResponse,
  TranscriptParagraph,
  SummaryResponse,
} from '../lib/types'
import type { SiteLocale } from '../hooks/useLocale'
import type { Theme } from '../hooks/useTheme'

type AppState = 'idle' | 'loading' | 'ai-confirm' | 'ai-loading' | 'result'

type PendingAiFallback = {
  url: string
  title: string
  message: string
  force: boolean
}

let transientTranscriptSession: { transcript: TranscriptResponse; url: string } | null = null

const homeCopy = {
  en: {
    titleStart: 'URL',
    titleEnd: 'Transcript.',
    placeholder: 'Paste a video URL (YouTube, Vimeo, TED, Dailymotion)',
    inputLabel: 'Video URL',
    clear: 'Clear URL',
    submit: 'Transcribe',
    promisesLabel: 'EasyTran promises',
    promises: ['No tracking', 'No ads', 'No limit', 'AI fallback'],
    noLimitLabel: 'What does no limit mean?',
    noLimitHelp: 'Web transcripts are free for everyone, subject to fair-use safeguards. Need hundreds of thousands in one click? Explore our pricing options.',
    generated: 'transcripts generated',
    response: 'average response time',
    languages: 'languages supported',
  },
  zh: {
    titleStart: '链接',
    titleEnd: '转录',
    placeholder: '粘贴视频链接（YouTube、Vimeo、TED、Dailymotion）',
    inputLabel: '视频链接',
    clear: '清除链接',
    submit: '开始转录',
    promisesLabel: 'EasyTran 承诺',
    promises: ['无追踪', '无广告', '网页不限量', 'AI 备用转录'],
    noLimitLabel: '网页不限量是什么意思？',
    noLimitHelp: '网页转录对所有人免费，并受合理使用保护。需要一次处理大量视频？请查看价格方案。',
    generated: '已生成转录',
    response: '平均响应时间',
    languages: '支持的语言',
  },
  tr: {
    titleStart: 'URL',
    titleEnd: 'Transkript.',
    placeholder: 'Video bağlantısını yapıştır (YouTube, Vimeo, TED, Dailymotion)',
    inputLabel: 'Video bağlantısı',
    clear: 'Bağlantıyı temizle',
    submit: 'Transkript oluştur',
    promisesLabel: 'EasyTran ilkeleri',
    promises: ['Takip yok', 'Reklam yok', 'Web limiti yok', 'AI yedekleme'],
    noLimitLabel: 'Web limiti yok ne demek?',
    noLimitHelp: 'Web transkriptleri, adil kullanım korumaları kapsamında herkes için ücretsizdir. Tek seferde yüz binlerce video mu işleyeceksiniz? Fiyatlandırma seçeneklerini inceleyin.',
    generated: 'oluşturulan transkript',
    response: 'ortalama yanıt süresi',
    languages: 'desteklenen dil',
  },
  es: {
    titleStart: 'URL',
    titleEnd: 'Transcripción.',
    placeholder: 'Pega la URL de un vídeo (YouTube, Vimeo, TED, Dailymotion)',
    inputLabel: 'URL del vídeo',
    clear: 'Borrar URL',
    submit: 'Transcribir',
    promisesLabel: 'Compromisos de EasyTran',
    promises: ['Sin rastreo', 'Sin anuncios', 'Sin límite web', 'Respaldo con IA'],
    noLimitLabel: '¿Qué significa sin límite web?',
    noLimitHelp: 'Las transcripciones web son gratuitas para todos, con medidas de uso razonable. ¿Necesitas procesar cientos de miles de vídeos de una vez? Consulta nuestros planes.',
    generated: 'transcripciones generadas',
    response: 'tiempo medio de respuesta',
    languages: 'idiomas compatibles',
  },
} as const

const promiseIcons = [Fingerprint, MegaphoneOff, InfinityIcon, Sparkles] as const

const hasSentenceEnd = (text: string) => /[.!?)]$/.test(text.trim())

const buildParagraphs = (segments: TranscriptSegment[]) => {
  const paragraphs: TranscriptParagraph[] = []
  let current: TranscriptSegment[] = []
  let indexes: number[] = []

  const flush = () => {
    if (current.length === 0) return
    paragraphs.push({
      index: paragraphs.length,
      start: current[0].start,
      text: current.map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim(),
      segmentIndexes: indexes,
    })
    current = []
    indexes = []
  }

  segments.forEach((segment, index) => {
    const previous = current[current.length - 1]
    const gap = previous ? segment.start - (previous.start + previous.duration) : 0

    const currentWords = current
      .map((item) => item.text)
      .join(' ')
      .split(/\s+/)
      .filter(Boolean).length

    if (current.length > 0 && gap > 5 && currentWords >= 8) {
      flush()
    }

    current.push(segment)
    indexes.push(index)

    const text = current.map((item) => item.text).join(' ')
    const wordCount = text.split(/\s+/).filter(Boolean).length
    const shouldFlush =
      current.length >= 8 ||
      wordCount >= 54 ||
      (wordCount >= 32 && hasSentenceEnd(segment.text))

    if (shouldFlush) {
      flush()
    }
  })

  flush()
  return paragraphs
}

const renderHighlightedText = (text: string, query: string) => {
  const needle = query.trim()
  if (!needle) return text

  const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escapedNeedle})`, 'ig'))
  return parts.map((part, index) =>
    part.toLowerCase() === needle.toLowerCase() ? <mark key={`${part}-${index}`}>{part}</mark> : part,
  )
}

const transcriptNeedsAiFallback = (transcript: TranscriptResponse) => {
  const words = transcript.plainText.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
  if (transcript.segments.length < 2 || words.length < 8) return true
  if (words.length < 30) return false
  const uniqueRatio = new Set(words).size / words.length
  const noisySegments = transcript.segments.filter((segment) =>
    !/[\p{L}\p{N}]/u.test(segment.text) || /(.)\1{7,}/u.test(segment.text),
  ).length
  return uniqueRatio < 0.12 || noisySegments / transcript.segments.length > 0.35
}

const getEmbedUrl = (sourceUrl: string, videoId: string, startTime: number) => {
  if (sourceUrl.includes('vimeo.com'))
    return `https://player.vimeo.com/video/${videoId}?autoplay=1&muted=1${startTime ? `#t=${Math.floor(startTime)}s` : ''}`
  if (sourceUrl.includes('dailymotion.com'))
    return `https://www.dailymotion.com/embed/video/${videoId}?autoplay=1&mute=1${startTime ? `&start=${Math.floor(startTime)}` : ''}`
  if (sourceUrl.includes('bilibili.com')) {
    const videoParam = videoId.startsWith('av')
      ? `aid=${videoId.slice(2)}`
      : `bvid=${videoId}`
    return `https://player.bilibili.com/player.html?${videoParam}&autoplay=1&muted=1&danmaku=false${startTime ? `&t=${Math.floor(startTime)}` : ''}`
  }
  if (sourceUrl.includes('bilibili.tv'))
    return sourceUrl
  if (sourceUrl.includes('ted.com'))
    return `https://embed.ted.com/talks/${videoId}`
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&rel=0&modestbranding=1&enablejsapi=1${startTime ? `&start=${Math.floor(startTime)}` : ''}`
}

const getThumbnailUrl = (sourceUrl: string, videoId: string, thumbnail?: string) => {
  if (thumbnail) return thumbnail
  if (sourceUrl.includes('vimeo.com')) return `https://vumbnail.com/${videoId}.jpg`
  if (sourceUrl.includes('dailymotion.com')) return `https://www.dailymotion.com/thumbnail/video/${videoId}`
  if (sourceUrl.includes('bilibili.')) return '/easytran-logo.svg'
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
}

export function HomePage({
  theme,
  onThemeToggle,
  locale,
  onLocaleChange,
}: {
  theme: Theme
  onThemeToggle: () => void
  locale: SiteLocale
  onLocaleChange: (locale: SiteLocale) => void
}) {
  const copy = homeCopy[locale]
  const [state, setState] = useState<AppState>(transientTranscriptSession ? 'result' : 'idle')
  const [url, setUrl] = useState(transientTranscriptSession?.url ?? '')
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [message, setMessage] = useState('')
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(transientTranscriptSession?.transcript ?? null)
  const [showTimestamps, setShowTimestamps] = useState(true)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [summaryError, setSummaryError] = useState('')
  const [summaryCopied, setSummaryCopied] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [targetLang, setTargetLang] = useState<string>('original')
  const [translations, setTranslations] = useState<Record<number, string>>({})
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState('')
  const [pendingAiFallback, setPendingAiFallback] = useState<PendingAiFallback | null>(null)
  const [aiProgress, setAiProgress] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [startTime, setStartTime] = useState(0)

  useEffect(() => {
    trackEvent('page_view')
  }, [])

  const allParagraphs = useMemo(
    () => (transcript ? buildParagraphs(transcript.segments) : []),
    [transcript],
  )

  const paragraphText = (paragraph: TranscriptParagraph) =>
    targetLang !== 'original' && translations[paragraph.index]
      ? translations[paragraph.index]
      : paragraph.text

  const filteredSegments = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allParagraphs.filter((paragraph) => {
      const text =
        targetLang !== 'original' && translations[paragraph.index]
          ? translations[paragraph.index]
          : paragraph.text
      return !needle || text.toLowerCase().includes(needle)
    })
  }, [query, allParagraphs, translations, targetLang])

  const timestampedText = useMemo(() => {
    return allParagraphs
      .map((paragraph) => {
        const text =
          targetLang !== 'original' && translations[paragraph.index]
            ? translations[paragraph.index]
            : paragraph.text
        return `[${formatTime(paragraph.start)}] ${text}`
      })
      .join('\n')
  }, [allParagraphs, translations, targetLang])

  const translateTranscript = async (language: string) => {
    setTargetLang(language)
    if (language === 'original') {
      setTranslations({})
      setTranslateError('')
      setTranslating(false)
      return
    }
    const texts = allParagraphs.map((paragraph) => paragraph.text)
    setTranslating(true)
    setTranslateError('')
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts, target: language }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Translation failed')
      const map: Record<number, string> = {}
      allParagraphs.forEach((paragraph, index) => {
        map[paragraph.index] = payload.translations?.[index] ?? paragraph.text
      })
      setTranslations(map)
    } catch {
      setTranslateError('Translation unavailable')
    } finally {
      setTranslating(false)
    }
  }

  const stats = useMemo(() => {
    if (!transcript) return { words: 0, duration: '0:00' }
    const words = transcript.plainText.split(/\s+/).filter(Boolean).length
    const lastSegment = transcript.segments[transcript.segments.length - 1]
    const duration = lastSegment ? lastSegment.start + lastSegment.duration : 0
    return { words, duration: formatTime(duration) }
  }, [transcript])

  useEffect(() => {
    if (state !== 'ai-loading') return
    const interval = window.setInterval(() => {
      setAiProgress((value) => Math.min(92, value + Math.max(1, Math.round((94 - value) / 10))))
    }, 650)
    return () => window.clearInterval(interval)
  }, [state])

  const showTranscript = (payload: TranscriptResponse, sourceUrl: string) => {
    transientTranscriptSession = { transcript: payload, url: sourceUrl }
    setTranscript(payload)
    setActiveIndex(0)
    setQuery('')
    setSummary(null)
    setSummaryOpen(false)
    setSummaryError('')
    setPendingAiFallback(null)
    setPlaying(true)
    setState('result')
    trackEvent('transcript_success', { videoId: payload.videoId })
  }

  const requestAiFallback = (details: PendingAiFallback) => {
    setPendingAiFallback(details)
    setAiProgress(0)
    setState('ai-confirm')
  }

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    const trimmedUrl = url.trim()

    if (!trimmedUrl) {
      setMessage('Paste a YouTube URL first.')
      return
    }

    setState('loading')
    setMessage('')
    setCopied(false)
    trackEvent('transcript_submit')

    try {
      let response: Response | null = null
      let payload: TranscriptResponse & { error?: string; message?: string }

      if (isYoutubeUrl(trimmedUrl)) {
        try {
          payload = await fetchYoutubeTranscriptFromClient(trimmedUrl)
          if (transcriptNeedsAiFallback(payload)) {
            requestAiFallback({
              url: trimmedUrl,
              title: payload.title || 'AI fallback available',
              message: 'The available captions look incomplete or unreliable. AI can transcribe the audio instead. Continue?',
              force: true,
            })
            return
          }
        } catch (error) {
          if (!(error instanceof ClientYoutubeError) || error.code !== 'no_captions') throw error
          requestAiFallback({
            url: trimmedUrl,
            title: 'No usable captions found',
            message: 'This video has no usable subtitle track. AI can transcribe the audio instead. Continue?',
            force: true,
          })
          return
        }
      } else {
        response = await fetch('/api/transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmedUrl, allowAiFallback: false }),
        })
        payload = await response.json().catch(() => ({
          error: 'invalid_response',
          message: 'The transcript service returned an invalid response.',
        })) as TranscriptResponse & { error?: string; message?: string }
      }
      if (payload.error === 'ai_fallback_confirmation_required') {
        requestAiFallback({
          url: trimmedUrl,
          title: payload.title || 'AI fallback available',
          message: payload.message || 'A transcript could not be generated for this video.',
          force: true,
        })
        return
      }

      if (
        payload.error === 'no_captions'
        || payload.error === 'audio_transcription_not_configured'
        || payload.error === 'audio_transcription_failed'
        || payload.error === 'bilibili_auth_required'
      ) {
        throw new Error(payload.message || 'A transcript could not be generated for this video.')
      }

      if (response && !response.ok) {
        throw new Error(payload.error || 'Transcript could not be loaded.')
      }

      showTranscript(payload, trimmedUrl)
    } catch (error) {
      setState('idle')
      setMessage(error instanceof Error ? error.message : 'Transcript could not be loaded.')
      trackEvent('transcript_error')
    }
  }

  const confirmAiFallback = async () => {
    if (!pendingAiFallback) return
    setState('ai-loading')
    setAiProgress(4)
    setMessage('')
    try {
      const response = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: pendingAiFallback.url,
          allowAiFallback: true,
          forceAiFallback: pendingAiFallback.force,
        }),
      })
      const payload = await response.json().catch(() => ({
        error: 'invalid_response',
        message: 'The transcript service returned an invalid response.',
      })) as TranscriptResponse & { error?: string; message?: string }
      if (!response.ok || payload.error) throw new Error(payload.message || payload.error || 'AI transcription failed.')
      setAiProgress(100)
      showTranscript(payload, pendingAiFallback.url)
    } catch (error) {
      setPendingAiFallback(null)
      setState('idle')
      setMessage(error instanceof Error ? error.message : 'AI transcription failed.')
      trackEvent('transcript_error')
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(timestampedText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const handleDownload = async (format: 'json' | 'txt' | 'srt' | 'vtt') => {
    if (!transcript) return
    let content = timestampedText
    let type = 'text/plain;charset=utf-8'

    if (format === 'json') {
      content = JSON.stringify(transcript, null, 2)
      type = 'application/json;charset=utf-8'
    } else if (format === 'srt') {
      content = toSrt(transcript.segments)
    } else if (format === 'vtt') {
      content = toVtt(transcript.segments)
      type = 'text/vtt;charset=utf-8'
    }

    const blob = new Blob([content], { type })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `${transcript.videoId}-transcript.${format}`
    anchor.click()
    URL.revokeObjectURL(href)
    setDownloadOpen(false)
  }

  const handleSummary = async () => {
    if (!transcript) return
    setSummaryOpen((value) => !value)
    if (summary || summaryLoading) return

    setSummaryLoading(true)
    setSummaryError('')

    try {
      const response = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: transcript.title || `YouTube video ${transcript.videoId}`,
          text: transcript.plainText,
        }),
      })
      const payload = await response.json()
      if (!response.ok && !payload.summary) {
        throw new Error(payload.error || 'Summary failed')
      }
      setSummary({
        title: payload.title || transcript.title || 'AI Summary',
        summary: payload.summary || '',
        tags: Array.isArray(payload.tags) ? payload.tags : [],
      })
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : 'Summary failed')
    } finally {
      setSummaryLoading(false)
    }
  }

  const copySummary = async () => {
    if (!summary) return
    const tags = summary.tags.length ? `\n\n${summary.tags.map((tag) => `#${tag}`).join(' ')}` : ''
    await navigator.clipboard.writeText(`${summary.title}\n\n${summary.summary}${tags}`)
    setSummaryCopied(true)
    window.setTimeout(() => setSummaryCopied(false), 1400)
  }

  const handleShare = async () => {
    if (!transcript) return
    const shareData = {
      title: transcript.title || 'YouTube transcript',
      text: `Transcript for ${transcript.sourceUrl}`,
      url: transcript.sourceUrl,
    }

    if (navigator.share) {
      await navigator.share(shareData)
      return
    }

    await navigator.clipboard.writeText(transcript.sourceUrl)
  }

  const reset = () => {
    transientTranscriptSession = null
    setState('idle')
    setTranscript(null)
    setMessage('')
    setQuery('')
    setDownloadOpen(false)
    setSummaryOpen(false)
    setSummary(null)
    setSummaryError('')
    setPendingAiFallback(null)
    setAiProgress(0)
    setStartTime(0)
    setPlaying(false)
  }

  const seekTo = (seconds: number) => {
    if (playing && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }),
        '*',
      )
    } else {
      setStartTime(seconds)
      setPlaying(true)
    }
  }

  const openHome = () => {
    reset()
  }

  const appClassName = [
    'app',
    state === 'result' || state === 'loading' ? 'app-fixed' : '',
    state === 'idle' ? 'app-wallpaper' : '',
  ].filter(Boolean).join(' ')

  return (
    <main className={appClassName}>
      <ThemeBackdrop active theme={theme} variant="home" />
      <div className="dot-grid" aria-hidden="true" />

      <SiteTopbar
        onHomeClick={openHome}
        theme={theme}
        onThemeToggle={onThemeToggle}
        locale={locale}
        onLocaleChange={onLocaleChange}
      />

      {state === 'idle' && (
        <section className="hero" id="app">
          <h1 className="hero-h1 hero-h1-single">
            <span>{copy.titleStart}</span>
            <span className="hero-title-arrow" aria-hidden="true" />
            <span>{copy.titleEnd}</span>
          </h1>

          <form className="url-shell" onSubmit={handleSubmit}>
            <span className="url-progress" aria-hidden="true" />
            <div className="url-input-wrap">
              <Link className="url-icon" size={18} />
              <input
                value={url}
                ref={inputRef}
                onChange={(event) => setUrl(event.target.value)}
                className="url-input"
                placeholder={copy.placeholder}
                aria-label={copy.inputLabel}
              />
              {url && (
                <button className="url-clear" type="button" onClick={() => setUrl('')} aria-label={copy.clear}>
                  <X size={13} />
                </button>
              )}
            </div>
            <button className="cta" type="submit">
              {copy.submit}
            </button>
          </form>

          {message && <p className="form-message">{message}</p>}

          <div className="hero-meta">
            <div className="hero-meta-promises" aria-label={copy.promisesLabel}>
              {copy.promises.map((label, index) => {
                const Icon = promiseIcons[index]
                const highlighted = index === 3
                const hasHelp = index === 2
                return (
                <span className={`${highlighted ? 'is-highlighted' : ''}${hasHelp ? ' has-help' : ''}`} key={label}>
                  <Icon className="promise-icon" size={13} strokeWidth={1.8} aria-hidden="true" />
                  {label}
                  {hasHelp && (
                    <>
                      <button
                        className="promise-help-button"
                        type="button"
                        aria-label={copy.noLimitLabel}
                        aria-describedby="no-limit-tooltip"
                      >
                        ?
                      </button>
                      <small className="promise-tooltip" id="no-limit-tooltip" role="tooltip">
                        {copy.noLimitHelp}
                      </small>
                    </>
                  )}
                </span>
              )})}
            </div>
            <div>
              <strong>4.2M</strong>
              <span>{copy.generated}</span>
            </div>
            <i />
            <div>
              <strong>~3.4s</strong>
              <span>{copy.response}</span>
            </div>
            <i />
            <div>
              <strong>{LANGUAGES.length}</strong>
              <span>{copy.languages}</span>
            </div>
          </div>
        </section>
      )}

      {state === 'loading' && (
        <section className="result-view result-loading-view" aria-live="polite" aria-label="Preparing transcript">
          <div className="split">
            <aside className="left result-overview">
              <div className="result-skeleton result-skeleton-video" />
              <div className="result-skeleton result-skeleton-info">
                <span /><span /><span />
              </div>
            </aside>
            <main className="right">
              <div className="right-head result-skeleton-toolbar">
                <span /><span /><span /><span />
              </div>
              <div className="result-skeleton-lines">
                {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
              </div>
            </main>
          </div>
        </section>
      )}

      {state === 'result' && transcript && (
        <section className="result-view">
          {summaryOpen && (
            <section className="summary-card">
              <div className="summary-head">
                <span><Sparkles size={13} /> AI Summary</span>
                <div className="summary-actions">
                  {summary && (
                    <button className="summary-copy" type="button" onClick={copySummary} aria-label="Copy AI summary">
                      <Clipboard size={13} /> {summaryCopied ? 'Copied' : 'Copy'}
                    </button>
                  )}
                  <button type="button" onClick={() => setSummaryOpen(false)} aria-label="Close summary">
                    <X size={14} />
                  </button>
                </div>
              </div>
              {summaryLoading && <p className="summary-muted">Generating summary...</p>}
              {summaryError && <p className="summary-muted">{summaryError}</p>}
              {summary && (
                <>
                  <h2>{summary.title}</h2>
                  <p>{summary.summary}</p>
                  {summary.tags.length > 0 && (
                    <div className="summary-tags">
                      {summary.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          <div className="split">
            <aside className="left result-overview">
              <div className="video-card">
                {playing ? (
                  <div className="video-frame">
                    <iframe
                      ref={iframeRef}
                      src={getEmbedUrl(transcript.sourceUrl, transcript.videoId, startTime)}
                      title={transcript.title || `Video ${transcript.videoId}`}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                      allowFullScreen
                    />
                  </div>
                ) : (
                  <button
                    className="video-thumb"
                    type="button"
                    onClick={() => setPlaying(true)}
                    aria-label="Play video"
                  >
                    <img src={getThumbnailUrl(transcript.sourceUrl, transcript.videoId, transcript.thumbnail)} alt="" />
                    <span className="play-btn"><Play size={22} fill="currentColor" /></span>
                  </button>
                )}
              </div>

              <div className="video-info-card">
                <div className="video-meta">
                  <div className="video-title">{transcript.title || `Video ${transcript.videoId}`}</div>
                  <a
                    className="video-channel"
                    href={transcript.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {transcript.sourceUrl.replace(/^https?:\/\/(www\.)?/, '')}
                  </a>
                </div>

                <div className="video-facts">
                  <div>
                    <span>Duration</span>
                    <strong>{stats.duration}</strong>
                  </div>
                  <div>
                    <span>Subtitles</span>
                    <strong>{transcript.captionSource === 'speech_to_text' ? 'AI fallback' : 'Supported'}</strong>
                  </div>
                  <div>
                    <span>Segments</span>
                    <strong>{transcript.segments.length.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>Words</span>
                    <strong>{stats.words.toLocaleString()}</strong>
                  </div>
                </div>
              </div>
            </aside>

            <main className="right">
              <div className="right-head">
                <button className="pill command-new" type="button" onClick={reset}>
                  <ArrowLeft size={14} />
                  New
                </button>
                <label className="search">
                  <Search size={15} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search in transcript..."
                    aria-label="Search in transcript"
                  />
                </label>
                <label className="lang-select" title="Translate transcript">
                  {translating ? <Loader2 className="spin" size={14} /> : <Languages size={14} />}
                  <select
                    value={targetLang}
                    onChange={(event) => void translateTranscript(event.target.value)}
                    aria-label="Translate transcript language"
                  >
                    <option value="original">Original</option>
                    {LANGUAGES.map((language) => (
                      <option key={language.code} value={language.code}>
                        {language.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className={showTimestamps ? 'toggle on' : 'toggle'}
                  type="button"
                  onClick={() => setShowTimestamps((value) => !value)}
                >
                  Timestamps
                </button>
                <button className="pill command-action" type="button" onClick={handleSummary}>
                  <Sparkles size={14} />
                  Summary
                </button>
                <button className="pill command-action command-copy" type="button" onClick={handleCopy}>
                  {copied ? <Check size={14} /> : <Clipboard size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <div className="download-menu">
                  <button
                    className="pill pill-icon"
                    type="button"
                    onClick={() => setDownloadOpen((value) => !value)}
                    aria-label="Download transcript"
                    title="Download"
                  >
                    <Download size={14} />
                  </button>
                  {downloadOpen && (
                    <div className="download-popover">
                      {(['json', 'txt', 'srt', 'vtt'] as const).map((format) => (
                        <button type="button" key={format} onClick={() => handleDownload(format)}>
                          {format.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="pill pill-icon"
                  type="button"
                  onClick={handleShare}
                  aria-label="Share transcript"
                  title="Share"
                >
                  <Share2 size={14} />
                </button>
                {translateError && <span className="command-error">{translateError}</span>}
              </div>

              <ol className="transcript">
                {filteredSegments.length === 0 && <li className="empty">No matches.</li>}
                {filteredSegments.map((paragraph) => (
                  <li
                    key={`${paragraph.index}-${paragraph.start}`}
                    className={paragraph.index === activeIndex ? 'line active paragraph-line' : 'line paragraph-line'}
                    onClick={() => {
                      setActiveIndex(paragraph.index)
                      seekTo(paragraph.start)
                    }}
                  >
                    {showTimestamps && <time className="line-time">{formatTime(paragraph.start)}</time>}
                    <span className="line-text">{renderHighlightedText(paragraphText(paragraph), query)}</span>
                  </li>
                ))}
              </ol>
            </main>
          </div>
        </section>
      )}

      <Footer />

      {pendingAiFallback && (
        <NoCaptionsModal
          videoTitle={pendingAiFallback.title}
          message={pendingAiFallback.message}
          progress={aiProgress}
          isTranscribing={state === 'ai-loading'}
          onConfirm={confirmAiFallback}
          onDecline={reset}
        />
      )}
    </main>
  )
}
