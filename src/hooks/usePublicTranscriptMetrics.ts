import { useEffect, useState, useSyncExternalStore } from 'react'
import { HomepageMetrics } from '../lib/homepageMetrics'

export function usePublicTranscriptMetrics(homeVisible: boolean) {
  const [session] = useState(() => {
    let storage: Storage | null = null
    try { storage = window.sessionStorage } catch { /* Storage can be unavailable in private contexts. */ }
    return new HomepageMetrics({ homeVisible, storage })
  })
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot)

  useEffect(() => {
    session.attach()
    const initial = window.setTimeout(() => { void session.refreshMetrics() }, 0)
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void session.refreshMetrics() }
    const interval = window.setInterval(refreshWhenVisible, 30_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      session.detach()
      window.clearTimeout(initial)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [session])

  return { ...view, holdMetrics: session.hold, completeMetrics: session.completed,
    returnHomeMetrics: session.returnHome, finishMetricRefresh: session.finishRefresh }
}
