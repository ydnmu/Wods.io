import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { auditLiveSchema, collectContract } from './audit-schema-rpcs.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationName = '2026-10-05_repair_readonly_workspace_rpcs.sql'
const contract = {
  tables: { users: ['id', 'email'] },
  rpcs: { validate_api_key: ['p_key_hash'], get_workspace_monthly_usage: ['p_user_id'], consume_api_key_request: ['p_key_hash'] },
}
const specification = () => ({
  paths: Object.fromEntries(Object.entries(contract.rpcs).map(([name, args]) => [`/rpc/${name}`, { post: { parameters: [{ in: 'body', schema: { properties: Object.fromEntries(args.map((arg) => [arg, { type: 'string' }])) } }] } }])),
  definitions: { users: { properties: { id: {}, email: {} } } },
})
const setup = (handler = () => null) => {
  const requests = []
  return {
    requests,
    options: {
      contract, supabaseUrl: 'https://db.invalid', serviceKey: 'secret-must-never-be-logged',
      fetchImpl: async (url, options) => {
        requests.push({ url: new URL(url), options })
        return handler(url, options) || Response.json(new URL(url).pathname === '/rest/v1/' ? specification() : [])
      },
    },
  }
}

test('live audit uses only GET, limit=0 tables, and the two safe RPC probes', async () => {
  const mock = setup()
  const result = await auditLiveSchema(mock.options)
  assert.equal(result.ok, true)
  assert.equal(mock.requests.length, 4)
  for (const { options } of mock.requests) { assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.body, undefined) }
  const table = mock.requests.find(({ url }) => url.pathname.endsWith('/users')).url
  assert.equal(table.searchParams.get('limit'), '0')
  assert.equal(table.searchParams.get('select'), 'id,email')
  assert.equal(mock.requests.some(({ url }) => url.pathname.includes('consume_api_key_request')), false)
  assert.equal(mock.requests.find(({ url }) => url.pathname.endsWith('/validate_api_key')).url.searchParams.get('p_key_hash'), '0'.repeat(64))
  assert.equal(result.rpcs.find((rpc) => rpc.name === 'consume_api_key_request').check, 'discovery')
})

test('missing RPC, input argument and table column fail the live audit', async () => {
  const mock = setup((url) => {
    if (new URL(url).pathname === '/rest/v1/') {
      const spec = specification()
      delete spec.paths['/rpc/validate_api_key']
      delete spec.paths['/rpc/get_workspace_monthly_usage'].post.parameters[0].schema.properties.p_user_id
      delete spec.definitions.users.properties.email
      return Response.json(spec)
    }
    if (new URL(url).pathname.endsWith('/validate_api_key')) return Response.json({ code: 'PGRST202', message: 'private details' }, { status: 404 })
    return null
  })
  const result = await auditLiveSchema(mock.options)
  assert.equal(result.ok, false)
  assert.deepEqual(result.tables[0].missingColumns, ['email'])
  assert.deepEqual(result.rpcs.find((rpc) => rpc.name === 'get_workspace_monthly_usage').missingArguments, ['p_user_id'])
  assert.equal(result.rpcs.find((rpc) => rpc.name === 'validate_api_key').code, 'PGRST202')
})

