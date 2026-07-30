import './DocsPage.css'
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  Globe2,
  Languages,
  List,
  MessageSquareText,
  Send,
  Sparkles,
  Star,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { LANGUAGES } from '../lib/languages'

const githubRepositoryUrl = 'https://github.com/avenkoze/easytran'

const languageFlagRegion = (code: string) => {
  const regionOverrides: Record<string, string> = {
    af: 'ZA', am: 'ET', ar: 'SA', as: 'IN', ay: 'BO', bm: 'ML', bn: 'BD',
    bho: 'IN', ca: 'ES', ceb: 'PH', co: 'FR', cs: 'CZ', da: 'DK', doi: 'IN',
    dv: 'MV', ee: 'GH', el: 'GR', en: 'GB', eo: 'UN', eu: 'ES', fy: 'NL',
    gl: 'ES', gn: 'PY', gu: 'IN', ha: 'NG', haw: 'US', hi: 'IN', hmn: 'CN',
    ig: 'NG', ilo: 'PH', iw: 'IL', jw: 'ID', kn: 'IN', km: 'KH', ko: 'KR',
    kri: 'SL', lus: 'IN', mai: 'IN', 'mni-Mtei': 'IN', nso: 'ZA',
    ny: 'MW', rw: 'RW', sq: 'AL', tl: 'PH',
    'zh-CN': 'CN', 'zh-TW': 'TW',
  }
  const region = regionOverrides[code] || code.slice(0, 2).toUpperCase()
  return /^[A-Z]{2}$/.test(region) ? region.toLowerCase() : 'un'
}

const examples = {
  curl: `curl -X POST https://easytran.app/v1/transcripts \\
  -H "Authorization: Bearer et_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ"}'`,
  javascript: `const response = await fetch("https://easytran.app/v1/transcripts", {
  method: "POST",
  headers: {
    "Authorization": "Bearer et_your_key",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ url: videoUrl })
});

const transcript = await response.json();`,
  python: `import requests

transcript = requests.post(
    "https://easytran.app/v1/transcripts",
    headers={"Authorization": "Bearer et_your_key"},
    json={"url": video_url}
).json()`,
  go: `reqBody := strings.NewReader(\`{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ"}\`)
req, _ := http.NewRequest("POST", "https://easytran.app/v1/transcripts", reqBody)
req.Header.Set("Authorization", "Bearer et_your_key")
req.Header.Set("Content-Type", "application/json")

response, err := http.DefaultClient.Do(req)`,
  php: `$response = $client->post('https://easytran.app/v1/transcripts', [
  'headers' => [
    'Authorization' => 'Bearer et_your_key',
    'Content-Type' => 'application/json',
  ],
  'json' => ['url' => $videoUrl],
]);`,
}

const responseExample = `{
  "title": "Example video",
  "segments": [
    { "start": 0, "duration": 3.2, "text": "Example caption" }
  ],
  "plainText": "Example caption"
}`

const errors = [
  ['400', 'invalid_url', 'Check the video URL.'],
  ['401', 'invalid_api_key', 'Create or replace your API key.'],
  ['403', 'plan_required', 'This feature is not in your plan.'],
  ['422', 'no_captions', 'No usable transcript source was found.'],
  ['429', 'rate_limited', 'Wait briefly and retry.'],
  ['429', 'caption_hours_exceeded', 'The workspace caption-hour allowance is exhausted.'],
  ['429', 'ai_fallback_hours_exceeded', 'The workspace AI fallback-hour allowance is exhausted.'],
] as const

const faqs = [
  {
    question: 'How is usage calculated?',
    answer: 'Paid workspace usage is measured from completed source duration. Caption and AI fallback hours are tracked separately, and failed jobs do not consume completed processing time.',
  },
  {
    question: 'Which video platforms are supported?',
    answer: 'YouTube, Vimeo, TED Talks, and Dailymotion are currently supported.',
  },
  {
    question: 'What happens when captions are unavailable?',
    answer: 'If a transcript cannot be produced, the API returns a clear 422 response instead of an empty result.',
  },
  {
    question: 'How is my content handled?',
    answer: 'Content handling follows the privacy terms and the features included with your workspace plan.',
  },
  {
    question: 'Can I process videos in bulk?',
    answer: 'High-volume processing is available with eligible plans. Review Pricing to choose the right usage level.',
  },
  {
    question: 'Which export formats are available?',
    answer: 'Every transcript can be returned as JSON, TXT, SRT, or VTT.',
  },
] as const

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="docs-code">
      {label && <span className="docs-code-label">{label}</span>}
      <button type="button" onClick={copy} aria-label="Copy code">
        {copied ? <Check size={14} /> : <Clipboard size={14} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre><code>{code}</code></pre>
    </div>
  )
}

