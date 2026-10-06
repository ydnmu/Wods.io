import { Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'

export function NoCaptionsModal({
  videoTitle,
  preserveTitle = true,
  message,
  progress,
  isTranscribing,
  transcriptionStatus,
  onConfirm,
  onDecline,
}: {
  videoTitle: string
  preserveTitle?: boolean
  message: string
  progress: number
  isTranscribing: boolean
  transcriptionStatus?: ReactNode
  onConfirm: () => void
  onDecline: () => void
}) {
  return (
    <div className="modal-backdrop ai-fallback-backdrop" role="dialog" aria-modal="true" aria-labelledby="no-captions-title">
      <div className="modal-card ai-fallback-card">
        <span className="modal-kicker"><Sparkles size={13} /> AI fallback</span>
        <h2 id="no-captions-title" data-no-translate={preserveTitle || undefined}>{videoTitle}</h2>
        <p>{message}</p>
        <div className="ai-estimate">
          <span>Estimated time</span>
          <strong>about 1–3 min per 10 min of video</strong>
        </div>
        {isTranscribing ? (
          transcriptionStatus ?? <div className="ai-progress" aria-live="polite">
            <div><span>Transcribing audio</span><strong>{progress}%</strong></div>
            <div className="ai-progress-track"><span style={{ width: `${progress}%` }} /></div>
          </div>
        ) : (
          <div className="ai-fallback-actions">
            <button className="modal-action ai-confirm" type="button" onClick={onConfirm}>
              Use AI fallback
            </button>
            <button className="modal-action ai-decline" type="button" onClick={onDecline}>
              No, new video
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
