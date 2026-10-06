import {
  ArrowLeft,
  Check,
  CircleHelp,
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
import type { ProductTheme } from '../themes/productThemes'
import { useTranscriptionStatus } from '../hooks/useTranscriptionStatus'
import { TranscriptionIndicator } from '../components/TranscriptionIndicator'
import BorderGlow from '../components/react-bits/BorderGlow'
import { TranscribeButton } from '../components/TranscribeButton'
import { ProductInformation } from '../components/ProductInformation'
import { usePublicTranscriptMetrics } from '../hooks/usePublicTranscriptMetrics'

type AppState = 'idle' | 'loading' | 'ai-confirm' | 'ai-loading' | 'ready' | 'result'

type PendingAiFallback = {
  url: string
  title: string
  preserveTitle: boolean
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
    aiFallbackHelp: 'When a standard transcript is unavailable, AI fallback can generate one from the audio.',
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
    submit: '转录',
    promisesLabel: 'EasyTran 承诺',
    promises: ['无追踪', '无广告', '网页不限量', 'AI 转录'],
    noLimitLabel: '网页不限量是什么意思？',
    noLimitHelp: '网页转录对所有人免费，但须遵守合理使用规则。如需批量处理大量视频，请查看我们的方案。',
    aiFallbackHelp: '无法获取字幕时，可以使用 AI 将音频转换为文字。',
    generated: '已生成的转录',
    response: '平均响应时间',
    languages: '支持的语言',
  },
  tr: {
    titleStart: 'URL',
    titleEnd: 'Transkript.',
    placeholder: 'Video bağlantısını yapıştırın (YouTube, Vimeo, TED, Dailymotion)',
    inputLabel: 'Video bağlantısı',
    clear: 'Bağlantıyı temizle',
    submit: 'Metne dönüştür',
    promisesLabel: 'EasyTran ilkeleri',
    promises: ['Takip yok', 'Reklam yok', 'Sınırsız web kullanımı', 'Yapay zekâ desteği'],
    noLimitLabel: 'Sınırsız web kullanımı ne anlama geliyor?',
    noLimitHelp: 'Web üzerinden transkripsiyon, adil kullanım kuralları çerçevesinde herkes için ücretsizdir. Çok sayıda videoyu toplu işlemek için planlarımızı inceleyin.',
    aiFallbackHelp: 'Altyazı bulunamadığında sesi yapay zekâ ile metne dönüştürebilirsiniz.',
    generated: 'oluşturulan transkript',
    response: 'ortalama yanıt süresi',
    languages: 'desteklenen dil',
  },
  es: {
    titleStart: 'URL',
    titleEnd: 'Transcripción.',
    placeholder: 'Pega el enlace de un vídeo (YouTube, Vimeo, TED, Dailymotion)',
    inputLabel: 'URL del vídeo',
    clear: 'Borrar URL',
    submit: 'Transcribir',
    promisesLabel: 'Compromisos de EasyTran',
    promises: ['Sin rastreo', 'Sin anuncios', 'Uso web ilimitado', 'Transcripción con IA'],
    noLimitLabel: '¿Qué significa el uso web ilimitado?',
    noLimitHelp: 'Las transcripciones web son gratuitas para todos, con medidas de uso razonable. ¿Necesitas procesar cientos de miles de vídeos de una vez? Consulta nuestros planes.',
    aiFallbackHelp: 'Cuando no hay subtítulos disponibles, puedes transcribir el audio con IA.',
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
  productTheme,
  onThemeToggle,
  locale,
  onLocaleChange,
}: {
  theme: Theme
  productTheme: ProductTheme
  onThemeToggle: () => void
  locale: SiteLocale
  onLocaleChange: (locale: SiteLocale) => void
}) {
  const copy = homeCopy[locale]
  const inlineTranscription = productTheme.inlineTranscription
  const reactDark = productTheme.id === 'react-dark'
  const reactTheme = inlineTranscription
  const { operationStatus, begin, finish, isCurrent, clear } = useTranscriptionStatus()
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
  const downloadMenuRef = useRef<HTMLDivElement>(null)
  const [startTime, setStartTime] = useState(0)
  const { metrics: publicMetrics, refresh: metricRefresh, holdMetrics, completeMetrics,
    returnHomeMetrics, finishMetricRefresh } = usePublicTranscriptMetrics(state === 'idle')
  const requestStartedAtRef = useRef(0)

  // The response is already complete; give the ready label one short transition
  // before revealing the real workspace. Cleanup also covers a reset/navigation.
  useEffect(() => {
    if (state !== 'ready') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const reveal = window.setTimeout(() => setState('result'), 0)
      return () => window.clearTimeout(reveal)
    }
    const responseMs = operationStatus.status === 'done' ? operationStatus.elapsed * 1_000 : 350
    const reveal = window.setTimeout(() => setState('result'), Math.max(160, 350 - responseMs))
    return () => window.clearTimeout(reveal)
  }, [state, operationStatus])

  useEffect(() => {
    trackEvent('page_view')
  }, [])

  useEffect(() => {
    if (!downloadOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!downloadMenuRef.current?.contains(event.target as Node)) setDownloadOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDownloadOpen(false)
      downloadMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [downloadOpen])

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
    if (state !== 'ai-loading' || inlineTranscription) return
    const interval = window.setInterval(() => {
      setAiProgress((value) => Math.min(92, value + Math.max(1, Math.round((94 - value) / 10))))
    }, 650)
    return () => window.clearInterval(interval)
  }, [state, inlineTranscription])

  const showTranscript = (payload: TranscriptResponse, sourceUrl: string, recordOnClient = false) => {
    transientTranscriptSession = { transcript: payload, url: sourceUrl }
    setTranscript(payload)
    setActiveIndex(0)
    setQuery('')
    setSummary(null)
    setSummaryOpen(false)
    setSummaryError('')
    setPendingAiFallback(null)
    setPlaying(true)
    setState(reactTheme ? 'ready' : 'result')
    trackEvent('transcript_success', { videoId: payload.videoId })

    const responseMs = Math.max(1, Math.round(performance.now() - requestStartedAtRef.current))
    completeMetrics(recordOnClient ? { completionId: crypto.randomUUID(), responseMs } : undefined)
  }

  const requestAiFallback = (details: PendingAiFallback) => {
    setPendingAiFallback(details)
    setAiProgress(0)
    setState('ai-confirm')
  }

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (state === 'loading' || state === 'ai-loading' || state === 'ready') return
    const trimmedUrl = url.trim()

    if (!trimmedUrl) {
      setMessage('Paste a video URL first.')
      return
    }

    holdMetrics()
    setState('loading')
    setMessage('')
    setCopied(false)
    const operation = begin()
    requestStartedAtRef.current = operation.startedAt
    trackEvent('transcript_submit')

    try {
      let response: Response | null = null
      let recordOnClient = false
      let payload: TranscriptResponse & { error?: string; message?: string }

      if (isYoutubeUrl(trimmedUrl)) {
        try {
          payload = await fetchYoutubeTranscriptFromClient(trimmedUrl)
          recordOnClient = true
        } catch (error) {
          if (!isCurrent(operation)) return
          if (!(error instanceof ClientYoutubeError)) throw error
          response = await fetch('/api/transcript', {
            signal: operation.signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: trimmedUrl, allowAiFallback: false }),
          })
          payload = await response.json().catch(() => ({
            error: 'invalid_response',
            message: 'The transcript service returned an invalid response.',
          })) as TranscriptResponse & { error?: string; message?: string }
        }
      } else {
        response = await fetch('/api/transcript', {
          signal: operation.signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmedUrl, allowAiFallback: false }),
        })
        payload = await response.json().catch(() => ({
          error: 'invalid_response',
          message: 'The transcript service returned an invalid response.',
        })) as TranscriptResponse & { error?: string; message?: string }
      }
      if (!isCurrent(operation)) return
      if (payload.error === 'ai_fallback_confirmation_required') {
        clear()
        requestAiFallback({
          url: trimmedUrl,
          title: payload.title || 'AI fallback available',
          preserveTitle: Boolean(payload.title),
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
        throw new Error(payload.message || payload.error || 'Transcript could not be loaded.')
      }

      if (!Array.isArray(payload.segments) || typeof payload.plainText !== 'string') {
        throw new Error('The transcript service returned an invalid response.')
      }
      finish(operation, 'done')
      showTranscript(payload, trimmedUrl, recordOnClient)
    } catch (error) {
      if (!finish(operation, 'error')) return
      returnHomeMetrics()
      setState('idle')
      setMessage(error instanceof Error ? error.message : 'Transcript could not be loaded.')
      trackEvent('transcript_error')
    }
  }

  const confirmAiFallback = async () => {
    if (!pendingAiFallback || state === 'ai-loading') return
    const operation = begin()
    requestStartedAtRef.current = operation.startedAt
    holdMetrics()
    setState('ai-loading')
    setAiProgress(4)
    setMessage('')
    try {
      const response = await fetch('/api/transcript', {
        signal: operation.signal,
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
      if (!isCurrent(operation)) return
      if (!response.ok || payload.error) throw new Error(payload.message || payload.error || 'AI transcription failed.')
      if (!Array.isArray(payload.segments) || typeof payload.plainText !== 'string') {
        throw new Error('The transcript service returned an invalid response.')
      }
      finish(operation, 'done')
      setAiProgress(100)
      showTranscript(payload, pendingAiFallback.url)
    } catch (error) {
      if (!finish(operation, 'error')) return
      setPendingAiFallback(null)
      returnHomeMetrics()
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
      if (!response.ok || payload.error) {
        throw new Error(payload.message || payload.error || 'Summary failed')
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
    clear()
    transientTranscriptSession = null
    returnHomeMetrics()
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
    inlineTranscription ? 'react-home' : 'courtyard-home',
    state === 'result' || (!inlineTranscription && state === 'loading') ? 'app-fixed' : '',
    state === 'idle' || inlineTranscription ? 'app-wallpaper' : '',
  ].filter(Boolean).join(' ')

  const working = state === 'loading' || state === 'ai-loading'
  const ready = state === 'ready'
  const transcriptForm = (
    <form className="url-shell" onSubmit={handleSubmit} data-no-translate aria-busy={working}>
      <span className="url-progress" aria-hidden="true" />
      <div className="url-input-wrap">
        <Link className="url-icon" size={18} aria-hidden="true" />
        <input value={url} ref={inputRef} onChange={event => {
          setUrl(event.target.value)
          setMessage('')
        }}
          className="url-input" placeholder={copy.placeholder} aria-label={copy.inputLabel}
          inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          aria-describedby={message ? 'transcript-form-message' : undefined} readOnly={working || ready} />
        {url && state === 'idle' && <button className="url-clear" type="button" onClick={() => {
          setUrl('')
          setMessage('')
          inputRef.current?.focus()
        }} aria-label={copy.clear}><X size={16} /></button>}
      </div>
      {reactTheme ? <TranscribeButton locale={locale} disabled={working || ready || state === 'ai-confirm'} /> : (
        <button className="cta" type="submit" disabled={working || state === 'ai-confirm'}>{copy.submit}</button>
      )}
    </form>
  )

  return (
    <main className={appClassName} data-visual-theme={productTheme.id} data-transcription-state={state}>
      <div className="dot-grid" aria-hidden="true" />

      <SiteTopbar
        onHomeClick={openHome}
        theme={theme}
        onThemeToggle={onThemeToggle}
        locale={locale}
        onLocaleChange={onLocaleChange}
        glideLanguage={reactTheme}
      />

      {(state === 'idle' || (inlineTranscription && state !== 'result')) && (
        <section className="hero" id="app">
          <h1 className="hero-h1 hero-h1-single" data-no-translate>
            <span>{copy.titleStart}</span>
            <span className="hero-title-arrow" aria-hidden="true">
              {reactTheme && <svg viewBox="0 0 80 40" fill="none" focusable="false">
                <path d="M8 20H72M56 4L72 20L56 36" stroke="currentColor" strokeWidth="2.4"
                  strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </svg>}
            </span>
            <span>{copy.titleEnd}</span>
          </h1>

          {reactTheme ? <BorderGlow className="transcript-border" backgroundColor={reactDark ? '#0B1422' : '#F5F8FC'}
            active={working}
            borderRadius={4} glowColor="214 100 79" colors={['#F5F9FF', '#A6D8FF', '#DBF4FF']}
            edgeSensitivity={20} glowRadius={16} glowIntensity={0.42} coneSpread={16} fillOpacity={0.04}>
            {transcriptForm}
          </BorderGlow> : transcriptForm}

          {inlineTranscription && <div className="hero-operation-status">
            {state !== 'ai-loading' && <TranscriptionIndicator operation={operationStatus} locale={locale} />}
          </div>}

          {message && <p className="form-message" id="transcript-form-message" role="alert">{message}</p>}

          {reactTheme ? <ProductInformation locale={locale} metrics={publicMetrics}
            refresh={metricRefresh} onRefreshComplete={finishMetricRefresh} /> : <div className="hero-meta" data-no-translate>
            <div className="hero-meta-promises" aria-label={copy.promisesLabel}>
              {copy.promises.map((label, index) => {
                const Icon = promiseIcons[index]
                const highlighted = index === 3
                const hasNoLimitHelp = index === 2
                const hasAiFallbackHelp = index === 3
                const hasHelp = hasNoLimitHelp || hasAiFallbackHelp
                const tooltipId = hasNoLimitHelp ? 'no-limit-tooltip' : 'ai-fallback-tooltip'
                return (
                <span
                  className={`${highlighted ? 'is-highlighted' : ''}${hasHelp ? ' has-help' : ''}`}
                  key={label}
                  tabIndex={hasAiFallbackHelp ? 0 : undefined}
                  aria-describedby={hasAiFallbackHelp ? tooltipId : undefined}
                >
                  <Icon className="promise-icon" size={13} strokeWidth={1.8} aria-hidden="true" />
                  {label}
                  {hasNoLimitHelp && (
                    <>
                      <button
                        className="promise-help-button"
                        type="button"
                        aria-label={copy.noLimitLabel}
                        aria-describedby={tooltipId}
                      >
                        <CircleHelp size={14} strokeWidth={1.7} aria-hidden="true" />
                      </button>
                      <small className="promise-tooltip" id={tooltipId} role="tooltip">
                        {copy.noLimitHelp}
                      </small>
                    </>
                  )}
                  {hasAiFallbackHelp && (
                    <small className="promise-tooltip ai-fallback-tooltip" id={tooltipId} role="tooltip">
                      {copy.aiFallbackHelp}
                    </small>
                  )}
                </span>
              )})}
            </div>
            <div>
              <strong>{publicMetrics ? new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(publicMetrics.transcriptCount) : 'N/A'}</strong>
              <span>{copy.generated}</span>
            </div>
            <i />
            <div>
              <strong>{publicMetrics?.averageResponseMs == null ? 'N/A' : `~${(publicMetrics.averageResponseMs / 1_000).toFixed(1)}s`}</strong>
              <span>{copy.response}</span>
            </div>
            <i />
            <div>
              <strong>{LANGUAGES.length}</strong>
              <span>{copy.languages}</span>
            </div>
          </div>}
        </section>
      )}

      {state === 'loading' && !inlineTranscription && (
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
          {inlineTranscription && <TranscriptionIndicator operation={operationStatus} locale={locale} className="result-transcription-status" />}
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
                  <h2 data-no-translate>{summary.title}</h2>
                  <p data-no-translate>{summary.summary}</p>
                  {summary.tags.length > 0 && (
                    <div className="summary-tags" data-no-translate>
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
                      data-no-translate
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
                  <div className="video-title" data-no-translate>{transcript.title || `Video ${transcript.videoId}`}</div>
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
                  aria-pressed={showTimestamps}
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
                <div className="download-menu" ref={downloadMenuRef}>
                  <button
                    className="pill pill-icon"
                    type="button"
                    onClick={() => setDownloadOpen((value) => !value)}
                    aria-label="Download transcript"
                    aria-expanded={downloadOpen}
                    aria-controls={downloadOpen ? 'transcript-downloads' : undefined}
                    title="Download"
                  >
                    <Download size={14} />
                  </button>
                  {downloadOpen && (
                    <div className="download-popover" id="transcript-downloads">
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
                    <span className="line-text" data-no-translate>{renderHighlightedText(paragraphText(paragraph), query)}</span>
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
          preserveTitle={pendingAiFallback.preserveTitle}
          message={pendingAiFallback.message}
          progress={aiProgress}
          isTranscribing={state === 'ai-loading'}
          transcriptionStatus={inlineTranscription ? <TranscriptionIndicator operation={operationStatus} locale={locale} /> : undefined}
          onConfirm={confirmAiFallback}
          onDecline={reset}
        />
      )}
    </main>
  )
}
