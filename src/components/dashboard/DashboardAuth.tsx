import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import type { SiteLocale } from '../../hooks/useLocale'
import type { Theme } from '../../hooks/useTheme'
import { SecondaryPageShell } from '../SecondaryPageShell'

const loginCopy = {
  en: {
    home: 'EasyTran home', workspace: 'Workspace', language: 'Language', signIn: 'Sign in', accessKey: 'Access key', loginMethod: 'Login method',
    username: 'Username', password: 'Password', usernamePlaceholder: 'Enter your username', passwordPlaceholder: 'Enter your password',
    temporaryKey: 'Temporary access key', keyPlaceholder: 'Paste the key from your email', checking: 'Checking…', enter: 'Enter workspace',
    continue: 'Continue setup', session: 'Session stays active for 7 days', back: 'Back to transcribe',
    migrationError: 'Dashboard credential setup is not available yet.', credentialError: 'Username or password is incorrect.', keyError: 'Access key is incorrect.',
  },
  zh: {
    home: 'EasyTran 首页', workspace: '工作区', language: '语言', signIn: '登录', accessKey: '访问密钥', loginMethod: '登录方式',
    username: '用户名', password: '密码', usernamePlaceholder: '输入用户名', passwordPlaceholder: '输入密码',
    temporaryKey: '临时访问密钥', keyPlaceholder: '粘贴邮件中的密钥', checking: '正在检查…', enter: '进入工作区',
    continue: '继续设置', session: '登录状态保持 7 天', back: '返回转录',
    migrationError: '控制台凭据设置暂不可用。', credentialError: '用户名或密码不正确。', keyError: '访问密钥不正确。',
  },
  tr: {
    home: 'EasyTran ana sayfası', workspace: 'Çalışma alanı', language: 'Dil', signIn: 'Oturum aç', accessKey: 'Erişim anahtarı', loginMethod: 'Giriş yöntemi',
    username: 'Kullanıcı adı', password: 'Şifre', usernamePlaceholder: 'Kullanıcı adınızı girin', passwordPlaceholder: 'Şifrenizi girin',
    temporaryKey: 'Geçici erişim anahtarı', keyPlaceholder: 'E-postanızdaki anahtarı yapıştırın', checking: 'Kontrol ediliyor…', enter: 'Çalışma alanına gir',
    continue: 'Kuruluma devam et', session: 'Oturumunuz 7 gün boyunca açık kalır', back: 'Transkripsiyona dön',
    migrationError: 'Panel giriş bilgileri henüz oluşturulamıyor.', credentialError: 'Kullanıcı adı veya şifre hatalı.', keyError: 'Erişim anahtarı hatalı.',
  },
  es: {
    home: 'Inicio de EasyTran', workspace: 'Espacio de trabajo', language: 'Idioma', signIn: 'Iniciar sesión', accessKey: 'Clave de acceso', loginMethod: 'Método de acceso',
    username: 'Usuario', password: 'Contraseña', usernamePlaceholder: 'Introduce tu usuario', passwordPlaceholder: 'Introduce tu contraseña',
    temporaryKey: 'Clave de acceso temporal', keyPlaceholder: 'Pega la clave de tu correo', checking: 'Comprobando…', enter: 'Entrar al espacio de trabajo',
    continue: 'Continuar configuración', session: 'La sesión permanece activa 7 días', back: 'Volver a transcribir',
    migrationError: 'La configuración de credenciales aún no está disponible.', credentialError: 'El usuario o la contraseña no son correctos.', keyError: 'La clave de acceso no es correcta.',
  },
} as const

