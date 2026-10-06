import { lazy, Suspense, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from './hooks/useTheme'
import { useLocale } from './hooks/useLocale'
import { SecondaryPageShell } from './components/SecondaryPageShell'
import { PricingMaintenance } from './components/PricingMaintenance'
import { ProductBackdrop } from './components/ProductBackdrop'
import { PublicLocaleBridge } from './components/PublicLocaleBridge'
import { HomePage } from './pages/HomePage'
import { trackEvent } from './lib/analytics'
import './styles/foundation.css'
import './publicTheme.css'
import './themes/reactProduct.css'

const MAINTENANCE_MODE = import.meta.env.VITE_MAINTENANCE_MODE === 'true'

function resolvePublicPath() {
  const url = new URL(window.location.href)
  if (url.pathname === '/privacy') {
    url.pathname = '/docs'
    url.hash = '#privacy-policy'
    window.history.replaceState(window.history.state, '', url)
  }
  return url.pathname
}

const AuthVerifyPage = lazy(() => import('./pages/AuthVerifyPage').then(m => ({ default: m.AuthVerifyPage })))
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })))
const BusinessPage = lazy(() => import('./pages/BusinessPage').then(m => ({ default: m.BusinessPage })))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then(m => ({ default: m.CheckoutPage })))
const CheckoutCompletePage = lazy(() => import('./pages/CheckoutCompletePage').then(m => ({ default: m.CheckoutCompletePage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const DocsPage = lazy(() => import('./pages/DocsPage').then(m => ({ default: m.DocsPage })))
const LegalPage = lazy(() => import('./pages/LegalPage').then(m => ({ default: m.LegalPage })))

function MaintenancePage() {
  return <main className="maintenance-page">maintenance</main>
}

function AppContent({ themeState }: { themeState: ReturnType<typeof useTheme> }) {
  const { theme, productTheme, toggleTheme } = themeState
  const { locale, setLocale } = useLocale()
  const [path, setPath] = useState(resolvePublicPath)
  const [runtimeMode, setRuntimeMode] = useState<'live' | 'maintenance' | 'security'>('live')
  const [releasePolicy, setReleasePolicy] = useState<{ path: string; paidWorkspacesEnabled: boolean } | null>(null)
  const paidWorkspacesEnabled = releasePolicy?.path === path && releasePolicy.paidWorkspacesEnabled

  useEffect(() => {
    const sync = () => setPath(resolvePublicPath())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  useEffect(() => {
    trackEvent('page_view')
  }, [path])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/system/status', { signal: controller.signal, cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('System status unavailable')
        return response.json()
      })
      .then((payload) => {
        if (controller.signal.aborted) return
        setRuntimeMode(payload?.mode === 'maintenance' || payload?.mode === 'security' ? payload.mode : 'live')
        setReleasePolicy({ path, paidWorkspacesEnabled: payload?.features?.paidWorkspacesEnabled === true })
      })
      .catch(() => {
        if (!controller.signal.aborted) setReleasePolicy({ path, paidWorkspacesEnabled: false })
      })
    return () => controller.abort()
  }, [path])

  if ((MAINTENANCE_MODE || runtimeMode === 'maintenance') && path !== '/admin') return <MaintenancePage />

  const localize = (content: ReactNode) => (
    <>
      <PublicLocaleBridge locale={locale} />
      {content}
    </>
  )

  if (!paidWorkspacesEnabled && (path === '/business' || path === '/pricing' || (path === '/dashboard' && import.meta.env.PROD))) {
    const isDashboard = path === '/dashboard'
    return localize(
      <SecondaryPageShell context="pricing" appearance={theme} locale={locale} onLocaleChange={setLocale}>
        <PricingMaintenance workspaceUnavailable={isDashboard} locale={locale} />
      </SecondaryPageShell>,
    )
  }

  if (path === '/dashboard') {
    return localize(
      <Suspense fallback={null}>
        <DashboardPage locale={locale} onLocaleChange={setLocale} appearance={theme} />
      </Suspense>,
    )
  }
  if (path === '/admin') return <Suspense fallback={null}><AdminPage /></Suspense>

  if (path === '/business' || path === '/pricing') {
    return localize(
      <SecondaryPageShell context="pricing" appearance={theme} locale={locale} onLocaleChange={setLocale}>
        <Suspense fallback={null}><BusinessPage /></Suspense>
      </SecondaryPageShell>
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
          paidWorkspacesEnabled={paidWorkspacesEnabled}
        />
      </Suspense>,
    )
  }
  if (path === '/docs') {
    return localize(
      <SecondaryPageShell context="docs" appearance={theme} locale={locale} onLocaleChange={setLocale}>
        <Suspense fallback={null}><DocsPage locale={locale} /></Suspense>
      </SecondaryPageShell>
    )
  }
  if (path === '/terms' || path === '/refunds') {
    return localize(
      <Suspense fallback={null}>
        <LegalPage
          kind={path.slice(1) as 'terms' | 'refunds'}
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
      productTheme={productTheme}
      onThemeToggle={toggleTheme}
      locale={locale}
      onLocaleChange={setLocale}
    />
  )
}

const isHomeRoute = (path: string) => !['/business', '/pricing', '/dashboard', '/admin', '/docs', '/privacy', '/terms', '/refunds', '/auth/verify'].includes(path)
  && !path.startsWith('/checkout')

export default function App() {
  const themeState = useTheme()
  const [path, setPath] = useState(resolvePublicPath)
  useEffect(() => {
    const sync = () => {
      const nextPath = resolvePublicPath()
      setPath(nextPath)
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  return <>
    {isHomeRoute(path) && <ProductBackdrop theme={themeState.productTheme} />}
    <div key={path} className="route-transition">
      <AppContent themeState={themeState} />
    </div>
  </>
}
