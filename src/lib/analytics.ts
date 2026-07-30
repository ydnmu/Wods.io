const getStoredId = (key: string) => {
  const existing = window.localStorage.getItem(key)
  if (existing) return existing

  const value = crypto.randomUUID()
  window.localStorage.setItem(key, value)
  return value
}

export const trackEvent = (event: string, metadata: Record<string, unknown> = {}) => {
  if (typeof window === 'undefined') return

  const payload = {
    visitorId: getStoredId('easytran_visitor_id'),
    sessionId: window.sessionStorage.getItem('easytran_session_id') || crypto.randomUUID(),
    event,
    path: `${window.location.pathname}${window.location.hash}`,
    referrer: document.referrer,
    metadata,
  }

  window.sessionStorage.setItem('easytran_session_id', payload.sessionId)

  fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {})
}
