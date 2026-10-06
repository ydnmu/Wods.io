import { Router } from 'express'
import { sendFeedbackEmail } from '../lib/email'
import { requireSupabaseConfig, supabase } from '../lib/supabase'

export const feedbackRouter = Router()

feedbackRouter.post('/', async (request, response) => {
  requireSupabaseConfig()

  const username = String(request.body?.username || '').trim()
  const message = String(request.body?.message || '').trim()

  if (username.length < 2 || username.length > 80 || message.length < 3 || message.length > 3000) {
    response.status(400).json({
      error: 'invalid_feedback',
      message: 'Enter a username and a message of up to 3,000 characters.',
    })
    return
  }

  const { data, error } = await supabase
    .from('feedback_messages')
    .insert({
      username,
      message,
      source: 'docs',
      status: 'new',
    })
    .select('id')
    .single()

  if (error || !data) {
    response.status(500).json({ error: 'feedback_storage_failed' })
    return
  }

  let emailDelivered = true
  try {
    await sendFeedbackEmail({ username, message })
  } catch {
    emailDelivered = false
  }

  response.status(emailDelivered ? 201 : 202).json({
    success: true,
    id: data.id,
    emailDelivered,
  })
})