function FaqItem({ question, answer }: (typeof faqs)[number]) {
  const [open, setOpen] = useState(false)

  return (
    <div className={open ? 'docs-question is-open' : 'docs-question'}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>{question}</span>
        <i aria-hidden="true" />
      </button>
      <div className="docs-question-answer">
        <p>{answer}</p>
      </div>
    </div>
  )
}

export function DocsPage() {
  const [tab, setTab] = useState<keyof typeof examples>('curl')
  const [starCount, setStarCount] = useState<number | null>(null)
  const [errorsOpen, setErrorsOpen] = useState(false)
  const [languageListOpen, setLanguageListOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackUsername, setFeedbackUsername] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackState, setFeedbackState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [feedbackError, setFeedbackError] = useState('')
  const feedbackButtonRef = useRef<HTMLButtonElement>(null)
  const feedbackUsernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const controller = new AbortController()

    fetch('https://api.github.com/repos/avenkoze/easytran', {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() as Promise<{ stargazers_count?: number }> : null)
      .then((repository) => {
        if (typeof repository?.stargazers_count === 'number') {
          setStarCount(repository.stargazers_count)
        }
      })
      .catch(() => undefined)

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const scrollToHash = () => {
      const id = window.location.hash.slice(1)
      if (!id) return
      document.getElementById(id)?.scrollIntoView({ block: 'start' })
    }

    window.setTimeout(scrollToHash, 0)
    window.addEventListener('hashchange', scrollToHash)
    return () => window.removeEventListener('hashchange', scrollToHash)
  }, [])

  useEffect(() => {
    if (!feedbackOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    feedbackUsernameRef.current?.focus()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setFeedbackOpen(false)
      window.setTimeout(() => feedbackButtonRef.current?.focus(), 0)
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [feedbackOpen])

  useEffect(() => {
    if (!languageListOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLanguageListOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [languageListOpen])

  const closeFeedback = () => {
    setFeedbackOpen(false)
    window.setTimeout(() => feedbackButtonRef.current?.focus(), 0)
  }

  const submitFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFeedbackState('sending')
    setFeedbackError('')

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: feedbackUsername.trim(),
          message: feedbackMessage.trim(),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Feedback could not be sent.')

      setFeedbackState('sent')
      setFeedbackUsername('')
      setFeedbackMessage('')
    } catch (error) {
      setFeedbackState('error')
      setFeedbackError(error instanceof Error ? error.message : 'Feedback could not be sent.')
    }
  }

  return (
    <section className="docs-page">
      <div className="docs-ambient" aria-hidden="true" />

      <article className="docs-content">
        <section className="docs-hero">
          <div className="docs-hero-copy">
            <h1>Why this site exists?</h1>
            <p>I was tired of transcript tools weighed down by unnecessary memory use, tracking, clumsy interfaces, and arbitrary limits—so I built the one I wanted to use.</p>
          </div>
          <aside className="docs-author-links" aria-label="Project and author links">
            <a className="docs-github-link" href={githubRepositoryUrl} target="_blank" rel="noreferrer">
              <span className="docs-author-label">
                <img src="https://github.githubassets.com/favicons/favicon-dark.svg" alt="" aria-hidden="true" />
                <small>GitHub</small>
              </span>
              <strong aria-label={starCount === null ? 'GitHub stars loading' : `${starCount} GitHub stars`}>
                <Star size={13} fill="currentColor" /> {starCount === null ? '—' : starCount.toLocaleString('en-US')}
              </strong>
            </a>
            <div className="docs-portfolio-link" aria-label="Portfolio ydnmu.com, coming soon">
              <span className="docs-author-label">
                <Globe2 size={17} aria-hidden="true" />
                <small>Portfolio</small>
                <strong>ydnmu.com</strong>
                <em>Coming soon</em>
              </span>
            </div>
            <button
              className="docs-feedback-trigger"
              type="button"
              ref={feedbackButtonRef}
              onClick={() => {
                setFeedbackState('idle')
                setFeedbackError('')
                setFeedbackOpen(true)
              }}
            >
              <span className="docs-author-label"><MessageSquareText size={17} /><small>Feedback</small></span>
            </button>
          </aside>
        </section>

        <nav className="docs-quick-menu" aria-label="Quick menu">
          <span>Quick menu</span>
          <ArrowRight size={15} aria-hidden="true" />
          <div>
            <a href="#privacy">Privacy</a>
            <a href="#quickstart">API</a>
            <a href="#pricing">Pricing</a>
            <a href="#architecture">Architecture</a>
            <a href="#faq">FAQ</a>
          </div>
        </nav>

        <section className="docs-section docs-quickstart" id="quickstart">
          <div className="docs-section-head">
            <h2>API quickstart</h2>
          </div>

          <div className="quickstart-layout">
            <ol className="quickstart-steps">
              <li>
                <span>1</span>
                <div><strong>Get an API key</strong><small>Create one in your dashboard.</small></div>
              </li>
              <li>
                <span>2</span>
                <div><strong>Send a video URL</strong><small>Keep your key on the server.</small></div>
              </li>
              <li>
                <span><CheckCircle2 size={15} /></span>
                <div><strong>Use the transcript</strong><small>Receive timestamped segments.</small></div>
              </li>
            </ol>

            <div className="quickstart-code">
              <div className="docs-tabs" role="tablist" aria-label="Code language">
                {(Object.keys(examples) as Array<keyof typeof examples>).map((key) => (
                  <button
                    className={tab === key ? 'active' : ''}
                    type="button"
                    key={key}
                    onClick={() => setTab(key)}
                    role="tab"
                    aria-selected={tab === key}
                    data-no-translate
                  >{key === 'javascript' ? 'Node.js' : key}</button>
                ))}
              </div>
              <CodeBlock code={examples[tab]} />
            </div>
          </div>
        </section>

        <section className="docs-section" id="reference">
          <div className="docs-section-head">
            <h2>API reference</h2>
          </div>

          <div className="endpoint-bar">
            <span>POST</span>
            <code>/v1/transcripts</code>
          </div>

          <div className="reference-grid">
            <div className="reference-copy">
              <span className="reference-label">Request body</span>
              <h3>Send one video URL</h3>
              <p>The URL is required. Add a format only when you need a specific export.</p>
              <div className="field-list">
                <p><code>url</code><b>string · required</b></p>
                <p><code>format</code><b>json · txt · srt · vtt</b></p>
              </div>
            </div>
            <CodeBlock label="Response example" code={responseExample} />
          </div>

          <div className={errorsOpen ? 'error-block is-open' : 'error-block'} id="errors">
            <button
              className="docs-errors-toggle"
              type="button"
              aria-expanded={errorsOpen}
              aria-controls="docs-error-list"
              onClick={() => setErrorsOpen((value) => !value)}
            >
              <strong>Errors</strong>
              <span>HTTP status, stable error code, and the next action to take.</span>
              <i aria-hidden="true" />
            </button>
            <div className="docs-error-reveal" id="docs-error-list">
              <div className="error-table">
                {errors.map(([status, code, action]) => (
                  <p key={`${status}-${code}`}>
                    <span className={`status status-${status}`}>{status}</span>
                    <code>{code}</code>
                    <span>{action}</span>
                  </p>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="docs-section" id="architecture">
          <div className="docs-section-head">
            <h2>Architecture</h2>
          </div>

          <div className="capability-grid">
            <article>
              <div className="capability-heading">
                <div className="capability-icon pink"><Sparkles size={18} /></div>
                <h3>AI fallback</h3>
              </div>
              <p>Configured AI transcription can handle media when a standard transcript cannot be produced.</p>
              <code>Provider dependent</code>
            </article>
            <article className="language-capability" tabIndex={0}>
              <div className="capability-heading">
                <div className="capability-icon blue"><Languages size={18} /></div>
                <h3>Language support</h3>
              </div>
              <p>Transcripts can be processed across a broad multilingual catalog.</p>
              <div className="capability-meta">
                <code>{LANGUAGES.length} languages</code>
                <button type="button" onClick={() => setLanguageListOpen(true)}>
                  <List size={13} /> List
                </button>
              </div>
            </article>
            <article>
              <div className="capability-heading">
                <div className="capability-icon green"><Zap size={18} /></div>
                <h3>Fast requests</h3>
              </div>
              <p>The public transcript flow is designed to return usable results quickly.</p>
              <code>~3.4s average</code>
            </article>
          </div>
        </section>

        <section className="docs-section docs-pricing-docs" id="pricing">
          <div className="docs-section-head">
            <h2>Pricing &amp; plan scope</h2>
          </div>
          <p className="docs-section-intro">Use the API as a production service, not as a way to bypass source-platform rules or the limits attached to a workspace. These operating rules apply alongside the plan shown at checkout; a signed order controls only where it explicitly says something different.</p>
          <div className="docs-policy-grid">
            <article>
              <h3>Credentials &amp; accounts</h3>
              <p>Keep API keys in server-side secrets, assign access only to people and systems that need it, and rotate a key immediately if it may have been exposed.</p>
              <ul>
                <li><Check size={14} /> Never place a secret key in browser or public client code.</li>
                <li><Check size={14} /> You are responsible for activity performed with your credentials.</li>
                <li><Check size={14} /> Do not share, resell, or transfer workspace access.</li>
              </ul>
            </article>
            <article>
              <h3>Quotas &amp; responsible traffic</h3>
              <p>Monthly quota, burst limits, concurrency controls, and fair-use protections keep the shared service reliable and control unexpected processing cost.</p>
              <ul>
                <li><Check size={14} /> Back off on 429 and transient 5xx responses.</li>
                <li><Check size={14} /> Do not shard accounts or keys to evade a limit.</li>
                <li><Check size={14} /> Use batch and channel tools for planned high volume.</li>
              </ul>
            </article>
            <article>
              <h3>Content &amp; platform rights</h3>
              <p>Submit only media you are authorized to process. Your use must respect copyright, privacy, consent, applicable law, and the rules of the source platform.</p>
              <ul>
                <li><Check size={14} /> Do not use transcripts for unauthorized surveillance or profiling.</li>
                <li><Check size={14} /> Do not circumvent access, playback, or platform restrictions.</li>
                <li><Check size={14} /> Review sensitive output before publishing or acting on it.</li>
              </ul>
            </article>
            <article>
              <h3>Production integration</h3>
              <p>Design for partial failure: validate responses, make webhook handling idempotent, cap retries, and keep a durable record of work your application must not lose.</p>
              <ul>
                <li><Check size={14} /> Retry with exponential backoff and jitter.</li>
                <li><Check size={14} /> Treat generated text and timestamps as reviewable output.</li>
                <li><Check size={14} /> Ask before assuming a custom SLA or retention rule.</li>
              </ul>
            </article>
          </div>
          <div className="docs-plan-rules">
            <p><strong>Developer</strong><span>Standard API limits and shared processing; intended for server-side product integrations.</span></p>
            <p><strong>Business</strong><span>Higher-volume automation may use archive, batch, channel, and webhook workflows within the active workspace limits.</span></p>
            <p><strong>Enterprise</strong><span>Custom volume, support targets, security requirements, retention, or service levels apply only when documented in a signed order.</span></p>
          </div>
        </section>

        <section className="docs-section docs-questions" id="faq">
          <h2>Frequently asked questions</h2>
          <div className="docs-question-list">
            {faqs.map((faq) => (
              <FaqItem key={faq.question} {...faq} />
            ))}
          </div>
        </section>

        <section className="docs-policy" id="privacy">
          <span id="terms" className="docs-anchor" />
          <div>
            <h2>Privacy &amp; Policy</h2>
            <div className="docs-policy-copy">
              <p>EasyTran processes the information needed to provide the feature you request. This may include a submitted video URL, transcript content, account and billing details for paid workspaces, basic technical and security logs, and the username and message you choose to send through Feedback. Do not submit confidential, sensitive, or personal material unless you have the authority and a lawful reason to process it.</p>
              <p>You are responsible for the URLs, media, and text you submit, including copyright, privacy, platform rules, consent, and any downstream use of an exported transcript. EasyTran may rely on hosting, database, payment, email, and transcription service providers to operate the service. Those providers may process limited data necessary to perform their role and may have their own terms and privacy practices.</p>
              <p>Storage depends on the feature and plan in use: some API flows are designed without server-side transcript retention, while archive-enabled workspace features intentionally store transcript results so they remain searchable. Operational records may be retained as reasonably necessary for security, abuse prevention, billing, troubleshooting, and legal compliance. Avoid treating generated transcripts or summaries as guaranteed complete or error-free; review important output before relying on it.</p>
              <p><strong>Service policy.</strong> Do not use EasyTran to violate copyright, privacy, platform restrictions, applicable law, or another person’s rights. Attempts to bypass safeguards, overload the free web experience, scrape at abusive volume, interfere with service operation, or gain unauthorized access may be blocked. Automated or high-volume workflows should use an eligible paid plan and remain within the quota, concurrency, source, and fair-use controls shown for that workspace.</p>
              <p>Features, supported sources, response times, and availability may change as external platforms and service providers change. EasyTran does not promise that every URL will produce a transcript or that access will always be uninterrupted. Paid plan pricing, billing periods, included limits, cancellation handling, and refunds are governed by the terms displayed during checkout; custom Business or Enterprise commitments apply only when they are confirmed in a written order or agreement.</p>
              <p>Access may be limited, suspended, or removed to protect the service, enforce quotas and fair-use controls, respond to unlawful activity, or prevent abuse. This summary explains current product behavior but is not a substitute for a complete, jurisdiction-specific privacy notice or contract. Privacy and deletion requests can be sent to <a href="mailto:easytran@proton.me">easytran@proton.me</a>.</p>
            </div>
          </div>
        </section>
      </article>

      {languageListOpen && (
        <div
          className="language-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLanguageListOpen(false)
          }}
        >
          <section className="language-modal" role="dialog" aria-modal="true" aria-labelledby="language-list-title">
            <div className="language-modal-head">
              <div>
                <h2 id="language-list-title">{LANGUAGES.length} supported languages</h2>
              </div>
              <button type="button" onClick={() => setLanguageListOpen(false)} aria-label="Close language list">
                <X size={17} />
              </button>
            </div>
            <ul>
              {LANGUAGES.map((language) => (
                <li key={language.code}>
                  <span className="language-flag" aria-hidden="true">
                    <img
                      src={`https://flagcdn.com/24x18/${languageFlagRegion(language.code)}.png`}
                      alt=""
                      width="24"
                      height="18"
                      loading="lazy"
                    />
                  </span>
                  <strong>{language.name}</strong>
                  <code>{language.code}</code>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {feedbackOpen && (
        <div className="docs-feedback-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeFeedback()
        }}>
          <section className="docs-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
            <button className="docs-feedback-close" type="button" onClick={closeFeedback} aria-label="Close feedback">
              <X size={17} />
            </button>
            {feedbackState === 'sent' ? (
              <div className="docs-feedback-success">
                <CheckCircle2 size={28} />
                <h2 id="feedback-title">Feedback received</h2>
                <p>Your message is now in the admin inbox.</p>
                <button type="button" onClick={closeFeedback}>Done</button>
              </div>
            ) : (
              <>
                <span className="docs-feedback-kicker"><MessageSquareText size={15} /> Feedback</span>
                <h2 id="feedback-title">Tell us what should be better.</h2>
                <p>Only a username and your message are needed.</p>
                <form onSubmit={submitFeedback}>
                  <label>
                    Username
                    <input
                      ref={feedbackUsernameRef}
                      value={feedbackUsername}
                      onChange={(event) => setFeedbackUsername(event.target.value)}
                      minLength={2}
                      maxLength={80}
                      autoComplete="username"
                      required
                    />
                  </label>
                  <label>
                    Message
                    <textarea
                      value={feedbackMessage}
                      onChange={(event) => setFeedbackMessage(event.target.value)}
                      minLength={3}
                      maxLength={3000}
                      rows={6}
                      required
                    />
                    <small>{feedbackMessage.length.toLocaleString('en-US')} / 3,000</small>
                  </label>
                  {feedbackState === 'error' && <div className="docs-feedback-error">{feedbackError}</div>}
                  <button className="docs-feedback-submit" type="submit" disabled={feedbackState === 'sending'}>
                    {feedbackState === 'sending' ? 'Sending…' : <><Send size={15} /> Send feedback</>}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}

      <footer className="docs-footer">
        <a href="/">Back to Transcribe <ArrowRight size={15} /></a>
      </footer>
    </section>
  )
}
