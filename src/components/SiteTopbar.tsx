import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { Check, ChevronDown, Languages } from 'lucide-react'
import type { SiteLocale } from '../hooks/useLocale'
import type { Theme } from '../hooks/useTheme'

let retainedBannerProgress = 0

const localeOptions: Array<{ value: SiteLocale; shortLabel: string; label: string }> = [
  { value: 'en', shortLabel: 'EN', label: 'English' },
  { value: 'zh', shortLabel: '中文', label: '简体中文' },
  { value: 'tr', shortLabel: 'TR', label: 'Türkçe' },
  { value: 'es', shortLabel: 'ES', label: 'Español' },
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
    transcribe: 'Transkript',
    docs: 'Dokümanlar',
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
}: {
  onHomeClick?: () => void
  theme?: Theme
  onThemeToggle?: () => void
  locale?: SiteLocale
  onLocaleChange?: (locale: SiteLocale) => void
}) {
  const [localLocale, setLocalLocale] = useState<SiteLocale>(() =>
    ['en', 'zh', 'tr', 'es'].includes(window.localStorage.getItem('easytran-locale') ?? '')
      ? window.localStorage.getItem('easytran-locale') as SiteLocale
      : 'en',
  )
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)
  const languageMenuRef = useRef<HTMLDivElement>(null)
  const activeLocale = locale ?? localLocale
  const path = window.location.pathname
  const active = path === '/docs'
    ? 'docs'
    : path === '/business' || path.startsWith('/checkout')
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

  return (
    <header
      className={scrollProgress > 0 ? 'topbar is-scrolled' : 'topbar'}
      style={{ '--topbar-banner-progress': scrollProgress } as CSSProperties}
      data-no-translate
    >
      <a
        className="logo"
        href="/"
        onClick={(event) => navigate(event, '/')}
        aria-label={labels.home}
      >
        <img className="logo-icon" src="/easytran-logo.svg" alt="" aria-hidden="true" />
      </a>
      <nav className="topbar-nav" aria-label={labels.navigation}>
        <a className={active === 'transcribe' ? 'nav-link active' : 'nav-link'} href="/" onClick={(event) => navigate(event, '/')}>{labels.transcribe}</a>
        <a className={active === 'docs' ? 'nav-link active' : 'nav-link'} href="/docs" onClick={(event) => navigate(event, '/docs')}>{labels.docs}</a>
        <a className={active === 'pricing' ? 'nav-link active' : 'nav-link'} href="/business" onClick={(event) => navigate(event, '/business')}>{labels.pricing}</a>
        <a className={active === 'dashboard' ? 'nav-link active' : 'nav-link'} href="/dashboard" onClick={(event) => navigate(event, '/dashboard')}>{labels.dashboard}</a>
      </nav>
      <span className="topbar-controls">
        <div className="language-selector" ref={languageMenuRef}>
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
                  {option.value === activeLocale ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </span>
    </header>
  )
}
