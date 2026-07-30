import { useEffect } from 'react'

export type Theme = 'dark' | 'light'

export function useTheme() {
  const theme: Theme = 'dark'

  useEffect(() => {
    document.documentElement.dataset.theme = 'dark'
    document.documentElement.style.colorScheme = 'dark'
    window.localStorage.setItem('easytran-theme', 'dark')
  }, [])

  const toggleTheme = () => undefined

  return { theme, toggleTheme } as const
}
