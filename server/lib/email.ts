import './env'
import { Resend } from 'resend'
import { getPlanPolicy } from './plans'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const fromEmail = process.env.FROM_EMAIL || 'noreply@easytran.app'
const supportEmail = process.env.SUPPORT_EMAIL || 'easytran@proton.me'
const feedbackEmail = process.env.FEEDBACK_EMAIL || 'feedback@easytran.app'
const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '')

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

async function sendEmail(input: { to: string; subject: string; html: string }) {
  if (!resend) {
    throw new Error('email_not_configured')
  }

  const result = await resend.emails.send({
    from: fromEmail,
    to: input.to,
    subject: input.subject,
    html: input.html,
  })
  if (result.error) throw new Error(`email_delivery_failed: ${result.error.message}`)
}

export function renderWorkspaceAccessEmail(params: {
  accessKey: string
  plan: string
  limit: number
}) {
  const planLabel = params.plan === 'api'
    ? 'Developer'
    : params.plan.charAt(0).toUpperCase() + params.plan.slice(1)
  const escapedKey = escapeHtml(params.accessKey)
  const copyKeyJs = escapeHtml(JSON.stringify(params.accessKey))
  const forestImageUrl = `${clientUrl}/wallpapers/evgeni-evgeniev-LPKk3wtkC-g-unsplash.jpg`
  const logoUrl = `${clientUrl}/wods-logo.svg`

  return {
    subject: `Your WODS ${planLabel} dashboard access`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <title>Your WODS dashboard access</title>
        <style>
          @media only screen and (max-width: 640px) {
            .email-frame { padding: 18px 10px !important; }
            .email-card { padding: 30px 22px !important; }
            .email-hero { padding: 34px 22px 28px !important; }
            .email-code { font-size: 11px !important; }
            .email-action { display: block !important; margin: 0 0 10px !important; text-align: center !important; }
          }
        </style>
      </head>
      <body style="margin:0;padding:0;background:#080808;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your one-time access key and dashboard setup are inside.</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#080808;">
          <tr>
            <td class="email-frame" align="center" style="padding:32px 16px 40px;">
              <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;border-collapse:separate;border-spacing:0;">
                <tr>
                  <td
                    class="email-hero"
                    background="${forestImageUrl}"
                    style="padding:38px 40px 34px;border:1px solid #2c2c2c;border-bottom:0;border-radius:10px 10px 0 0;background-color:#111111;background-image:linear-gradient(90deg,rgba(7,7,7,.94),rgba(7,7,7,.76)),url('${forestImageUrl}');background-position:center 34%;background-size:cover;"
                  >
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td>
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td style="padding-right:9px;"><img src="${logoUrl}" width="25" height="25" alt="" style="display:block;width:25px;height:25px;border:0;" /></td>
                              <td style="color:#d7d7d7;font-size:19px;font-weight:750;letter-spacing:-.03em;text-shadow:0 0 16px rgba(255,255,255,.24);">WODS</td>
                            </tr>
                          </table>
                        </td>
                        <td align="right" style="white-space:nowrap;font-size:16px;font-weight:750;letter-spacing:-.01em;">
                          <span style="color:#79d8ff;text-shadow:0 0 8px rgba(121,216,255,.9),0 0 20px rgba(74,201,255,.62);">${planLabel} plan</span>
                        </td>
                      </tr>
                    </table>
                    <h1 style="margin:32px 0 8px;font-size:32px;line-height:1.08;letter-spacing:-.04em;font-weight:650;color:#ffffff;">Your dashboard is ready.</h1>
                    <p style="margin:0;color:#bdbdbd;font-size:15px;line-height:1.6;">Enter once. Create your permanent login.</p>
                  </td>
                </tr>
                <tr>
                  <td class="email-card" style="padding:36px 40px 38px;border:1px solid #2c2c2c;border-top-color:#353535;border-radius:0 0 10px 10px;background:#121212;box-shadow:0 28px 80px rgba(0,0,0,.52);">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td width="38" valign="top" style="padding:2px 0 28px;color:#79d8ff;font-size:11px;font-weight:750;letter-spacing:.08em;text-shadow:0 0 14px rgba(74,201,255,.8);">01</td>
                        <td style="padding:0 0 28px;">
                          <div style="margin:0 0 10px;color:#f7f9fb;font-size:15px;font-weight:650;">Copy your key</div>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="email-code" style="border:1px solid #2c2c2c;border-radius:6px;background:#090909;box-shadow:0 0 28px rgba(74,201,255,.045);">
                            <tr>
                              <td style="padding:14px 10px 14px 16px;color:#ffffff;font-family:SFMono-Regular,Consolas,'Liberation Mono',monospace;font-size:13px;line-height:1.55;word-break:break-all;">${escapedKey}</td>
                              <td width="72" align="right" style="padding:8px 8px 8px 0;">
                                <button type="button" aria-label="Copy access key" onclick="navigator.clipboard.writeText(${copyKeyJs});this.textContent='Copied'" style="display:inline-block;width:64px;padding:9px 0;border:1px solid #3b3b3b;border-radius:4px;background:#222222;color:#79d8ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:11px;font-weight:750;line-height:1;letter-spacing:.02em;cursor:pointer;text-shadow:0 0 10px rgba(74,201,255,.55);">Copy</button>
                              </td>
                            </tr>
                          </table>
                          <div style="margin-top:9px;color:#7d7d7d;font-size:12px;line-height:1.5;">This key is temporary.</div>
                        </td>
                      </tr>
                      <tr>
                        <td width="38" valign="top" style="padding:2px 0 28px;color:#79d8ff;font-size:11px;font-weight:750;letter-spacing:.08em;text-shadow:0 0 14px rgba(74,201,255,.8);">02</td>
                        <td style="padding:0 0 28px;">
                          <div style="margin:0 0 8px;color:#f7f9fb;font-size:15px;font-weight:650;">Open dashboard</div>
                          <div style="margin:0 0 16px;color:#7d7d7d;font-size:12px;line-height:1.5;">Choose “Login with key”, then paste your key.</div>
                          <a class="email-action" href="${clientUrl}/dashboard?mode=key" style="display:inline-block;padding:12px 17px;border:1px solid #484848;border-radius:5px;background:#292929;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;box-shadow:0 0 22px rgba(74,201,255,.065);">Open dashboard&nbsp;&nbsp;→</a>
                        </td>
                      </tr>
                      <tr>
                        <td width="38" valign="top" style="padding-top:2px;color:#79d8ff;font-size:11px;font-weight:750;letter-spacing:.08em;text-shadow:0 0 14px rgba(74,201,255,.8);">03</td>
                        <td>
                          <div style="margin:0 0 7px;color:#f7f9fb;font-size:15px;font-weight:650;">Make your permanent login</div>
                          <div style="margin:0;color:#8a8a8a;font-size:13px;line-height:1.55;">After you use the key, make a username and password. The temporary key stops working after setup.</div>
                        </td>
                      </tr>
                    </table>
                    <div style="margin-top:34px;padding-top:20px;border-top:1px solid #272727;color:#6d6d6d;font-size:11.5px;line-height:1.6;">Need help? <a href="mailto:${feedbackEmail}" style="color:#a0a0a0;text-decoration:none;">${feedbackEmail}</a></div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  }
}

