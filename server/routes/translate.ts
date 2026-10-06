import { Router } from 'express'
import { translateTexts } from '../lib/translate'

export const translateRouter = Router()

translateRouter.post('/', async (request, response) => {
  const target = String(request.body?.target || '').trim()
  const rawTexts = request.body?.texts
  const texts = Array.isArray(rawTexts) ? rawTexts.map((value) => String(value)) : []

  if (!target || texts.length === 0) {
    response.status(400).json({ error: 'target and texts are required' })
    return
  }

  if (texts.length > 1500) {
    response.status(413).json({ error: 'too_many_segments' })
    return
  }

  try {
    const translations = await translateTexts(texts, target)
    response.json({ translations })
  } catch (error) {
    response.status(502).json({
      error: 'translate_failed',
      message: error instanceof Error ? error.message : 'Translation failed',
    })
  }
})
