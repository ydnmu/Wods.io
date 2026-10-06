import assert from 'node:assert/strict'
import test from 'node:test'
import { preventTaskOverlap } from './schedulerRunner'

test('startup and interval triggers share a guard while a task is running', async () => {
  let calls = 0
  let release!: () => void
  const work = new Promise<void>(resolve => { release = resolve })
  const run = preventTaskOverlap(async () => { calls += 1; await work })
  const first = run()
  await run()
  assert.equal(calls, 1)
  release()
  await first
  await run()
  assert.equal(calls, 2)
})

test('failed scheduled tasks release their guard for the next retry', async () => {
  let calls = 0
  const run = preventTaskOverlap(async () => {
    calls += 1
    if (calls === 1) throw new Error('temporary failure')
  })
  await assert.rejects(run(), /temporary failure/)
  await run()
  assert.equal(calls, 2)
})
