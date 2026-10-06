import type { SiteLocale } from '../hooks/useLocale'

const labels = {
  en: 'Transcribe',
  tr: 'Metne dönüştür',
  es: 'Transcribir',
  zh: '转录',
} as const

export function TranscribeButton({ locale, disabled }: { locale: SiteLocale; disabled: boolean }) {
  return (
    <button className="cta transcribe-cta" type="submit" disabled={disabled} aria-label={labels[locale]} title={labels[locale]}>
      <span className="transcribe-button-logo" aria-hidden="true" />
    </button>
  )
}
