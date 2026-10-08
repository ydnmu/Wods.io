import {
  ArrowLeft,
  ArrowRight,
  Building2,
  BadgeCheck,
  Check,
  Code2,
  Crown,
  Lock,
  Mail,
  ReceiptText,
  ShieldCheck,
  User,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { SiteTopbar } from '../components/SiteTopbar'
import { ThemeBackdrop } from '../components/ThemeBackdrop'
import { PLANS } from '../lib/plans'
import type { PlanKey } from '../lib/plans'
import type { SiteLocale } from '../hooks/useLocale'
import type { Theme } from '../hooks/useTheme'
import '../styles/checkout.css'

type CheckoutPlanKey = Exclude<PlanKey, 'free'>
type BillingCycle = 'monthly' | 'annual'
type CheckoutPlanAvailability = Partial<Record<
  Exclude<CheckoutPlanKey, 'custom'>,
  Partial<Record<BillingCycle, boolean>>
>>

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
  paidWorkspacesEnabled = false,
}: {
  planKey: PlanKey
  theme: Theme
  onThemeToggle: () => void
  locale: SiteLocale
  onLocaleChange: (locale: SiteLocale) => void
  paidWorkspacesEnabled?: boolean
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
  const [billingAvailable, setBillingAvailable] = useState(false)
  const [billingPolicyEnabled, setBillingPolicyEnabled] = useState(false)
  const [availablePlans, setAvailablePlans] = useState<CheckoutPlanAvailability | null>(null)
  const isCustom = safePlanKey === 'custom'
  const isDeveloper = safePlanKey === 'api'
  const requestedBillingCycle = new URLSearchParams(window.location.search).get('billing')
  const billingCycle: BillingCycle = requestedBillingCycle === 'annual' ? 'annual' : 'monthly'
  const planAvailability = isCustom ? undefined : availablePlans?.[safePlanKey]
  const selectedCycleAvailable = planAvailability?.[billingCycle] === true
  const checkoutReady = paidWorkspacesEnabled && billingPolicyEnabled && billingAvailable && billingMode === 'polar'
    && (isCustom || selectedCycleAvailable)
  const selectedQuantity = 1
  const monthlyPrice = plan.price
  const annualPrice = monthlyPrice === null ? null : monthlyPrice * 12 * 0.6
  const monthlyEquivalent = monthlyPrice === null ? null : monthlyPrice * 0.6
  const dueToday = billingCycle === 'annual' ? annualPrice : monthlyPrice
  const formatPrice = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2)
  const checkoutProviderName = 'Polar'
  const visibleFeatures = plan.features.slice(0, 4)
  const billingCycleLabel = billingCycle === 'annual' ? 'Yearly billing' : 'Monthly billing'
  const checkoutButtonLabel = isCustom
    ? 'Request a quote'
    : dueToday === null
      ? 'Continue to Polar checkout'
      : `Continue to Polar · $${formatPrice(dueToday)}`

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/billing/status', { signal: controller.signal, cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Billing status unavailable')
        return response.json()
      })
      .then((payload) => {
        if (controller.signal.aborted) return
        setBillingMode(payload?.mode === 'polar' ? payload.mode : 'unconfigured')
        setBillingAvailable(payload?.available === true && payload?.providerConfigured === true)
        setBillingPolicyEnabled(payload?.features?.paidWorkspacesEnabled === true)
        setAvailablePlans(payload?.plans && typeof payload.plans === 'object' ? payload.plans : null)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setBillingMode('unconfigured')
        setBillingAvailable(false)
        setBillingPolicyEnabled(false)
        setAvailablePlans(null)
      })
    return () => controller.abort()
  }, [])

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (submitting) return
    if (!checkoutReady) {
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
      const isLeadRequest = isCustom
      const response = await fetch(isLeadRequest ? '/api/waitlist' : '/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isLeadRequest
          ? { email: email.trim(), plan: safePlanKey, name: name.trim(), company: company.trim() }
          : {
              email: email.trim(),
              name: name.trim(),
              company: company.trim(),
              plan: safePlanKey,
              billing_cycle: billingCycle,
              quantity: selectedQuantity,
            }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (response.status >= 500 || payload.error === 'paid_workspaces_unavailable') setBillingAvailable(false)
        setMessage(payload.message || (payload.error === 'active_subscription_exists'
          ? 'This email already has an active subscription.'
          : 'Checkout could not be started.'))
        return
      }

      if (isLeadRequest) {
        setMessage('Request received. We will contact you by email.')
        return
      }

      if (!payload.url) {
        setBillingAvailable(false)
        setMessage(`${checkoutProviderName} checkout did not return a payment link.`)
        return
      }
      window.location.assign(payload.url)
    } catch {
      setBillingAvailable(false)
      setMessage('Checkout is temporarily unavailable. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!checkoutReady) {
    return (
      <main className="app app-wallpaper business-shell pricing-maintenance-shell">
        <ThemeBackdrop active theme={theme} variant="home" />
        <div className="dot-grid" aria-hidden="true" />
        <SiteTopbar theme={theme} onThemeToggle={onThemeToggle} locale={locale} onLocaleChange={onLocaleChange} />
        <section className="pricing-maintenance-view" aria-labelledby="checkout-unavailable-title">
          <div className="pricing-maintenance-panel">
            <span className="pricing-maintenance-kicker">Checkout</span>
            <h1 id="checkout-unavailable-title">Checkout is temporarily unavailable.</h1>
            <p>{message || 'Paid workspaces are temporarily unavailable.'}</p>
            <a href="/">Back to transcribe</a>
          </div>
        </section>
      </main>
    )
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

        <div className="checkout-flow" aria-label="Checkout progress">
          <span className="is-complete"><Check size={13} /> Plan selected</span>
          <i aria-hidden="true" />
          <span className="is-current">Account details</span>
          <i aria-hidden="true" />
          <span>Secure payment</span>
        </div>

        <section className={`checkout-panel checkout-plan-${safePlanKey}`}>
          <div className={`checkout-summary ${safePlanKey === 'business' ? 'featured' : ''} ${safePlanKey === 'api' ? 'developer' : ''} ${isCustom ? 'custom' : ''}`}>
            <div className="cs-body">
              <div className="order-summary-head">
                <span><ReceiptText size={14} /> Order summary</span>
                <small>Selected plan</small>
              </div>
              <div className="cs-tier">
                <span className="cs-tier-icon"><Icon size={16} /></span>
                <span>{meta.name}<small>{isCustom ? 'Custom agreement' : billingCycleLabel}</small></span>
              </div>
              <div className="cs-name">{meta.summary}</div>
              {!isCustom && (
                <div className="summary-allowance">
                  <span><small>Caption allowance</small><strong>{plan.captionHoursPerMonth != null ? new Intl.NumberFormat(locale).format(plan.captionHoursPerMonth) : ''}{' h'}</strong></span>
                  <span><small>AI fallback</small><strong>{plan.aiFallbackHoursPerMonth != null ? new Intl.NumberFormat(locale).format(plan.aiFallbackHoursPerMonth) : ''}{' h'}</strong></span>
                </div>
              )}
              <ul className="cs-features">
                {visibleFeatures.map((feature) => (
                  <li key={feature}><Check size={14} /><span>{feature}</span></li>
                ))}
              </ul>
              <div className="cs-divider" />
                <div className="cs-pricing">
                <div className="cs-line">
                  <span>{isCustom ? meta.name : billingCycle === 'annual' ? 'Annual subscription' : 'Monthly subscription'}</span>
                  <span className="v">
                    {isCustom || dueToday === null
                      ? 'Custom'
                      : billingCycle === 'annual'
                        ? `$${formatPrice(dueToday)} / yr`
                        : `$${formatPrice(dueToday)} / mo`}
                  </span>
                </div>
                {!isCustom && billingCycle === 'annual' && monthlyEquivalent !== null && (
                  <div className="cs-line">
                    <span>Monthly equivalent</span>
                    <span className="v">{`$${formatPrice(monthlyEquivalent)} / mo`}</span>
                  </div>
                )}
                <div className="cs-line total">
                  <span>{isCustom ? 'Quote' : 'Due today'}</span>
                  <span className="v">{isCustom || dueToday === null ? 'Talk to us' : `$${formatPrice(dueToday)}`}</span>
                </div>
              </div>
            </div>
          </div>

          <form className="checkout-form" onSubmit={submit}>
            <div className="cf-head">
              <span className="checkout-kicker">{isCustom ? 'Sales inquiry' : 'Workspace setup'}</span>
              <h1>{isCustom ? 'Tell us what you need' : 'Create your workspace'}</h1>
              <p>{isCustom ? 'Add your details and describe the volume you plan to process.' : 'Enter two details, then continue to Polar’s secure hosted checkout.'}</p>
            </div>

            <div className="cf-section">
              <div className="cf-section-head"><span className="num">01</span> Account details</div>
              <div className="cf-grid">
                <div className="cf-field">
                  <label>Full name</label>
                  <div className="cf-input with-icon">
                    <span className="ico-l"><User size={14} /></span>
                    <input value={name} onChange={(event) => setName(event.target.value)} type="text" placeholder="Your name" autoComplete="name" required />
                  </div>
                </div>
                <div className="cf-field">
                  <label>Email <span className="req">*</span></label>
                  <div className="cf-input with-icon">
                    <span className="ico-l"><Mail size={14} /></span>
                    <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@company.com" autoComplete="email" required />
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
                <BadgeCheck size={18} />
                <span>
                  <strong>{`Secure ${checkoutProviderName} checkout`}</strong>
                  {`Payment details stay on ${checkoutProviderName}; WODS never handles your card number.`}
                </span>
              </div>
            )}

            <button className={isCustom ? 'cf-submit gold' : 'cf-submit'} type="submit" disabled={submitting || !checkoutReady}>
              {submitting ? 'Submitting...' : checkoutButtonLabel}
              <ArrowRight size={15} />
            </button>
            {!isCustom && !checkoutReady && (
              <p className="checkout-message">Secure checkout is temporarily unavailable.</p>
            )}
            {message && <p className="checkout-message">{message}</p>}
            <div className="cf-foot">
              <span className="secure">
                {isCustom ? <Mail size={13} /> : <Lock size={13} />}
                {isCustom ? 'Sales follow-up by email.' : `Hosted payment via ${checkoutProviderName}.`}
              </span>
              {!isCustom && <span><ShieldCheck size={13} /> 14-day refund guarantee</span>}
            </div>
          </form>
        </section>
      </section>
    </main>
  )
}
