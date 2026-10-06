import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { SiteLocale } from '../hooks/useLocale'
import { productDocs } from '../i18n/productDocs'
import { PrivacyPolicy, privacyEffectiveDate } from '../components/PrivacyPolicy'
import './DocsPage.css'

const legacySections: Record<string, string> = {
  quickstart: 'purpose', overview: 'purpose', 'free-transcription': 'purpose',
  architecture: 'purpose', 'create-transcript': 'purpose',
  'data-retention': 'privacy',
  'bulk-processing': 'paid-plan', 'parallel-jobs': 'paid-plan',
  reference: 'paid-plan', authentication: 'paid-plan', 'other-runtimes': 'paid-plan',
  'rate-limits': 'current-limits', 'response-format': 'current-limits',
  languages: 'current-limits', 'ai-fallback': 'current-limits', errors: 'current-limits', faq: 'current-limits',
}

function DocumentationFacts({ rows }: { rows: ReadonlyArray<readonly [string, string]> }) {
  return <dl className="docs-facts" data-no-translate>{rows.map(([label, body]) => <div key={label}>
    <dt>{label}</dt><dd>{body}</dd>
  </div>)}</dl>
}

export function DocsPage({ locale = 'en' }: { locale?: SiteLocale }) {
  const text = productDocs[locale]
  const privacyPolicyRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    let frame = 0
    const scrollToSection = () => {
      cancelAnimationFrame(frame)
      const topic = window.location.hash.slice(1)
      if (!topic) return
      frame = requestAnimationFrame(() => {
        if (topic === 'privacy-policy' && privacyPolicyRef.current) privacyPolicyRef.current.open = true
        document.getElementById(legacySections[topic] ?? topic)?.scrollIntoView({ block: 'start' })
      })
    }
    scrollToSection()
    window.addEventListener('hashchange', scrollToSection)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', scrollToSection) }
  }, [])

  return <section className="docs-page" aria-labelledby="documentation-title">
    <div className="docs-frame">
      <article className="docs-content">
        <header className="docs-hero" data-no-translate><h1 id="documentation-title">{text.title}</h1></header>

        <section className="docs-section" id="purpose" aria-labelledby="purpose-title" data-no-translate>
          <h2 id="purpose-title">{text.purposeTitle}</h2>
          <p>{text.purpose}</p>
        </section>

        <section className="docs-section" id="privacy" aria-labelledby="privacy-title">
          <h2 id="privacy-title" data-no-translate>{text.privacyTitle}</h2>
          <DocumentationFacts rows={text.privacy} />
          <dl className="docs-facts docs-deletion" data-no-translate><div>
            <dt>{text.deletionTitle}</dt>
            <dd>{text.deletion} <a href="mailto:easytran@proton.me">easytran@proton.me</a>.</dd>
          </div></dl>
          <details className="docs-privacy-policy" id="privacy-policy" ref={privacyPolicyRef}>
            <summary className="docs-text-link" data-no-translate>{text.privacyLink}<ChevronDown size={16} aria-hidden="true" /></summary>
            <div className="docs-policy-content">
              <p className="docs-policy-date">EasyTran · Effective {privacyEffectiveDate}</p>
              <PrivacyPolicy embedded />
            </div>
          </details>
        </section>

        <section className="docs-section" id="current-limits" aria-labelledby="limits-title" data-no-translate>
          <h2 id="limits-title">{text.limitsTitle}</h2>
          <DocumentationFacts rows={text.limits} />
        </section>

        <section className="docs-section" id="paid-plan" aria-labelledby="paid-plan-title" data-no-translate>
          <h2 id="paid-plan-title">{text.paidTitle}</h2>
          <p>{text.paidIntro}</p>
          <ul className="docs-planned-features" role="list">{text.paidFeatures.map(feature => <li key={feature}>{feature}</li>)}</ul>
        </section>

        <section className="docs-section docs-project" id="project" aria-labelledby="project-title" data-no-translate>
          <h2 id="project-title">{text.projectTitle}</h2>
          <nav className="docs-project-links" aria-label={text.projectLinks}>
            <a href="https://github.com/ydnmu/easytran" target="_blank" rel="noreferrer">GitHub<ArrowUpRight size={16} aria-hidden="true" /></a>
            <a href="https://x.com/avenkoze" target="_blank" rel="noreferrer">X<ArrowUpRight size={16} aria-hidden="true" /></a>
          </nav>
        </section>
      </article>
    </div>
  </section>
}
