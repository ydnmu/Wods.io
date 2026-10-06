import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeBatchUrls, queueBatchJob } from './batchJobs'
import { dbError, dbOk, mockJobDatabase, operationValue } from './jobTestSupport'
import { supabase } from './supabase'

test('installed Supabase RPC builder is a lazy thenable without catch', () => {
  // Constructing the request does not send it; no live DB/provider is used.
  const request = supabase.rpc('fail_batch_item')
  assert.equal(typeof request.then, 'function')
  assert.equal(typeof (request as unknown as { catch?: unknown }).catch, 'undefined')
})

test('validates and deduplicates batch YouTube URLs', () => {
  const result = normalizeBatchUrls([
    'https://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
  ], 1000)
  assert.equal('urls' in result && result.urls.length, 1)
  assert.equal('duplicatesRemoved' in result && result.duplicatesRemoved, 1)
  assert.deepEqual(normalizeBatchUrls(['invalid'], 1000), { error: 'invalid_url' })
  assert.deepEqual(normalizeBatchUrls(Array.from({ length: 4 }, () => 'https://youtu.be/dQw4w9WgXcQ'), 3), { error: 'batch_limit_exceeded', max: 3 })
})

test('queue validates input without executing a database request', async (context) => {
  const calls = mockJobDatabase(context, () => { throw new Error('unexpected_database_call') })
  assert.deepEqual(await queueBatchJob('user-1', 'business', ['invalid']), { error: 'invalid_url' })
  assert.equal(calls.length, 0)
})

test('queue returns the created job and inserts deduplicated items', async (context) => {
  const job = { id: 'job-1', total: 1, status: 'processing', created_at: '2026-10-05T09:00:00Z' }
  const calls = mockJobDatabase(context, (request) => dbOk(request.name === 'batch_jobs' ? job : null))
  assert.deepEqual(await queueBatchJob('user-1', 'business', [
    'https://youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ',
  ]), { job, duplicatesRemoved: 1 })
  assert.deepEqual(operationValue(calls[1], 'insert'), [{ batch_job_id: 'job-1', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }])
})

test('queue item insert failure awaits rollback of the created job', async (context) => {
  let jobExists = false
  const calls = mockJobDatabase(context, (request) => {
    if (request.name === 'batch_items') return dbError('item_insert_failed')
    if (request.operations.some((operation) => operation.method === 'delete')) {
      jobExists = false
      return dbOk()
    }
    jobExists = true
    return dbOk({ id: 'job-1', total: 1, status: 'processing', created_at: '2026-10-05T09:00:00Z' })
  })
  assert.deepEqual(await queueBatchJob('user-1', 'business', ['https://youtu.be/dQw4w9WgXcQ']), { error: 'db_error' })
  assert.equal(jobExists, false)
  assert.equal(calls.length, 3)
  assert.ok(calls[2].operations.some((operation) => operation.method === 'eq' && operation.args[0] === 'id' && operation.args[1] === 'job-1'))
})

test('queue exposes rollback failure instead of silently abandoning an empty job', async (context) => {
  mockJobDatabase(context, (request) => {
    if (request.name === 'batch_items') return dbError('item_insert_failed')
    if (request.operations.some((operation) => operation.method === 'delete')) return dbError('rollback_failed')
    return dbOk({ id: 'job-1', total: 1, status: 'processing', created_at: '2026-10-05T09:00:00Z' })
  })
  assert.deepEqual(await queueBatchJob('user-1', 'business', ['https://youtu.be/dQw4w9WgXcQ']), { error: 'db_error', cleanup_failed: true })
})

test('accepts a full 1,000-video paid batch without truncating it', () => {
  const urls = Array.from({ length: 1000 }, (_, index) =>
    `https://youtube.com/watch?v=${index.toString(36).padStart(11, '0')}`)
  const result = normalizeBatchUrls(urls, 1000)
  assert.equal('urls' in result && result.urls.length, 1000)
  assert.equal('duplicatesRemoved' in result && result.duplicatesRemoved, 0)
})