test('missing table and grants fail without logging data, counts, secrets or provider messages', async () => {
  const mock = setup((url) => {
    if (new URL(url).pathname.endsWith('/users')) return Response.json({ code: 'PGRST205', message: 'customer@example.com secret-must-never-be-logged', count: 999 }, { status: 404 })
    if (new URL(url).pathname.endsWith('/get_workspace_monthly_usage')) return Response.json({ code: '42501', details: 'secret-must-never-be-logged' }, { status: 403 })
    if (new URL(url).pathname.endsWith('/validate_api_key')) return Response.json([{ api_key_id: 'customer-secret-id' }])
    return null
  })
  const result = await auditLiveSchema(mock.options)
  assert.equal(result.ok, false)
  assert.equal(result.tables[0].code, 'PGRST205')
  assert.equal(result.rpcs.find((rpc) => rpc.name === 'get_workspace_monthly_usage').code, '42501')
  assert.doesNotMatch(JSON.stringify(result), /secret|customer|999|count"|https:/)
})

test('discovery errors, malformed OpenAPI and network failures fail closed and redact exceptions', async () => {
  for (const fetchImpl of [async () => Response.json({ error: 'private' }, { status: 401 }), async () => Response.json({}), async () => { throw new Error('secret-key https://private-host') }]) {
    const mock = setup()
    const result = await auditLiveSchema({ ...mock.options, fetchImpl })
    assert.equal(result.ok, false)
    assert.equal(result.discovery.ok, false)
    assert.doesNotMatch(JSON.stringify(result), /secret-key|private-host|"error":"private"/)
  }
})

test('local contract discovers all current columns, runtime RPC names and argument lists', () => {
  const result = collectContract(root)
  assert.ok(Object.keys(result.tables).length >= 24)
  assert.ok(result.tables.api_keys.includes('request_limit'))
  assert.ok(result.tables.dashboard_members.includes('password_hash'))
  assert.ok(result.tables.usage_logs.includes('caption_seconds'))
  assert.deepEqual(result.rpcs.validate_api_key, ['p_key_hash'])
  assert.deepEqual(result.rpcs.get_workspace_monthly_usage, ['p_user_id'])
  assert.ok(result.rpcs.claim_next_batch_item)
})

test('unknown dynamic dependency cannot silently pass the contract scanner', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'easytran-audit-'))
  try {
    fs.mkdirSync(path.join(directory, 'server/migrations'), { recursive: true })
    fs.writeFileSync(path.join(directory, 'server/schema.sql'), 'CREATE TABLE users (\n  id UUID\n);')
    fs.writeFileSync(path.join(directory, 'server/example.ts'), 'supabase.rpc(dynamicName, {})')
    assert.throws(() => collectContract(directory), /Dynamic DB dependencies/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('an explicitly unreadable env fails even when credentials already exist in the process', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'easytran-env-test-'))
  try {
    // A directory cannot be read as an env file on either Windows or Linux.
    const response = spawnSync(process.execPath, [path.join(root, 'scripts/audit-schema-rpcs.mjs'), '--env', directory], {
      encoding: 'utf8', cwd: root,
      env: { ...process.env, SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_KEY: 'fixture-secret' },
    })
    assert.notEqual(response.status, 0)
    assert.doesNotMatch(response.stderr + response.stdout, /fixture-secret|db.invalid/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('feedback repair preserves the original table contract and explicitly restricts grants', () => {
  const oldSql = fs.readFileSync(path.join(root, 'server/migrations/2026-07-26_feedback.sql'), 'utf8')
  const newSql = fs.readFileSync(path.join(root, 'server/migrations/2026-10-05_repair_feedback_messages.sql'), 'utf8').replaceAll('\r\n', '\n')
  assert.equal(newSql.match(/CREATE TABLE[\s\S]*?\n\);/)[0], oldSql.replaceAll('\r\n', '\n').match(/CREATE TABLE[\s\S]*?\n\);/)[0])
  assert.match(newSql, /ALTER TABLE feedback_messages ENABLE ROW LEVEL SECURITY;/)
  assert.match(newSql, /REVOKE ALL ON TABLE feedback_messages FROM PUBLIC, anon, authenticated;/)
  assert.match(newSql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE feedback_messages TO service_role;/)
  assert.match(newSql, /NOTIFY pgrst, 'reload schema';/)
  assert.doesNotMatch(newSql.replace(/--[^\n]*/g, ''), /\b(UPDATE\s+\w+\s+SET|INSERT\s+INTO|DELETE\s+FROM|DROP|TRUNCATE)\b/i)
})

test('db apply/export reject historical bundle replay and export only the chosen repair', () => {
  const script = path.join(root, 'scripts/apply-dashboard-readiness.mjs')
  for (const args of [['--apply'], ['--out', 'unused.sql'], ['--apply', '--migration', '../schema.sql']]) {
    const response = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: root })
    assert.notEqual(response.status, 0)
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'easytran-repair-'))
  try {
    const output = path.join(directory, 'repair.sql')
    const response = spawnSync(process.execPath, [script, '--migration', migrationName, '--out', output], { encoding: 'utf8', cwd: root })
    assert.equal(response.status, 0, response.stderr)
    const sql = fs.readFileSync(output, 'utf8')
    const withoutComments = sql.replace(/--[^\n]*/g, '')
    assert.match(sql, /^BEGIN;/)
    assert.match(sql, /COMMIT;\s*$/)
    assert.equal([...sql.matchAll(/CREATE OR REPLACE FUNCTION /g)].length, 2)
    assert.doesNotMatch(withoutComments, /\b(UPDATE|INSERT|DELETE|ALTER TABLE|DROP|TRUNCATE|consume_api_key_request|reserve_transcript_usage)\b/i)
    assert.equal([...sql.matchAll(/STABLE\s+SECURITY DEFINER\s+SET search_path = public/g)].length, 2)
    assert.equal([...sql.matchAll(/REVOKE ALL ON FUNCTION .* FROM PUBLIC, anon, authenticated/g)].length, 2)
    assert.equal([...sql.matchAll(/GRANT EXECUTE ON FUNCTION .* TO service_role/g)].length, 2)
    assert.match(sql, /NOTIFY pgrst, 'reload schema';/)
    const original = fs.readFileSync(path.join(root, 'server/migrations/2026-07-29_hour_based_customer_quotas.sql'), 'utf8').replaceAll('\r\n', '\n')
    const originalFunctions = original.slice(original.indexOf('CREATE OR REPLACE FUNCTION validate_api_key'), original.indexOf('ALTER TABLE usage_logs', original.indexOf('CREATE OR REPLACE FUNCTION validate_api_key'))).trim()
    assert.ok(sql.replaceAll('\r\n', '\n').includes(originalFunctions), 'Targeted repair must preserve the current readonly RPC contracts verbatim.')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
