import { useEffect, useState } from 'react'
import { isProductThemeId, productThemes } from '../themes/productThemes'
import type { ProductThemeId } from '../themes/productThemes'

export type Theme = 'dark' | 'light'

function initialTheme(): ProductThemeId {
  const requested = new URLSearchParams(window.location.search).get('theme')
  if (isProductThemeId(requested)) return requested
  try {
    const saved = window.localStorage.getItem('easytran-product-theme')
    if (isProductThemeId(saved)) return saved
  } catch { /* Storage can be disabled; the URL still selects the theme. */ }
  return 'react-dark'
}

export function useTheme() {
  const [themeId, setThemeId] = useState(initialTheme)
  const productTheme = productThemes[themeId]
  const theme: Theme = productTheme.colorScheme

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.visualTheme = themeId
    document.documentElement.style.colorScheme = theme
    try {
      window.localStorage.setItem('easytran-theme', theme)
      window.localStorage.setItem('easytran-product-theme', themeId)
    } catch { /* Theme selection also works without persistent storage. */ }
  }, [theme, themeId])

  useEffect(() => {
    const sync = () => setThemeId(initialTheme())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'react-light' : 'react-dark'
    const url = new URL(window.location.href)
    url.searchParams.set('theme', next)
    window.history.replaceState(null, '', url)
    setThemeId(next)
  }

  return { theme, themeId, productTheme, toggleTheme } as const
}
