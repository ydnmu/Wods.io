import { Router } from 'express'
import type { Request, Response } from 'express'
import { syncAllChannels } from '../lib/channelSync'
import { retryFailedWebhooks } from '../lib/webhooks'
import { processPendingBatchItems } from './batch'
import { expireBetaAccess } from '../lib/workspaceProvisioning'

export const cronRouter = Router()

cronRouter.use((request, response, next) => {
  const secret = process.env.CRON_SECRET
  const bearer = request.headers.authorization === `Bearer ${secret}`
  const customHeader = request.headers['x-cron-secret'] === secret
  if (!secret || (!bearer && !customHeader)) {
    response.status(401).json({ error: 'unauthorized' })
    return
  }

  next()
})

const webhookRetry = async (_request: Request, response: Response) => {
  const processed = await retryFailedWebhooks()
  response.json({ success: true, processed: processed ?? 0 })
}

const channelSync = async (_request: Request, response: Response) => {
  await syncAllChannels()
  response.json({ success: true })
}

const batchProcess = async (_request: Request, response: Response) => {
  const processed = await processPendingBatchItems()
  response.json({ success: true, processed })
}

const betaExpiry = async (_request: Request, response: Response) => {
  const expired = await expireBetaAccess()
  response.json({ success: true, expired })
}

cronRouter.get('/webhook-retry', webhookRetry)
cronRouter.post('/webhook-retry', webhookRetry)
cronRouter.get('/channel-sync', channelSync)
cronRouter.post('/channel-sync', channelSync)
cronRouter.get('/batch-process', batchProcess)
cronRouter.post('/batch-process', batchProcess)
cronRouter.get('/beta-expiry', betaExpiry)
cronRouter.post('/beta-expiry', betaExpiry)
