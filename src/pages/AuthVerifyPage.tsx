import { useEffect } from 'react'

export function AuthVerifyPage() {
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token')
    window.location.assign(token ? `/api/auth/verify?token=${token}` : '/?auth=invalid')
  }, [])

  return (
    <main className="dashboard-shell centered">
      <span>Verifying...</span>
    </main>
  )
}
