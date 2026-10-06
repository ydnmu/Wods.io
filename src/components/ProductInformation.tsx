import { Fragment } from 'react'
import type { ReactNode } from 'react'
import type { SiteLocale } from '../hooks/useLocale'
import { LANGUAGES } from '../lib/languages'
import type { PublicTranscriptMetrics } from '../lib/publicMetrics'
import type { MetricRefresh } from '../lib/homepageMetrics'
import { InlineMarker } from './InlineMarker'
import { MetricValue } from './MetricValue'
import './ProductInformation.css'

const copy = {
  en: {
    paragraph: 'Create clear transcripts{averageClause} in {languages}{totalClause}. No subtitles? {ai} transcribes the audio directly. Web transcription is {free} and ad-free; free transcripts are not saved to the server archive. Paid plans process hundreds or thousands of videos in parallel.',
    averageClause: ' in {average}', average: '{duration} on average', languages: '{count} languages',
    totalClause: ', with {total}', total: '{count} transcripts generated so far',
    ai: 'AI fallback', free: 'unlimited and free',
  },
  tr: {
    paragraph: '{languages} desteğiyle{averageClause} transkript oluşturun{totalClause}. Altyazı bulunamadığında {ai} sesi doğrudan metne dönüştürür. Web üzerinden kullanım {free} ve reklamsızdır; ücretsiz transkriptler sunucu arşivine kaydedilmez. Ücretli planlar yüzlerce veya binlerce videoyu paralel işlemek için tasarlanmıştır.',
    averageClause: ' {average}', average: 'ortalama {duration} içinde', languages: '{count} dil',
    totalClause: '; {total}', total: 'şimdiye kadar {count} transkript oluşturuldu',
    ai: 'yapay zekâ desteği', free: 'sınırsız, ücretsiz',
  },
  es: {
    paragraph: 'Genera transcripciones claras{averageClause} en {languages}{totalClause}. Si no hay subtítulos, {ai} convierte el audio en texto. La transcripción web es {free} y sin anuncios; las transcripciones gratuitas no se guardan en el archivo del servidor. Los planes de pago permiten procesar cientos o miles de vídeos en paralelo.',
    averageClause: ' en {average}', average: '{duration} de media', languages: '{count} idiomas',
    totalClause: ', con {total}', total: '{count} transcripciones generadas hasta ahora',
    ai: 'la transcripción con IA', free: 'ilimitada y gratuita',
  },
  zh: {
    paragraph: '{averageClause}获得清晰的转录文本，支持{languages}{totalClause}。没有字幕时，{ai}可直接将音频转为文字。网页转录{free}，无广告；免费转录文本不会保存到服务器归档。付费方案可并行处理数百或数千个视频。',
    averageClause: '{average}内', average: '平均{duration}', languages: '{count}种语言',
    totalClause: '，{total}', total: '迄今已生成{count}份转录',
    ai: 'AI 转录', free: '不限量且免费',
  },
} as const

function template(text: string, values: Record<string, ReactNode>) {
  return text.split(/(\{[a-zA-Z]+\})/).map((part, index) =>
    <Fragment key={index}>{part.startsWith('{') ? values[part.slice(1, -1)] : part}</Fragment>,
  )
}

function durationParts(locale: SiteLocale, milliseconds: number) {
  const parts = new Intl.NumberFormat(locale, {
    style: 'unit', unit: 'second', unitDisplay: locale === 'tr' ? 'short' : 'narrow', maximumFractionDigits: 1,
  }).formatToParts(milliseconds / 1000)
  const numeric = (part: Intl.NumberFormatPart) => ['integer', 'group', 'decimal', 'fraction'].includes(part.type)
  const start = parts.findIndex(numeric)
  const end = parts.findLastIndex(numeric)
  return { number: parts.slice(start, end + 1).map(part => part.value).join(''),
    prefix: parts.slice(0, start).map(part => part.value).join(''),
    suffix: parts.slice(end + 1).map(part => part.value).join('') }
}

export function ProductInformation({ locale, metrics, refresh = null, onRefreshComplete }: {
  locale: SiteLocale; metrics: PublicTranscriptMetrics | null; refresh?: MetricRefresh | null;
  onRefreshComplete?: (id: number) => void
}) {
  const text = copy[locale]
  const countFormat = new Intl.NumberFormat(locale)
  const average = metrics?.averageResponseMs != null ? durationParts(locale, metrics.averageResponseMs) : null
  const previousAverage = refresh?.previous.averageResponseMs != null
    ? durationParts(locale, refresh.previous.averageResponseMs).number : undefined
  const averageClause = average ? template(text.averageClause, {
    average: <InlineMarker>{template(text.average, {
      duration: <>{average.prefix}<MetricValue kind="average" value={average.number}
        previous={previousAverage} refreshId={refresh?.id} onComplete={onRefreshComplete} />{average.suffix}</>,
    })}</InlineMarker>,
  }) : ''
  const totalClause = metrics ? template(text.totalClause, {
    total: <InlineMarker>{template(text.total, {
      count: <MetricValue kind="total" value={countFormat.format(metrics.transcriptCount)}
        previous={refresh ? countFormat.format(refresh.previous.transcriptCount) : undefined}
        refreshId={refresh?.id} onComplete={onRefreshComplete} />,
    })}</InlineMarker>,
  }) : ''
  const values = {
    averageClause,
    totalClause,
    languages: <InlineMarker>{template(text.languages, { count: countFormat.format(LANGUAGES.length) })}</InlineMarker>,
    ai: <InlineMarker>{text.ai}</InlineMarker>,
    free: <InlineMarker>{text.free}</InlineMarker>,
  }
  return <div className="product-information" data-no-translate>
    <p className="product-information-copy">{template(text.paragraph, values)}</p>
  </div>
}