export function DashboardLoginGate({
  locale,
  onLocaleChange,
  appearance = 'dark',
}: {
  locale: SiteLocale
  onLocaleChange: (locale: SiteLocale) => void
  appearance?: Theme
}) {
  const [mode, setMode] = useState<'username' | 'key'>(() => (
    new URLSearchParams(window.location.search).get('mode') === 'key' ? 'key' : 'username'
  ))
  const [username, setUsername] = useState('')
  const [key, setKey] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const copy = loginCopy[locale]

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (mode === 'username' ? (!username.trim() || !password) : !key.trim()) return

    setLoading(true)
    setError('')
    const response = await fetch(mode === 'username' ? '/api/auth/password-login' : '/api/auth/bootstrap-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mode === 'username' ? { username, password } : { key }),
    })
    const payload = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) {
      setError(payload.error === 'credential_migration_required'
        ? copy.migrationError
        : mode === 'username'
          ? copy.credentialError
          : copy.keyError)
      return
    }
    window.location.reload()
  }

  return (
    <SecondaryPageShell context="auth" appearance={appearance} locale={locale} onLocaleChange={next => { onLocaleChange(next); setError('') }} className="dashboard-shell dashboard-login-shell">
      <section className="dashboard-auth-view"><div className="dashboard-auth-frame">
        <form className="login-card dashboard-auth-card" onSubmit={submit} data-no-translate>
          <header className="dashboard-auth-topline">
            <a className="dashboard-auth-brand" href="/" aria-label={copy.home}>
              <span className="dashboard-brand-mark" aria-hidden="true" />
              <strong>EasyTran</strong>
            </a>
            <span className="page-kicker">{copy.workspace}</span>
          </header>

          <div className="dashboard-auth-card-head">
            <h2 key={`${mode}-${locale}`} className="dashboard-auth-mode-title">{mode === 'username' ? copy.signIn : copy.accessKey}</h2>
          </div>

          <div className="login-method-tabs" role="tablist" aria-label={copy.loginMethod}>
            <button className={mode === 'username' ? 'active' : ''} type="button" role="tab" aria-selected={mode === 'username'} onClick={() => { setMode('username'); setError('') }}>
              <span>{copy.username}</span>
            </button>
            <button className={mode === 'key' ? 'active' : ''} type="button" role="tab" aria-selected={mode === 'key'} onClick={() => { setMode('key'); setError('') }}>
              <span>{copy.accessKey}</span>
            </button>
          </div>

          <div className="dashboard-auth-fields">
            <div key={`${mode}-${locale}`} className="dashboard-auth-field-stack">
              {mode === 'username' ? (
                <>
                  <label>
                    <span>{copy.username}</span>
                    <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={copy.usernamePlaceholder} autoComplete="username" required />
                  </label>
                  <label>
                    <span>{copy.password}</span>
                    <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={copy.passwordPlaceholder} autoComplete="current-password" required />
                  </label>
                </>
              ) : (
                <label>
                  <span>{copy.temporaryKey}</span>
                  <input autoFocus type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={copy.keyPlaceholder} autoComplete="one-time-code" required />
                </label>
              )}
            </div>
          </div>

          {error && <div className="dashboard-login-error" role="alert">{error}</div>}

          <button className="dashboard-auth-submit" type="submit" disabled={loading}>
            <span key={`${mode}-${loading}-${locale}`} className="dashboard-auth-submit-label">{loading ? copy.checking : mode === 'username' ? copy.enter : copy.continue}</span>
            {!loading && <ArrowRight size={18} aria-hidden="true" />}
          </button>

          <footer className="dashboard-auth-card-footer">
            <small className="login-session-note">{copy.session}</small>
            <a className="dashboard-auth-back" href="/">{copy.back}</a>
          </footer>
        </form>
      </div></section>
    </SecondaryPageShell>
  )
}

export function DashboardSetupGate({ locale, onLocaleChange, appearance = 'dark' }: {
  locale: SiteLocale; onLocaleChange: (locale: SiteLocale) => void; appearance?: Theme
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password !== confirmation) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError('')
    const response = await fetch('/api/auth/complete-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const payload = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) {
      setError(payload.error === 'username_taken'
        ? 'That username is already taken.'
        : payload.error === 'invalid_username'
          ? 'Use 3–32 letters, numbers, dots, dashes, or underscores.'
          : payload.error === 'invalid_password'
            ? 'Use at least 10 characters.'
            : 'Setup could not be completed.')
      return
    }
    window.history.replaceState(null, '', '/dashboard')
    window.location.reload()
  }

  return (
    <SecondaryPageShell context="auth" appearance={appearance} locale={locale} onLocaleChange={onLocaleChange} className="dashboard-shell dashboard-login-shell">
      <section className="dashboard-auth-view"><form className="login-card setup-card" onSubmit={submit}>
        <span className="dash-logo">EasyTran</span>
        <span className="setup-kicker">Required setup</span>
        <h1>Create your login</h1>
        <p>Your access key will stop working after this step.</p>
        <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Choose a username" autoComplete="username" minLength={3} maxLength={32} required />
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Create a password" autoComplete="new-password" minLength={10} maxLength={128} required />
        <input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Confirm password" autoComplete="new-password" minLength={10} maxLength={128} required />
        {error && <div className="dashboard-login-error">{error}</div>}
        <button type="submit" disabled={loading}>{loading ? 'Creating login…' : 'Create login'}</button>
        <small className="setup-note"><ShieldCheck size={13} /> Access key disabled on completion</small>
      </form></section>
    </SecondaryPageShell>
  )
}
