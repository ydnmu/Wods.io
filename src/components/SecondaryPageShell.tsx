import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import type { SiteLocale } from '../hooks/useLocale'
import type { Theme } from '../hooks/useTheme'
import { productThemes } from '../themes/productThemes'
import { SiteTopbar } from './SiteTopbar'
import { ProductBackdrop } from './ProductBackdrop'
import '../styles/secondaryPages.css'

const LightPillar = lazy(() => import('./react-bits/LightPillar'))
export type PageContext = 'docs' | 'pricing' | 'auth' | 'dashboard'

const atmosphere = {
  docs: { intensity: .58, rotationSpeed: .09, pillarWidth: 3.2, pillarRotation: 25 },
  auth: { intensity: .28, rotationSpeed: .07, pillarWidth: 2.8, pillarRotation: 28 },
  dashboard: { intensity: .24, rotationSpeed: .07, pillarWidth: 3.2, pillarRotation: 25 },
} as const

export function SecondaryPageShell({ context, appearance = 'dark', locale, onLocaleChange, className = '', children }: {
  context: PageContext; appearance?: Theme; locale: SiteLocale;
  onLocaleChange: (locale: SiteLocale) => void; className?: string; children: ReactNode
}) {
  const product = productThemes[appearance === 'light' ? 'react-light' : 'react-dark']
  const base = product.background
  return <main className={`app secondary-page ${className}`} data-page-context={context} data-page-tone={appearance}>
    {context === 'pricing' ? <ProductBackdrop theme={product} /> : <div className="secondary-backdrop" aria-hidden="true">
      {base.kind === 'light-pillar' && <Suspense fallback={null}>
        <LightPillar key={`${context}-${appearance}`} {...base.settings} {...atmosphere[context]} quality="medium" />
      </Suspense>}
    </div>}
    <SiteTopbar theme={appearance} locale={locale} onLocaleChange={onLocaleChange} glideLanguage />
    {children}
  </main>
}
