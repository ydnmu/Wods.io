import LatticeLoader from './react-bits/LatticeLoader'
import type { TranscriptionStatus } from '../hooks/useTranscriptionStatus'
import type { SiteLocale } from '../hooks/useLocale'

const labels = {
  en: { label: 'Transcribing', doneLabel: 'Done in', errorLabel: 'Failed after' },
  tr: { label: 'Transkript hazırlanıyor', doneLabel: 'Tamamlandı', errorLabel: 'Başarısız' },
  es: { label: 'Transcribiendo', doneLabel: 'Completado en', errorLabel: 'Falló después de' },
  zh: { label: '正在转录', doneLabel: '完成，用时', errorLabel: '失败，用时' },
}

export function TranscriptionIndicator({ operation, locale, className = '' }: {
  operation: TranscriptionStatus; locale: SiteLocale; className?: string
}) {
  if (operation.status === 'idle') return null
  return (
    <div className={`transcription-status ${className}`} data-no-translate>
      <LatticeLoader {...labels[locale]} status={operation.status} startedAt={operation.startedAt}
        elapsed={operation.status === 'working' ? undefined : operation.elapsed}
        pattern="orbit" grid={3} shape="round" glow={false} showTimer
        color="var(--rt-loader)" doneColor="var(--rt-success)" errorColor="var(--rt-error)"
        fontSize={13} cellSize={4} gap={2} />
    </div>
  )
}
