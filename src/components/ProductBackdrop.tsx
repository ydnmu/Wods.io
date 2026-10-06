import { lazy, Suspense } from 'react'
import { CourtyardBackdrop } from './CourtyardBackdrop'
import type { ProductTheme } from '../themes/productThemes'

const LightPillar = lazy(() => import('./react-bits/LightPillar'))

export function ProductBackdrop({ theme }: { theme: ProductTheme }) {
  if (theme.background.kind === 'ancient') return <CourtyardBackdrop active />
  return (
    <div className="product-backdrop" style={theme.tokens} data-visual-theme={theme.id} aria-hidden="true">
      <Suspense fallback={null}>
        <LightPillar key={theme.id} {...theme.background.settings} />
      </Suspense>
      <div className="product-backdrop-shade" />
    </div>
  )
}
