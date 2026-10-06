import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { ChevronDown, Languages } from 'lucide-react'
import type { SiteLocale } from '../hooks/useLocale'
import type { Theme } from '../hooks/useTheme'
import '../styles/language-flags.css'
import GlideSelect from './react-bits/GlideSelect'
import RubberSegmentNav from './RubberSegmentNav'
import './SiteTopbar.css'

let retainedBannerProgress = 0

// Restore the navigation entry when paid plans launch.
const dashboardNavigationEnabled = false

const localeOptions: Array<{ value: SiteLocale; shortLabel: string; label: string; flag: string }> = [
  { value: 'en', shortLabel: 'EN', label: 'English', flag: 'gb' },
  { value: 'zh', shortLabel: '中文', label: '简体中文', flag: 'cn' },
  { value: 'tr', shortLabel: 'TR', label: 'Türkçe', flag: 'tr' },
  { value: 'es', shortLabel: 'ES', label: 'Español', flag: 'es' },
]

const topbarLabels: Record<SiteLocale, {
  transcribe: string
  docs: string
  pricing: string
  dashboard: string
  navigation: string
  language: string
  home: string
  useLightTheme: string
  useDarkTheme: string
}> = {
  en: {
    transcribe: 'Transcribe',
    docs: 'Docs',
    pricing: 'Pricing',
    dashboard: 'Dashboard',
    navigation: 'Main navigation',
    language: 'Language',
    home: 'EasyTran home',
    useLightTheme: 'Use light theme',
    useDarkTheme: 'Use dark theme',
  },
  zh: {
    transcribe: '转录',
    docs: '文档',
    pricing: '价格',
    dashboard: '控制台',
    navigation: '主导航',
    language: '语言',
    home: 'EasyTran 首页',
    useLightTheme: '使用浅色主题',
    useDarkTheme: '使用深色主题',
  },
  tr: {
    transcribe: 'Transkripsiyon',
    docs: 'Dokümantasyon',
    pricing: 'Fiyatlar',
    dashboard: 'Panel',
    navigation: 'Ana menü',
    language: 'Dil',
    home: 'EasyTran ana sayfası',
    useLightTheme: 'Açık temayı kullan',
    useDarkTheme: 'Koyu temayı kullan',
  },
  es: {
    transcribe: 'Transcribir',
    docs: 'Documentación',
    pricing: 'Precios',
    dashboard: 'Panel',
    navigation: 'Navegación principal',
    language: 'Idioma',
    home: 'Inicio de EasyTran',
    useLightTheme: 'Usar tema claro',
    useDarkTheme: 'Usar tema oscuro',
  },
}

