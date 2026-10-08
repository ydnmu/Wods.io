import { Router } from 'express'
import { openRouterKeyPool } from '../lib/openRouterPool'

export const summaryRouter = Router()

export const hasSummaryProvider = () => Boolean(openRouterKeyPool.size || process.env.OPENAI_API_KEY)

const summaryInstruction =
  'Return only valid JSON with keys title, summary, tags. Summary is 2-3 concise sentences. Tags is max 5 strings.'

export function parseSummaryContent(content: string) {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(normalized) as Record<string, unknown>
  const title = String(parsed.title || '').trim()
  const summary = String(parsed.summary || '').trim()
  const tags = Array.isArray(parsed.tags)
    ? [...new Set(parsed.tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 5)
    : []
  if (!title || !summary) throw new Error('Summary provider returned an invalid response')
  return { title, summary, tags }
}

async function summarizeWithOpenRouter(title: string, text: string) {
  const attempts = Math.max(1, openRouterKeyPool.size)
  let lastError = 'OpenRouter is busy'

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const lease = openRouterKeyPool.acquire()
    if (!lease) break
    let cooldownMs = 0

    try {
      const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${lease.key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.CLIENT_URL || 'https://wods.io',
          'X-Title': 'WODS',
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_SUMMARY_MODEL || 'openrouter/free',
          temperature: 0.2,
          max_tokens: 420,
          messages: [
            { role: 'system', content: summaryInstruction },
            { role: 'user', content: `Video title: ${title}\n\nTranscript:\n${text}` },
          ],
        }),
        signal: AbortSignal.timeout(Number(process.env.OPENROUTER_TIMEOUT_MS || 45_000)),
      })

      if (!aiResponse.ok) {
        const retryAfter = Number(aiResponse.headers.get('Retry-After') || 0)
        if ([401, 402, 429, 503].includes(aiResponse.status)) {
          cooldownMs = Math.max(15_000, Math.min(300_000, retryAfter * 1000 || 30_000))
        }
        lastError = `OpenRouter request failed: ${aiResponse.status}`
        continue
      }

      const payload = await aiResponse.json()
      const content = String(payload.choices?.[0]?.message?.content || '{}')
      return parseSummaryContent(content)
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'OpenRouter summary failed'
    } finally {
      lease.release(cooldownMs)
    }
  }

  throw new Error(lastError)
}

async function summarizeWithOpenAI(title: string, text: string) {
  const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 420,
      messages: [
        { role: 'system', content: summaryInstruction },
        { role: 'user', content: `Video title: ${title}\n\nTranscript:\n${text}` },
      ],
    }),
    signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS || 45_000)),
  })

  if (!aiResponse.ok) throw new Error(`OpenAI request failed: ${aiResponse.status}`)
  const payload = await aiResponse.json()
  return parseSummaryContent(String(payload.choices?.[0]?.message?.content || '{}'))
}

export async function generateTranscriptSummary(title: string, text: string) {
  if (!text.trim()) throw new Error('Transcript text required')
  if (!hasSummaryProvider()) {
    throw new Error('No summary provider is configured')
  }

  try {
    if (openRouterKeyPool.size) return await summarizeWithOpenRouter(title, text.slice(0, 12000))
  } catch (openRouterError) {
    if (!process.env.OPENAI_API_KEY) throw openRouterError
  }

  return summarizeWithOpenAI(title, text.slice(0, 12000))
}

summaryRouter.post('/', async (request, response) => {
  const text = String(request.body?.text || '').slice(0, 12000)
  const title = String(request.body?.title || 'YouTube transcript')

  if (!text.trim()) {
    response.status(400).json({ error: 'Transcript text required' })
    return
  }

  if (!hasSummaryProvider()) {
    response.status(501).json({
      error: 'summary_unavailable',
      message: 'AI summaries are temporarily unavailable. Your transcript is still available.',
    })
    return
  }

  try {
    response.json(await generateTranscriptSummary(title, text))
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Summary failed',
    })
  }
})
