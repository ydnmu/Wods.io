import type { ReactNode } from 'react'
import './InlineMarker.css'

export function InlineMarker({ children }: { children: ReactNode }) {
  return <span className="inline-marker">{children}</span>
}
