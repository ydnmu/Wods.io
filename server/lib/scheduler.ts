import { processPendingBatchItems } from '../routes/batch'
import { syncAllChannels } from './channelSync'
import { expireBetaAccess } from './workspaceProvisioning'
import { retryFailedWebhooks } from './webhooks'
import { preventTaskOverlap } from './schedulerRunner'

const runSafely = async (name: string, task: () => Promise<unknown>) => {
  try {
    await task()
  } catch (error) {
    console.error(`[scheduler] ${name} failed:`, error)
  }
}

const every = (milliseconds: number, name: string, task: () => Promise<unknown>, initialDelayMs?: number) => {
  const run = preventTaskOverlap(() => runSafely(name, task))
  if (initialDelayMs !== undefined) setTimeout(() => { void run() }, initialDelayMs).unref()
  const timer = setInterval(() => { void run() }, milliseconds)
  timer.unref()
  return timer
}

export function startScheduler() {
  if (process.env.ENABLE_INTERNAL_SCHEDULER !== 'true') return

  every(5_000, 'batch-process', processPendingBatchItems)
  every(60_000, 'webhook-retry', retryFailedWebhooks, 10_000)
  every(15 * 60_000, 'channel-sync', syncAllChannels, 10_000)
  every(60 * 60_000, 'beta-expiry', expireBetaAccess, 10_000)
  console.log('[scheduler] internal workers enabled')
}
