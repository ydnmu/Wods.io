import { lazy, Suspense, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from './hooks/useTheme'
import { useLocale } from './hooks/useLocale'
import { SiteTopbar } from './components/SiteTopbar'
import { ThemeBackdrop } from './components/ThemeBackdrop'
import { PublicLocaleBridge } from './components/PublicLocaleBridge'
import { BusinessPage } from './pages/BusinessPage'
import { DocsPage } from './pages/DocsPage'
import { HomePage } from './pages/HomePage'
import { trackEvent } from './lib/analytics'
import './App.css'
import './publicTheme.css'

const MAINTENANCE_MODE = import.meta.env.VITE_MAINTENANCE_MODE === 'true'

const AuthVerifyPage = lazy(() => import('./pages/AuthVerifyPage').then(m => ({ default: m.AuthVerifyPage })))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then(m => ({ default: m.CheckoutPage })))
const CheckoutCompletePage = lazy(() => import('./pages/CheckoutCompletePage').then(m => ({ default: m.CheckoutCompletePage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const LegalPage = lazy(() => import('./pages/LegalPage').then(m => ({ default: m.LegalPage })))

function MaintenancePage() {
  return <main className="maintenance-page">maintenance</main>
}

function App() {
  const { theme, toggleTheme } = useTheme()
  const { locale, setLocale } = useLocale()
  const [path, setPath] = useState(window.location.pathname)
  const [runtimeMode, setRuntimeMode] = useState<'live' | 'maintenance' | 'security'>('live')

  useEffect(() => {
    const sync = () => setPath(window.location.pathname)
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  useEffect(() => {
    trackEvent('page_view')
  }, [path])

  useEffect(() => {
    fetch('/api/system/status')
      .then((response) => response.json())
      .then((payload) => setRuntimeMode(payload.mode || 'live'))
      .catch(() => undefined)
  }, [path])

  if (MAINTENANCE_MODE || runtimeMode === 'maintenance') return <MaintenancePage />

  const localize = (content: ReactNode) => (
    <>
      <PublicLocaleBridge locale={locale} />
      {content}
    </>
  )

  if (path === '/dashboard') {
    return localize(
      <Suspense fallback={null}>
        <DashboardPage locale={locale} onLocaleChange={setLocale} />
      </Suspense>,
    )
  }
  if (path === '/business') {
    return localize(
      <main className="app app-wallpaper business-shell">
        <ThemeBackdrop active theme={theme} />
        <div className="dot-grid" aria-hidden="true" />
        <SiteTopbar theme={theme} onThemeToggle={toggleTheme} locale={locale} onLocaleChange={setLocale} />
        <BusinessPage />
      </main>
    )
  }
  if (path === '/checkout/complete') {
    return localize(<Suspense fallback={null}><CheckoutCompletePage /></Suspense>)
  }
  if (path.startsWith('/checkout')) {
    const planKey = path.split('/').filter(Boolean)[1] || 'api'
    const normalizedPlan = planKey === 'developer' || planKey === 'api' ? 'api' : planKey === 'custom' ? 'custom' : planKey
    return localize(
      <Suspense fallback={null}>
        <CheckoutPage
          planKey={normalizedPlan as 'free' | 'api' | 'business' | 'custom'}
          theme={theme}
          onThemeToggle={toggleTheme}
          locale={locale}
          onLocaleChange={setLocale}
        />
      </Suspense>,
    )
  }
  if (path === '/docs') {
    return localize(
      <main className="app app-wallpaper docs-shell">
        <ThemeBackdrop active theme={theme} />
        <div className="dot-grid" aria-hidden="true" />
        <SiteTopbar theme={theme} onThemeToggle={toggleTheme} locale={locale} onLocaleChange={setLocale} />
        <DocsPage />
      </main>
    )
  }
  if (path === '/privacy' || path === '/terms' || path === '/refunds') {
    return localize(
      <Suspense fallback={null}>
        <LegalPage
          kind={path.slice(1) as 'privacy' | 'terms' | 'refunds'}
          theme={theme}
          onThemeToggle={toggleTheme}
          locale={locale}
          onLocaleChange={setLocale}
        />
      </Suspense>,
    )
  }
  if (path === '/auth/verify') {
    return localize(<Suspense fallback={null}><AuthVerifyPage /></Suspense>)
  }

  return localize(
    <HomePage
      theme={theme}
      onThemeToggle={toggleTheme}
      locale={locale}
      onLocaleChange={setLocale}
    />
  )
}

export default App
