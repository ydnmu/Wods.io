import {
  ArrowRight,
  BadgeCheck,
  Braces,
  Building2,
  PlayCircle,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { PLANS } from '../lib/plans'
import type { PlanKey } from '../lib/plans'
import type { CSSProperties } from 'react'
import '../styles/business.css'
import '../styles/pricing-cards.css'

const planOrder: PlanKey[] = ['free', 'api', 'business', 'custom']

const planMeta: Record<PlanKey, {
  label: string
  className: string
  eyebrow: string
  audience: string
  icon: typeof Braces
}> = {
  free: {
    label: 'Free',
    className: 'card-free',
    eyebrow: 'Web workspace',
    audience: 'For quick, one-off transcripts without an account.',
    icon: PlayCircle,
  },
  api: {
    label: 'Developer',
    className: 'card-developer',
    eyebrow: 'API workspace',
    audience: 'For developers shipping transcript-powered products.',
    icon: Braces,
  },
  business: {
    label: 'Business',
    className: 'card-business',
    eyebrow: 'Operations workspace',
    audience: 'For teams running high-volume content workflows.',
    icon: Building2,
  },
  custom: {
    label: 'Enterprise',
    className: 'card-custom',
    eyebrow: 'Custom deployment',
    audience: 'For organizations with security, SLA, or volume requirements.',
    icon: ShieldCheck,
  },
}

const planCtas: Record<PlanKey, string> = {
  free: 'Start transcribing',
  api: 'Start building',
  business: 'Choose Business',
  custom: 'Talk to sales',
}

const pricingFeatures: Record<PlanKey, readonly string[]> = {
  free: [
    'Unlimited web transcripts',
    'Search and timestamped exports',
    'No account required',
    'AI fallback when available',
  ],
  api: [
    'Everything in Free',
    '1,000 caption hours / month',
    '50 AI fallback hours / month',
    'REST API, API keys, and usage dashboard',
    'Up to 3 webhooks',
  ],
  business: [
    'Everything in Developer',
    '10,000 caption hours / month',
    '500 AI fallback hours / month',
    'Searchable transcript archive',
    'Batch processing up to 1,000 URLs',
    '10 channel syncs and 20 webhooks',
  ],
  custom: [
    'Everything in Business',
    'Custom volume and concurrency',
    'Negotiated SLA and retention',
    'SSO and security review',
    'Dedicated onboarding and support',
  ],
}

const planSignals: Record<PlanKey, readonly [string, string][]> = {
  free: [['Access', 'Instant'], ['Account', 'Not required']],
  api: [['Captions', '1,000h / mo'], ['Webhooks', 'Up to 3']],
  business: [['Captions', '10,000h / mo'], ['Automation', 'Batch + sync']],
  custom: [['Capacity', 'Custom'], ['Assurance', 'SLA + SSO']],
}

const faqs = [
  [
    'What will I pay at checkout?',
    'The selected plan and billing cycle determine the subscription price shown before payment. Yearly billing includes the advertised 40% discount. Applicable taxes may be added by Polar. WODS does not add automatic overage charges.',
  ],
  [
    'What counts toward my quota?',
    'Completed source duration is charged to either the caption allowance or the AI fallback allowance. Each video is rounded up to a minimum of one billable minute, so short clips are supported without creating a request-count loophole.',
  ],
  [
    'What happens when I reach the limit?',
    'Only the exhausted route pauses: caption jobs use the caption allowance and captionless videos use the AI fallback allowance. We do not silently charge overages. Contact us before checkout if you need additional hours.',
  ],
  [
    'Can I cancel or change my plan?',
    'Yes. You can stop future renewals from the billing portal and keep access until the current paid period ends. Upgrades and custom limits can be arranged as your usage grows.',
  ],
  [
    'How does the 14-day refund guarantee work?',
    'Contact support within 14 days of your first eligible purchase. Refund requests are handled under the refund policy; abusive use, repeated purchases, and substantial quota consumption may not qualify.',
  ],
  [
    'When will I receive access?',
    'Access begins after payment is confirmed and the workspace is activated. You receive an email with the dashboard link, setup guide, and the next action to take.',
  ],
  [
    'Which plan stores my transcripts?',
    'Developer focuses on API delivery. Business includes a searchable transcript archive, while Enterprise retention and storage rules are confirmed in the written order.',
  ],
]

const onboardingSteps = [
  ['01', 'Check your inbox', 'After payment is confirmed, we send your workspace link and setup guide to the email used at checkout.'],
  ['02', 'Create your API key', 'Sign in to the dashboard, create a private key, and keep it in your server environment.'],
  ['03', 'Send your first request', 'Submit a supported video URL. Business workspaces can then configure saved transcripts and scheduled sources.'],
]

function revealDelay(index: number, step = 70): CSSProperties {
  return { '--reveal-delay': `${index * step}ms` } as CSSProperties
}

function useBusinessReveal() {
  useEffect(() => {
    const root = document.querySelector('.business')
    if (!root) return

    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!items.length) return

    if (!('IntersectionObserver' in window)) {
      items.forEach((item) => item.classList.add('is-visible'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        })
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.14 },
    )

    items.forEach((item) => observer.observe(item))
    return () => observer.disconnect()
  }, [])
}