export async function sendWorkspaceAccessEmail(params: {
  to: string
  accessKey: string
  plan: string
  limit: number
}) {
  const email = renderWorkspaceAccessEmail(params)

  await sendEmail({
    to: params.to,
    subject: email.subject,
    html: email.html,
  })
}

export async function sendMagicLinkEmail(params: { to: string; token: string }) {
  const link = `${clientUrl}/auth/verify?token=${params.token}`

  await sendEmail({
    to: params.to,
    subject: 'Sign in to WODS dashboard',
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0e0f12;color:#f4f5f7;margin:0;padding:40px 20px;">
        <div style="background:#16181c;border:1px solid rgba(255,255,255,0.08);border-radius:8px;max-width:480px;margin:0 auto;padding:40px;">
          <div style="font-size:20px;font-weight:700;margin-bottom:32px;">WODS<span style="color:#ec3b6e;">.</span></div>
          <h1 style="font-size:22px;font-weight:600;margin:0 0 8px;">Sign in to Dashboard</h1>
          <p style="color:#c8cad0;line-height:1.6;margin:0 0 24px;font-size:15px;">Click the button below to sign in. This link expires in 15 minutes.</p>
          <a href="${link}" style="display:inline-block;background:linear-gradient(110deg,#a855f7,#ec3b6e);color:white;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:600;font-size:15px;margin-bottom:24px;">Sign In</a>
          <p style="font-size:13px;color:#8b8e96;">If you didn't request this, ignore this email.</p>
        </div>
      </body>
      </html>
    `,
  })
}

export async function sendPlanUpdatedEmail(params: {
  to: string
  plan: string
  limit: number
}) {
  const planLabel = params.plan === 'api'
    ? 'Developer'
    : params.plan.charAt(0).toUpperCase() + params.plan.slice(1)
  const policy = getPlanPolicy(params.plan)
  const captionHours = policy.captionSecondsLimit == null ? 'Custom' : (policy.captionSecondsLimit / 3600).toLocaleString('en-US')
  const fallbackHours = policy.aiFallbackSecondsLimit == null ? 'Custom' : (policy.aiFallbackSecondsLimit / 3600).toLocaleString('en-US')

  await sendEmail({
    to: params.to,
    subject: 'Your WODS plan has been updated',
    html: `<p>Your plan has been updated to <strong>${planLabel}</strong>.</p><p>Your monthly allowance is <strong>${captionHours} caption hours</strong> and <strong>${fallbackHours} AI fallback hours</strong>. There is no request-count quota; usage is measured by source duration. Your existing API key continues to work.</p>`,
  })
}

export async function sendFeedbackEmail(params: { username: string; message: string }) {
  const username = escapeHtml(params.username)
  const message = escapeHtml(params.message).replace(/\r?\n/g, '<br />')
  const subjectUsername = params.username.replace(/[\r\n]+/g, ' ').slice(0, 60)

  await sendEmail({
    to: supportEmail,
    subject: `WODS feedback from ${subjectUsername}`,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#08090b;color:#f4f5f7;margin:0;padding:40px 20px;">
        <div style="background:#121418;border:1px solid rgba(255,255,255,0.1);border-radius:12px;max-width:600px;margin:0 auto;padding:32px;">
          <div style="font-size:20px;font-weight:750;margin-bottom:26px;">WODS<span style="color:#79d8ff;">.</span> Feedback</div>
          <div style="font-size:12px;color:#8f949e;margin-bottom:7px;">Username</div>
          <div style="color:#f4f5f7;font-size:15px;margin-bottom:22px;">${username}</div>
          <div style="font-size:12px;color:#8f949e;margin-bottom:7px;">Message</div>
          <div style="background:#090a0d;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:17px 18px;color:#d9dce2;font-size:14px;line-height:1.7;">${message}</div>
        </div>
      </body>
      </html>
    `,
  })
}