import { ArrowRight } from 'lucide-react'
import type { SiteLocale } from '../hooks/useLocale'
import { productDocs } from '../i18n/productDocs'
import { EmailWaitlist } from './EmailWaitlist'

const copy = {
  en: { title: 'Paid plans coming later.', dashboard: 'Dashboard is temporarily unavailable.', workspace: 'Paid workspaces are temporarily unavailable.', back: 'Back to transcribe' },
  tr: { title: 'Ücretli planlar henüz kullanıma açık değil.', dashboard: 'Panel geçici olarak kullanılamıyor.', workspace: 'Ücretli çalışma alanları geçici olarak kullanılamıyor.', back: 'Transkripsiyona dön' },
  es: { title: 'Los planes de pago llegarán más adelante.', dashboard: 'El panel no está disponible temporalmente.', workspace: 'Los espacios de pago no están disponibles temporalmente.', back: 'Volver a transcribir' },
  zh: { title: '付费方案将稍后推出。', dashboard: '控制台暂时不可用。', workspace: '付费工作区暂时不可用。', back: '返回转录' },
} as const

export function PricingMaintenance({ workspaceUnavailable = false, locale = 'en' }: { workspaceUnavailable?: boolean; locale?: SiteLocale }) {
  const text = copy[locale]
  const plan = productDocs[locale]
  return <section className={`pricing-maintenance-view page-container ${workspaceUnavailable ? 'workspace-unavailable-view' : 'pricing-minimal'}`} aria-labelledby="pricing-maintenance-title" data-no-translate>
    <div className="pricing-maintenance-copy">
      <h1 id="pricing-maintenance-title">{workspaceUnavailable ? text.dashboard : text.title}</h1>
      {workspaceUnavailable ? <>
        <p>{text.workspace}</p>
        <a className="pricing-back-link" href="/">{text.back}<ArrowRight size={16} aria-hidden="true" /></a>
      </> : <>
        <EmailWaitlist locale={locale} />
        <ul className="pricing-planned-features" role="list" aria-label={plan.paidTitle}>
          {plan.paidFeatures.map(feature => <li key={feature}>{feature}</li>)}
        </ul>
      </>}
    </div>
  </section>
}