export function SiteTopbar({
  onHomeClick,
  locale,
  onLocaleChange,
  glideLanguage = false,
  theme,
}: {
  onHomeClick?: () => void
  theme?: Theme
  onThemeToggle?: () => void
  locale?: SiteLocale
  onLocaleChange?: (locale: SiteLocale) => void
  glideLanguage?: boolean
}) {
  const [localLocale, setLocalLocale] = useState<SiteLocale>(() =>
    ['en', 'zh', 'tr', 'es'].includes(window.localStorage.getItem('easytran-locale') ?? '')
      ? window.localStorage.getItem('easytran-locale') as SiteLocale
      : 'en',
  )
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)
  const topbarRef = useRef<HTMLElement>(null)
  const languageMenuRef = useRef<HTMLDivElement>(null)
  const activeLocale = locale ?? localLocale
  const path = window.location.pathname
  const active = path === '/docs'
    ? 'docs'
    : path === '/business' || path === '/pricing' || path.startsWith('/checkout')
      ? 'pricing'
      : path === '/dashboard'
        ? 'dashboard'
        : 'transcribe'
  const [scrollProgress, setScrollProgress] = useState(() => (
    Math.max(Math.min(window.scrollY / 48, 1), retainedBannerProgress)
  ))

  useEffect(() => {
    let frame = 0
    const updateScrollProgress = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const nextProgress = Math.min(window.scrollY / 48, 1)
        retainedBannerProgress = nextProgress
        setScrollProgress(nextProgress)
      })
    }

    updateScrollProgress()
    window.addEventListener('scroll', updateScrollProgress, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', updateScrollProgress)
    }
  }, [])

  useEffect(() => {
    if (!languageMenuOpen) return

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) setLanguageMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLanguageMenuOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [languageMenuOpen])

  useEffect(() => {
    if (locale) return
    document.documentElement.lang = localLocale === 'zh' ? 'zh-CN' : localLocale
    window.localStorage.setItem('easytran-locale', localLocale)
  }, [localLocale, locale])

  const navigate = (event: MouseEvent<HTMLAnchorElement>, targetPath: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    event.preventDefault()
    if (path === targetPath) {
      if (targetPath === '/' && onHomeClick) onHomeClick()
      return
    }

    window.history.pushState(null, '', targetPath)
    window.scrollTo(0, 0)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const setFallbackLocale = (nextLocale: SiteLocale) => {
    setLanguageMenuOpen(false)
    if (onLocaleChange) {
      onLocaleChange(nextLocale)
      return
    }
    setLocalLocale(nextLocale)
  }

  const labels = topbarLabels[activeLocale]
  const activeLocaleOption = localeOptions.find((option) => option.value === activeLocale) ?? localeOptions[0]
  const light = theme === 'light'

  return (
    <header
      ref={topbarRef}
      className={scrollProgress > 0 ? 'topbar site-topbar is-scrolled' : 'topbar site-topbar'}
      style={{
        '--topbar-banner-progress': scrollProgress,
        ...(path === '/pricing' || path === '/business'
          ? { backdropFilter: 'none', WebkitBackdropFilter: 'none' }
          : {}),
      } as CSSProperties}
      data-no-translate
    >
      <a
        className="logo site-brand"
        href="/"
        onClick={(event) => navigate(event, '/')}
        aria-label={labels.home}
      >
        <span className="site-brand-mark" aria-hidden="true" />
        <span className="logo-text">EasyTran</span>
      </a>
      <RubberSegmentNav ariaLabel={labels.navigation} items={[
        { href: '/', label: labels.transcribe, active: active === 'transcribe', onClick: event => navigate(event, '/') },
        { href: '/docs', label: labels.docs, active: active === 'docs', onClick: event => navigate(event, '/docs') },
        { href: '/business', label: labels.pricing, active: active === 'pricing', onClick: event => navigate(event, '/business') },
        ...(dashboardNavigationEnabled ? [{ href: '/dashboard', label: labels.dashboard, active: active === 'dashboard', onClick: (event: MouseEvent<HTMLAnchorElement>) => navigate(event, '/dashboard') }] : []),
      ]} />
      <span className="topbar-controls">
        {glideLanguage ? <GlideSelect className="easytran-language" value={activeLocale} ariaLabel={labels.language}
          options={['en', 'tr', 'es', 'zh'].map(value => {
            const option = localeOptions.find(item => item.value === value)!
            return { value, label: value === 'zh' ? '中文' : option.label, tag: value.toUpperCase() }
          })}
          onChange={value => setFallbackLocale(value as SiteLocale)} size="md" placement="right" align="left"
          menuWidth={208} rowHeight={38} fallbackAnchorRef={topbarRef}
          surfaceColor={light ? 'var(--et-select-surface-light)' : 'var(--et-select-surface-dark)'}
          highlightColor={light ? 'var(--et-select-highlight-light)' : 'var(--et-select-highlight-dark)'}
          accentColor="var(--et-select-accent)" textColor={light ? 'var(--et-select-text-light)' : 'var(--et-select-text-dark)'}
          radius={2} popDuration={190} glideDuration={190}
          triggerLabel={<span className="easytran-language-label"><Languages size={17} strokeWidth={2.25} aria-hidden="true" /><span className="easytran-language-code">{activeLocaleOption.shortLabel}</span></span>} /> : <div className="language-selector" ref={languageMenuRef}>
          <button
            className={languageMenuOpen ? 'language-trigger is-open' : 'language-trigger'}
            type="button"
            onClick={() => setLanguageMenuOpen((open) => !open)}
            aria-label={labels.language}
            aria-haspopup="menu"
            aria-expanded={languageMenuOpen}
          >
            <Languages size={15} aria-hidden="true" />
            <span>{activeLocaleOption.shortLabel}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {languageMenuOpen ? (
            <div className="language-menu" role="menu" aria-label={labels.language}>
              {localeOptions.map((option) => (
                <button
                  key={option.value}
                  className={option.value === activeLocale ? 'language-option is-active' : 'language-option'}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.value === activeLocale}
                  onClick={() => setFallbackLocale(option.value)}
                  >
                    <span className="language-option-code">{option.shortLabel}</span>
                    <span>{option.label}</span>
                    <span className="language-option-tail" aria-hidden="true">
                      <span className={`fi fi-${option.flag}`} />
                    </span>
                  </button>
              ))}
            </div>
          ) : null}
        </div>}
      </span>
    </header>
  )
}