function PriceCard({
  planKey,
  index,
  billingCycle,
}: {
  planKey: PlanKey
  index: number
  billingCycle: 'monthly' | 'annual'
}) {
  const plan = PLANS[planKey]
  const meta = planMeta[planKey]
  const PlanIcon = meta.icon
  const price = plan.price
  const checkoutSlug = planKey === 'api' ? 'developer' : planKey
  const href = planKey === 'free'
    ? '/'
    : planKey === 'custom'
      ? `/checkout/${checkoutSlug}`
      : `/checkout/${checkoutSlug}?billing=${billingCycle}`
  const annualTotal = price === null ? null : price * 12 * 0.6
  const displayPrice = price === null || price === 0 || billingCycle === 'monthly' ? price : price * 0.6
  const formatPrice = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2)

  return (
    <article
      className={`card ${meta.className} ${plan.featured ? 'featured' : ''}`}
      data-reveal="card"
      style={revealDelay(index)}
    >
      <div className="card-body">
        <div className="plan-identity">
          <span className="plan-icon" aria-hidden="true"><PlanIcon size={16} /></span>
          <span className="plan-eyebrow">{meta.eyebrow}</span>
        </div>
        <div className="tier-name">{meta.label}</div>
        <p className="tier-desc">{meta.audience}</p>
        <div className="plan-rule" />
        <div className="price-row">
          {displayPrice === null ? (
            <span className="custom">Custom</span>
          ) : (
            <>
              <span className="amount">${formatPrice(displayPrice)}</span>
              <span className="period">
                {price === 0
                  ? 'forever'
                  : billingCycle === 'annual' && annualTotal !== null
                    ? `/ month · $${formatPrice(annualTotal)} billed yearly`
                    : plan.period}
              </span>
            </>
          )}
        </div>
        <div className="plan-signals">
          {planSignals[planKey].map(([label, value]) => (
            <span key={label}><small>{label}</small><strong>{value}</strong></span>
          ))}
        </div>
        <div className="feat-divider" />
        <span className="features-title">What you get</span>
        <ul className="features">
          {pricingFeatures[planKey].map((feature) => (
            <li key={feature}><i className="feature-dash" aria-hidden="true" /><span>{feature}</span></li>
          ))}
        </ul>
        <a className="tier-cta" href={href}>
          {planCtas[planKey]}
          <ArrowRight size={15} />
        </a>
      </div>
    </article>
  )
}

export function BusinessPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')
  useBusinessReveal()

  return (
    <section className="business" id="business">
      <section className="biz-hero" data-reveal="hero">
        <div className="biz-hero-copy">
          <h1 className="biz-h1">Pricing.</h1>
          <p className="biz-sub">
            Start with the web app. Add API access, automation, and team workflows as your volume grows.
          </p>
        </div>
        <div className="billing-row">
          <div className="billing-status" role="group" aria-label="Billing cycle">
            <button
              type="button"
              className={billingCycle === 'monthly' ? 'active' : ''}
              onClick={() => setBillingCycle('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              className={billingCycle === 'annual' ? 'active' : ''}
              onClick={() => setBillingCycle('annual')}
            >
              Yearly <small>-%40</small>
            </button>
          </div>
          <span className="biz-refund"><BadgeCheck size={20} /> 14-day refund guarantee</span>
        </div>
      </section>

      <section className="pricing-grid" aria-label="Pricing plans">
        {planOrder.map((key, index) => (
          <PriceCard key={key} planKey={key} index={index} billingCycle={billingCycle} />
        ))}
      </section>

      <section className="after-checkout" aria-labelledby="after-checkout-title">
        <div className="after-checkout-head">
          <h2 id="after-checkout-title">After checkout</h2>
          <p>You receive one clear setup email with the dashboard link, written guide, and the exact next step.</p>
        </div>
        <div className="after-checkout-steps">
          {onboardingSteps.map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span>
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="faq-section" data-reveal="section">
        <div className="head" data-reveal="soft">
          <h2>Questions before checkout</h2>
          <p>Direct answers about charges, quotas, cancellation, refunds, access, and transcript storage.</p>
        </div>
        <div className="faq-list">
          {faqs.map(([question, answer], index) => (
            <article
              className={openFaq === index ? 'pricing-question is-open' : 'pricing-question'}
              style={revealDelay(index, 55)}
              key={question}
            >
              <button
                className="faq-trigger"
                type="button"
                aria-expanded={openFaq === index}
                onClick={() => setOpenFaq((current) => current === index ? null : index)}
              >
                {question}
                <i aria-hidden="true" />
              </button>
              <div className="pricing-question-answer">
                <div>{answer}</div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="business-back" data-reveal="section">
        <a href="/">Back to free web transcribe <ArrowRight size={15} /></a>
      </div>
    </section>
  )
}
