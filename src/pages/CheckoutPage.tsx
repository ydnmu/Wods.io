import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Code2,
  Crown,
  Lock,
  Mail,
  ShieldCheck,
  User,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { SiteTopbar } from '../components/SiteTopbar'
import { ThemeBackdrop } from '../components/ThemeBackdrop'
import { PLANS } from '../lib/plans'
import type { PlanKey } from '../lib/plans'
import type { SiteLocale } from '../hooks/useLocale'
import type { Theme } from '../hooks/useTheme'

type CheckoutPlanKey = Exclude<PlanKey, 'free'>

const checkoutMeta: Record<CheckoutPlanKey, { name: string; icon: typeof Code2; summary: string }> = {
  api: {
    name: 'Developer',
    icon: Code2,
    summary: 'REST API, usage dashboard, API key management, and webhooks for solo builders.',
  },
  business: {
    name: 'Business',
    icon: Building2,
    summary: 'Batch jobs, channel automation, priority workflow tools, and higher monthly quota.',
  },
  custom: {
    name: 'Custom',
    icon: Crown,
    summary: 'Custom limits, SLA, SSO, white-label options, and dedicated onboarding.',
  },
}

export function CheckoutPage({
  planKey,
  theme,
  onThemeToggle,
  locale,
  onLocaleChange,
}: {
  planKey: PlanKey
  theme: Theme
  onThemeToggle: () => void
  locale: SiteLocale
  onLocaleChange: (locale: SiteLocale) => void
}) {
  const safePlanKey: CheckoutPlanKey = planKey === 'business' || planKey === 'custom' || planKey === 'api' ? planKey : 'api'
  const plan = PLANS[safePlanKey]
  const meta = checkoutMeta[safePlanKey]
  const Icon = meta.icon
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [billingMode, setBillingMode] = useState<'unconfigured' | 'polar'>('unconfigured')
  const isCustom = safePlanKey === 'custom'
  const isDeveloper = safePlanKey === 'api'
  const isBusiness = safePlanKey === 'business'
  const checkoutReady = billingMode !== 'unconfigured'
  const selectedQuantity = 1
  const monthlyPrice = plan.price
  const checkoutProviderName = 'Polar'
  const visibleFeatures = plan.features.slice(0, 6)

  useEffect(() => {
    fetch('/api/billing/status')
      .then((response) => response.json())
      .then((payload) => setBillingMode(payload.mode === 'polar' ? payload.mode : 'unconfigured'))
      .catch(() => setBillingMode('unconfigured'))
  }, [])

  const submit = async () => {
    if (!checkoutReady && !isBusiness && !isCustom) {
      setMessage('Secure checkout is temporarily unavailable.')
      return
    }

    if (!email.trim()) {
      setMessage('Enter an email first.')
      return
    }

    setSubmitting(true)
    setMessage('')
    try {
      const isLeadRequest = isCustom || safePlanKey === 'business'
      const response = await fetch(isLeadRequest ? '/api/waitlist' : '/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isLeadRequest
          ? { email: email.trim(), plan: safePlanKey, name: name.trim(), company: company.trim() }
          : { email: email.trim(), name: name.trim(), company: company.trim(), plan: safePlanKey, quantity: selectedQuantity }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        setMessage(payload.message || (payload.error === 'active_subscription_exists'
          ? 'This email already has an active subscription.'
          : 'Checkout could not be started.'))
        return
      }

      if (isLeadRequest) {
        setMessage(isCustom || safePlanKey === 'business' ? 'Request received. We will contact you by email.' : 'Invoice request received. We will contact you by email.')
        return
      }

      if (!payload.url) {
        setMessage(`${checkoutProviderName} checkout did not return a payment link.`)
        return
      }
      window.location.assign(payload.url)
    } catch {
      setMessage('Checkout is temporarily unavailable. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="app app-wallpaper checkout-shell">
      <ThemeBackdrop active theme={theme} variant="home" />
      <div className="dot-grid" aria-hidden="true" />
      <SiteTopbar
        theme={theme}
        onThemeToggle={onThemeToggle}
        locale={locale}
        onLocaleChange={onLocaleChange}
      />
      <section className="checkout">
        <div className="checkout-back">
          <button type="button" onClick={() => window.location.assign('/business')}>
            <ArrowLeft size={14} />
            Back to pricing
          </button>
        </div>

        <section className={`checkout-panel checkout-plan-${safePlanKey}`}>
          <div className={`checkout-summary ${safePlanKey === 'business' ? 'featured' : ''} ${safePlanKey === 'api' ? 'developer' : ''} ${isCustom ? 'custom' : ''}`}>
            <div className="cs-body">
              <div className="cs-tier">
                <Icon size={14} />
                {meta.name}
              </div>
              <div className="cs-name">{meta.summary}</div>
              <ul className="cs-features">
                {visibleFeatures.map((feature) => (
                  <li key={feature}><Check size={14} /><span>{feature}</span></li>
                ))}
              </ul>
              <div className="cs-divider" />
                <div className="cs-pricing">
                <div className="cs-line">
                  <span>{isDeveloper ? 'Monthly hour allowance' : meta.name}</span>
                  <span className="v">{isCustom ? 'Custom' : `$${monthlyPrice} / mo`}</span>
                </div>
                <div className="cs-line total">
                  <span>{isCustom ? 'Quote' : 'Due today'}</span>
                  <span className="v">{isCustom ? 'Talk to us' : `$${monthlyPrice}`}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="checkout-form">
            <div className="cf-head">
              <h1>{isCustom ? 'Tell us what you need' : isBusiness ? 'Request workspace access' : 'Complete your setup'}</h1>
              <p>{isCustom || isBusiness ? 'Add your details and describe the volume you plan to process.' : 'Add your account details, review the allowance, then continue to secure payment.'}</p>
            </div>

            <div className="cf-section">
              <div className="cf-section-head"><span className="num">01</span> Account details</div>
              <div className="cf-grid">
                <div className="cf-field">
                  <label>Full name</label>
                  <div className="cf-input with-icon">
                    <span className="ico-l"><User size={14} /></span>
                    <input value={name} onChange={(event) => setName(event.target.value)} type="text" placeholder="Your name" />
                  </div>
                </div>
                <div className="cf-field">
                  <label>Email <span className="req">*</span></label>
                  <div className="cf-input with-icon">
                    <span className="ico-l"><Mail size={14} /></span>
                    <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@company.com" />
                  </div>
                </div>
                {!isDeveloper && (
                  <div className="cf-field">
                    <label>Company</label>
                    <div className="cf-input">
                      <input value={company} onChange={(event) => setCompany(event.target.value)} type="text" placeholder="Optional" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {isDeveloper && (
              <div className="cf-section developer-quota">
                <div className="cf-section-head"><span className="num">02</span> Monthly allowance</div>
                <div className="quota-readout">
                  <strong>{plan.captionHoursPerMonth?.toLocaleString()}h</strong>
                  <span>caption video</span>
                </div>
                <div className="quota-readout">
                  <strong>{plan.aiFallbackHoursPerMonth?.toLocaleString()}h</strong>
                  <span>AI fallback</span>
                </div>
                <p className="quota-note">No request-count quota. Each completed video is billed in whole minutes with a one-minute minimum.</p>
              </div>
            )}


            {isCustom && (
              <div className="cf-section">
                <div className="cf-section-head"><span className="num">02</span> Project scope</div>
                <div className="cf-grid two">
                  <div className="cf-field">
                    <label>Monthly volume</label>
                    <div className="cf-input">
                      <select defaultValue="500k-2m">
                        <option value="100k-500k">10K - 25K hours</option>
                        <option value="500k-2m">25K - 100K hours</option>
                        <option value="2m+">100K+ hours</option>
                      </select>
                    </div>
                  </div>
                  <div className="cf-field">
                    <label>Need</label>
                    <div className="cf-input">
                      <select defaultValue="sla">
                        <option value="sla">SLA + support</option>
                        <option value="white-label">White-label</option>
                        <option value="sso">SSO / security</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!isCustom && (
              <div className="checkout-payment-line">
                <ShieldCheck size={17} />
                <span>
                  <strong>{isBusiness ? 'Business access request' : `Secure ${checkoutProviderName} checkout`}</strong>
                  {isBusiness
                    ? 'No card details are entered here. We confirm the setup by email.'
                    : `Card details are entered on ${checkoutProviderName} after you continue.`}
                </span>
              </div>
            )}

            <button className={isCustom ? 'cf-submit gold' : 'cf-submit'} type="button" onClick={submit} disabled={submitting || (!checkoutReady && isDeveloper)}>
              {submitting ? 'Submitting...' : isCustom ? 'Request a quote' : isBusiness ? 'Request Business access' : 'Continue to secure checkout'}
              <ArrowRight size={15} />
            </button>
            {message && <p className="checkout-message">{message}</p>}
            <div className="cf-foot">
              <span className="secure"><Lock size={13} /> {`Hosted payment via ${checkoutProviderName}.`}</span>
            </div>
          </div>
        </section>
      </section>
    </main>
  )
}
