import { ArrowRight, Check, Mail, X } from 'lucide-react'
import '../styles/checkout.css'

export function CheckoutCompletePage() {
  const params = new URLSearchParams(window.location.search)
  const cancelled = params.get('status') === 'cancelled'
  const plan = params.get('plan') === 'business' ? 'Business' : 'Developer'

  return (
    <main className="app checkout-complete-shell">
      <div className="dot-grid" aria-hidden="true" />
      <a className="logo checkout-complete-brand" href="/" aria-label="WODS home">
        <img className="logo-icon" src="/easytran-logo.svg" alt="" aria-hidden="true" />
        <span className="logo-text">WODS</span>
      </a>
      <section className="checkout-complete-card">
        <div className={`checkout-complete-icon ${cancelled ? 'cancelled' : ''}`}>
          {cancelled ? <X size={24} /> : <Check size={24} />}
        </div>
        <span className="checkout-kicker">{plan} plan</span>
        <h1>{cancelled ? 'Checkout cancelled' : 'Payment received'}</h1>
        <p>{cancelled
          ? 'Nothing was charged. You can return to pricing whenever you are ready.'
          : 'Your billing provider is confirming the subscription now. A one-time dashboard access key will arrive by email as soon as the workspace is active.'}</p>
        {!cancelled && (
          <div className="checkout-next-steps">
            <span><Mail size={17} /><b>1</b> Check the email used at checkout</span>
            <span><Check size={17} /><b>2</b> Enter with the one-time access key</span>
            <span><ArrowRight size={17} /><b>3</b> Choose your username and password</span>
          </div>
        )}
        <div className="checkout-complete-actions">
          <a className="checkout-complete-primary" href={cancelled ? '/business' : '/dashboard'}>
            {cancelled ? 'Return to pricing' : 'Open dashboard'} <ArrowRight size={16} />
          </a>
          {!cancelled && <a href="/docs">Read API docs</a>}
        </div>
      </section>
    </main>
  )
}
