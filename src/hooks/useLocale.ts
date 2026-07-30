import { useEffect, useState } from 'react'

export type SiteLocale = 'en' | 'zh' | 'tr' | 'es'

const localeLanguageTags: Record<SiteLocale, string> = {
  en: 'en',
  zh: 'zh-CN',
  tr: 'tr',
  es: 'es',
}

const getInitialLocale = (): SiteLocale => {
  const saved = window.localStorage.getItem('easytran-locale')
  if (saved === 'en' || saved === 'zh' || saved === 'tr' || saved === 'es') return saved

  const browserLocale = window.navigator.language.toLowerCase()
  if (browserLocale.startsWith('zh')) return 'zh'
  if (browserLocale.startsWith('tr')) return 'tr'
  if (browserLocale.startsWith('es')) return 'es'
  return 'en'
}

export function useLocale() {
  const [locale, setLocale] = useState<SiteLocale>(getInitialLocale)

  useEffect(() => {
    document.documentElement.lang = localeLanguageTags[locale]
    window.localStorage.setItem('easytran-locale', locale)
  }, [locale])

  return { locale, setLocale } as const
}
