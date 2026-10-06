import type { SiteLocale } from '../hooks/useLocale'
import MaskedHeading from './react-bits/MaskedHeading'

const labels = {
  en: 'Transcribe',
  tr: 'Metne dönüştür',
  es: 'Transcribir',
  zh: '转录',
} as const

export function TranscribeButton({ locale, disabled }: { locale: SiteLocale; disabled: boolean }) {
  return (
    <button className="cta transcribe-cta" type="submit" disabled={disabled}>
      <MaskedHeading className="cta-label" text={labels[locale]} tag="span"
        mediaType="canvas" src=".product-backdrop .light-pillar-canvas"
        fontSize="inherit" reveal="none" fillScale={1.4} parallax={4} drift={3}
        brightness={0.26} saturation={0.9} weight={700} tracking={0} lineHeight={1.25} />
    </button>
  )
}
