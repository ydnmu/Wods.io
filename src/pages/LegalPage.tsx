import { Footer } from '../components/Footer'
import { SiteTopbar } from '../components/SiteTopbar'
import { PrivacyPolicy, privacyEffectiveDate } from '../components/PrivacyPolicy'
import type { SiteLocale } from '../hooks/useLocale'
import type { Theme } from '../hooks/useTheme'
import '../styles/legal.css'

type LegalPageKind = 'privacy' | 'terms' | 'refunds'

const effectiveDate = privacyEffectiveDate


function TermsOfService() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="legal-lead">These terms govern use of WODS. By using the service or purchasing a subscription, you agree to them.</p>

      <h2>The service</h2>
      <p>WODS is a self-serve software service that converts customer-provided video URLs into transcripts and offers related API, dashboard, webhook, batch, channel-sync, translation, and summary features. Feature availability and retention depend on the selected plan.</p>

      <h2>Your content and acceptable use</h2>
      <p>You retain your rights in content you submit. You must have permission or another lawful basis to process each video and transcript. You may not use WODS to infringe intellectual-property or privacy rights, evade access controls, distribute malware, facilitate unlawful activity, overload the service, resell access deceptively, or expose API keys and webhook secrets.</p>

      <h2>Subscriptions and quotas</h2>
      <p>Paid plans renew monthly until cancelled. Prices, included caption and AI fallback hours, and plan features are displayed before checkout. Completed source duration is deducted from the applicable workspace allowance; failed jobs do not consume completed processing time. Taxes, invoices, payment methods, renewals, and cancellations are administered through the active Merchant of Record provider. Cancellation stops future renewals and does not erase obligations already incurred.</p>

      <h2>Third-party services</h2>
      <p>WODS depends on video platforms, infrastructure providers, AI services, and payment providers. Their availability and terms may affect the service. WODS is not affiliated with the supported video platforms and does not grant rights to their content.</p>

      <h2>Availability and changes</h2>
      <p>We aim to keep WODS reliable but do not promise uninterrupted or error-free operation. We may change features, limits, or prices prospectively, suspend abusive or risky activity, or discontinue features when necessary. Material subscription changes will be communicated where required.</p>

      <h2>Disclaimer and liability</h2>
      <p>Transcripts, translations, and AI-generated summaries may contain errors and should be reviewed before important use. To the maximum extent permitted by law, WODS is provided “as is” without implied warranties, and liability is limited to the amount you paid for the service during the three months before the event giving rise to the claim. These limits do not exclude rights or liabilities that cannot legally be excluded.</p>

      <h2>Contact</h2>
      <p>Questions, legal notices, and support requests may be sent to <a href="mailto:easytran@proton.me">easytran@proton.me</a>.</p>
    </>
  )
}

function RefundPolicy() {
  return (
    <>
      <h1>Refund & Cancellation Policy</h1>
      <p className="legal-lead">WODS subscriptions are digital services provisioned automatically after successful payment.</p>

      <h2>Cancellation</h2>
      <p>You may cancel an active subscription through the active provider's customer portal or by contacting <a href="mailto:easytran@proton.me">easytran@proton.me</a>. Cancellation prevents future renewal charges. Access continues until the end of the paid billing period unless the portal states otherwise.</p>

      <h2>Refund requests</h2>
      <p>Your first paid subscription purchase includes a 14-day refund guarantee. Contact support within 14 days using the purchase email and we will refund the initial subscription payment to the original payment method. The guarantee does not cover renewal payments, fraudulent activity, deliberate abuse, or repeated purchases made to obtain recurring free usage.</p>
      <p>Renewal payments and partially used billing periods are generally non-refundable, except for duplicate billing, a verified service failure, or where consumer law requires a refund. Nothing in this policy limits mandatory consumer rights.</p>

      <h2>How refunds are processed</h2>
      <p>The active Merchant of Record provider processes approved refunds to the original payment method. Bank and card-network processing times vary. Refund requests must be made within 30 days of the transaction because the provider may not permit merchant-initiated refunds after that window.</p>

      <h2>Charge concerns</h2>
      <p>If you do not recognize a charge, contact us before opening a bank dispute so we can investigate promptly. This does not restrict your legal right to dispute a payment.</p>
    </>
  )
}

export function LegalPage({
  kind,
  theme,
  onThemeToggle,
  locale,
  onLocaleChange,
}: {
  kind: LegalPageKind
  theme: Theme
  onThemeToggle: () => void
  locale: SiteLocale
  onLocaleChange: (locale: SiteLocale) => void
}) {
  return (
    <main className="app legal-shell">
      <SiteTopbar
        theme={theme}
        onThemeToggle={onThemeToggle}
        locale={locale}
        onLocaleChange={onLocaleChange}
      />
      <article className="legal-page">
        <p className="legal-kicker">WODS · Effective {effectiveDate}</p>
        {kind === 'privacy' && <PrivacyPolicy />}
        {kind === 'terms' && <TermsOfService />}
        {kind === 'refunds' && <RefundPolicy />}
      </article>
      <Footer variant="full" />
    </main>
  )
}
