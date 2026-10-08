export const privacyEffectiveDate = 'July 6, 2026'

export function PrivacyPolicy({ embedded = false }: { embedded?: boolean }) {
  const Heading = embedded ? 'h3' : 'h2'
  return (
    <>
      {!embedded && <h1>Privacy Policy</h1>}
      <p className="legal-lead">This policy explains how WODS handles information when you use the website, API, dashboard, and paid subscriptions.</p>

      <Heading>Information we process</Heading>
      <p>We process account and contact information such as your email address, name, company name, authentication records, subscription status, API keys in hashed form, usage counts, support messages, and technical logs needed to secure and operate the service.</p>
      <p>When you submit a supported video URL, WODS processes the URL and resulting transcript. Audio used for speech-to-text fallback is handled temporarily for the request and is not retained by WODS. Transcript retention depends on your plan: public web results remain in your browser, Developer API transcript text is not retained by WODS, and Business or Custom workspace transcripts may be stored in the searchable archive.</p>

      <Heading>Why we use information</Heading>
      <p>We use information to provide transcripts and API access, authenticate users, enforce quotas, process subscriptions, deliver service emails, prevent abuse, troubleshoot failures, improve reliability, and comply with legal obligations.</p>

      <Heading>Service providers</Heading>
      <p>WODS may use infrastructure and specialist providers including Supabase for application data, Resend for email, Polar as the Merchant of Record for checkout and subscription administration, and transcription or AI providers such as AssemblyAI, Fireworks AI, and OpenAI when the relevant feature requires them. These providers receive only the information needed to perform their service.</p>

      <Heading>Payments</Heading>
      <p>Payment details are collected and processed by the active Merchant of Record provider and its payment partners. WODS does not receive or store full card numbers. We retain provider customer, subscription, product, and checkout identifiers for account reconciliation and access control.</p>

      <Heading>Cookies and security</Heading>
      <p>WODS uses an essential session cookie for dashboard authentication. We apply access controls, encrypted transport, hashed credentials, rate limits, and signed webhook verification, but no internet service can guarantee absolute security.</p>

      <Heading>Retention and your choices</Heading>
      <p>We keep account, billing, security, and Business archive data only as long as needed for the service, legal compliance, dispute handling, and fraud prevention. You may request access, correction, export, or deletion of eligible personal data by contacting <a href="mailto:easytran@proton.me">easytran@proton.me</a>. Some billing and security records must be retained where required by law.</p>

      <Heading>International processing and changes</Heading>
      <p>Providers may process information in countries other than yours with appropriate contractual or legal safeguards. We may update this policy as the service changes and will publish the revised effective date here.</p>
    </>
  )
}

