import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { supabase } from './supabase'
import type { VideoMeta } from './youtube'

export type DbRequest = {
  kind: 'rpc' | 'table'
  name: string
  parameters: Record<string, unknown>
  operations: Array<{ method: string; args: unknown[] }>
}

type DbResult = { data: unknown; error: { message: string; code?: string } | null }
export const dbOk = (data: unknown = null): DbResult => ({ data, error: null })
export const dbError = (message: string): DbResult => ({ data: null, error: { message } })
export const operationValue = (request: DbRequest, method: string) =>
  request.operations.find((operation) => operation.method === method)?.args[0]

export const jobVideoMeta = (videoId: string): VideoMeta => ({
  id: videoId, videoId, title: 'Test', channel: 'Channel', duration: '0:45',
  url: `https://youtu.be/${videoId}`, thumbnail: '', language: 'en',
})

// PostgREST builders are lazy thenables, not Promises. Execute only when awaited
// and deliberately expose neither .catch nor .finally, as the real SDK does.
export function mockJobDatabase(context: TestContext, execute: (request: DbRequest) => DbResult | Promise<DbResult>) {
  const calls: DbRequest[] = []
  const builder = (request: DbRequest) => {
    const query = {
      then(onfulfilled: (result: DbResult) => unknown, onrejected?: (error: unknown) => unknown) {
        calls.push(request)
        return Promise.resolve().then(() => execute(request)).then(onfulfilled, onrejected)
      },
    }
    const proxy: object = new Proxy(query, {
      get(target, property) {
        if (property === 'then') return target.then.bind(target)
        if (property === 'catch' || property === 'finally') return undefined
        return (...args: unknown[]) => {
          request.operations.push({ method: String(property), args })
          return proxy
        }
      },
    })
    assert.equal('catch' in query, false)
    return proxy
  }
  context.mock.method(supabase, 'rpc', ((name: string, parameters: Record<string, unknown> = {}) =>
    builder({ kind: 'rpc', name, parameters, operations: [] })) as typeof supabase.rpc)
  context.mock.method(supabase, 'from', ((name: string) =>
    builder({ kind: 'table', name, parameters: {}, operations: [] })) as typeof supabase.from)
  context.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected_network_call_in_job_test') })
  context.mock.method(console, 'error', () => undefined)
  return calls
}
