import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Check, Loader2 } from 'lucide-react'
import type { FormEvent } from 'react'
import type { SiteLocale } from '../hooks/useLocale'
import '../styles/emailWaitlist.css'

const copy = {
  en: { label:'Email address', submit:'Notify me', sending:'Saving…', success:"You're on the list.", successNote:"We'll email you when paid plans are ready.", error:'We couldn’t save your email. Please try again.', limited:'Too many attempts. Please try again later.' },
  tr: { label:'E-posta adresi', submit:'Beni bilgilendir', sending:'Kaydediliyor…', success:'Bildirim listesine kaydoldunuz.', successNote:'Ücretli planlar kullanıma açıldığında sizi e-posta ile bilgilendireceğiz.', error:'E-posta adresiniz kaydedilemedi. Lütfen yeniden deneyin.', limited:'Çok fazla deneme yaptınız. Lütfen daha sonra yeniden deneyin.' },
  es: { label:'Correo electrónico', submit:'Avísame', sending:'Guardando…', success:'Ya estás en la lista.', successNote:'Te avisaremos por correo cuando los planes de pago estén listos.', error:'No pudimos guardar tu correo. Inténtalo de nuevo.', limited:'Demasiados intentos. Vuelve a intentarlo más tarde.' },
  zh: { label:'电子邮件地址', submit:'通知我', sending:'正在保存…', success:'您已加入名单。', successNote:'付费方案准备就绪后，我们会通过邮件通知您。', error:'无法保存您的邮箱，请重试。', limited:'尝试次数过多，请稍后重试。' },
} as const

export function EmailWaitlist({ locale = 'en' }: { locale?: SiteLocale }) {
  const text = copy[locale]
  const inputId = useId()
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle'|'submitting'|'success'|'error'>('idle')
  const [errorKind, setErrorKind] = useState<'error'|'limited'>('error')
  const inFlight = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const successRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (state === 'success') successRef.current?.focus({ preventScroll:true }) }, [state])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (inFlight.current || state === 'success') return
    inFlight.current = true
    controller.current = new AbortController()
    setState('submitting')
    try {
      const response = await fetch('/api/waitlist', { method:'POST', headers:{'Content-Type':'application/json'}, signal:controller.current.signal,
        body:JSON.stringify({ email:email.trim(), purpose:'pricing_updates', consent:true }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.success !== true) { setErrorKind(response.status === 429 ? 'limited' : 'error'); setState('error'); return }
      setState('success')
    } catch { if (!controller.current.signal.aborted) { setErrorKind('error'); setState('error') } }
    finally { inFlight.current = false }
  }

  return <div className="email-waitlist" data-state={state} data-no-translate>
    <div className="waitlist-presentation">
    {state === 'success' ? <div className="waitlist-success waitlist-status" ref={successRef} tabIndex={-1} role="status" aria-live="polite">
      <h2>{text.success}<Check size={21} strokeWidth={2} aria-hidden="true" /></h2>
      <p>{text.successNote}</p>
    </div> :
    <form onSubmit={submit} aria-busy={state === 'submitting'}>
      <label className="waitlist-email-label" htmlFor={inputId}>{text.label}</label>
      <div className="waitlist-fields">
        <input id={inputId} type="email" inputMode="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); if (state === 'error') setState('idle') }}
          placeholder="your@email.com" maxLength={254} required disabled={state === 'submitting'} aria-describedby={state === 'error' ? `${inputId}-status` : undefined} />
        <button type="submit" disabled={state === 'submitting'}>
          {state === 'submitting' ? text.sending : text.submit}
          {state === 'submitting' ? <Loader2 className="waitlist-spinner" size={16} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
        </button>
      </div>
      <div id={`${inputId}-status`} className="waitlist-status waitlist-error" role={state === 'error' ? 'alert' : 'status'} aria-live="polite">
        {state === 'error' ? text[errorKind] : ''}
      </div>
    </form>}
    </div>
  </div>
}
