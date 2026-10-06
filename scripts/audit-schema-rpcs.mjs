// Live, readonly PostgREST contract audit. Never invokes write RPCs or reads rows.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const defaultProject = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const identifier = '[a-z_][a-z_0-9]*'
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

// This recognises the repository's unquoted public DDL, not arbitrary SQL.
// Unknown/dynamic runtime dependency expressions fail closed below.
export function collectContract(projectDirectory) {
  const serverDirectory = path.join(projectDirectory, 'server')
  const migrations = fs.readdirSync(path.join(serverDirectory, 'migrations')).filter((name) => name.endsWith('.sql')).sort()
  const sqlFiles = ['schema.sql', ...migrations.map((name) => `migrations/${name}`)]
  const sql = stripComments(sqlFiles.map((name) => fs.readFileSync(path.join(serverDirectory, name), 'utf8')).join('\n'))
  const tables = new Map()
  for (const match of sql.matchAll(new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?(${identifier})\\s*\\(([\\s\\S]*?)\\n\\);`, 'gi'))) {
    const columns = tables.get(match[1]) || new Set()
    for (const line of match[2].split('\n')) {
      const column = /^\s*([a-z_][a-z_0-9]*)\s+[a-z_]/i.exec(line)?.[1]
      if (column && !/^(constraint|primary|foreign|unique|check|exclude)$/i.test(column)) columns.add(column)
    }
    tables.set(match[1], columns)
  }
  for (const match of sql.matchAll(new RegExp(`ALTER\\s+TABLE\\s+(?:public\\.)?(${identifier})([\\s\\S]*?);`, 'gi'))) {
    const columns = tables.get(match[1]) || new Set()
    for (const added of match[2].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z_0-9]*)/gi)) columns.add(added[1])
    tables.set(match[1], columns)
  }
  const definedRpcs = new Map()
  for (const match of sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?(${identifier})\\s*\\(([^)]*)\\)`, 'gi'))) {
    definedRpcs.set(match[1], [...match[2].matchAll(/\b(p_[a-z_0-9]+)\s+[a-z_]/gi)].map((argument) => argument[1]).sort())
  }
  const rpcs = new Set()
  const runtimeTables = new Set()
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(entryPath)
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        const source = stripComments(fs.readFileSync(entryPath, 'utf8'))
        for (const match of source.matchAll(/\bsupabase\s*\.(rpc|from)\s*\(\s*([^\r\n]*)/g)) {
          const name = /^['"]([a-z_0-9]+)['"]/.exec(match[2])?.[1]
          if (!name) {
            // The readiness adapter dispatches precisely these two probes. Other
            // dynamic dependencies must be added explicitly instead of skipped.
            if (match[1] === 'rpc' && path.relative(serverDirectory, entryPath) === 'index.ts'
              && source.includes('probeReadonlyRpcContracts((name, parameters) =>')
              && /^name,\s*parameters(?:,\s*\{\s*get:\s*true\s*\})?\)/.test(match[2])) {
              for (const probe of Object.keys(readonlyProbes)) rpcs.add(probe)
              continue
            }
            throw new Error('Dynamic DB dependencies require an explicit audit contract.')
          }
          if (match[1] === 'rpc') rpcs.add(name)
          else runtimeTables.add(name)
        }
      }
    }
  }
  walk(serverDirectory)
  for (const name of runtimeTables) if (!tables.has(name)) throw new Error(`No local table contract: ${name}`)
  for (const name of rpcs) if (!definedRpcs.has(name)) throw new Error(`No local RPC contract: ${name}`)
  if (!tables.size || !rpcs.size) throw new Error('Empty schema or runtime RPC contract.')
  return {
    tables: Object.fromEntries([...tables].sort().map(([name, columns]) => [name, [...columns].sort()])),
    rpcs: Object.fromEntries([...rpcs].sort().map((name) => [name, definedRpcs.get(name)])),
  }
}

// GET RPC requests are read-only transactions in PostgREST. A drifted VOLATILE
// implementation is refused; even a wrongly marked STABLE writer cannot commit.
const readonlyProbes = {
  validate_api_key: { p_key_hash: '0'.repeat(64) },
  get_workspace_monthly_usage: { p_user_id: '00000000-0000-0000-0000-000000000000' },
}
const safeCode = (value) => typeof value === 'string' && /^[A-Z0-9_]{1,24}$/.test(value) ? value : null

export async function auditLiveSchema({ contract, supabaseUrl, serviceKey, fetchImpl = fetch, timeoutMs = 8000 }) {
  const origin = new URL(supabaseUrl)
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash) throw new Error('Invalid SUPABASE_URL.')
  const base = `${origin.toString().replace(/\/$/, '')}/rest/v1/`
  const request = async (relative, accept = 'application/json') => {
    try {
      const response = await fetchImpl(new URL(relative, base), {
        method: 'GET', redirect: 'error',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, accept, 'Accept-Profile': 'public' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      const body = await response.json().catch(() => null)
      return { ok: response.ok, status: response.status, code: safeCode(body?.code), body }
    } catch {
      // Never include network exceptions, provider messages, URLs or response rows.
      return { ok: false, status: null, code: 'REQUEST_FAILED', body: null }
    }
  }
  const discovery = await request('', 'application/openapi+json')
  const validDiscovery = discovery.ok && discovery.body?.paths && discovery.body?.definitions
  const tables = []
  for (const [name, columns] of Object.entries(contract.tables)) {
    const metadata = validDiscovery ? discovery.body.definitions[name]?.properties : null
    const missingColumns = columns.filter((column) => !metadata || !(column in metadata))
    // Zero rows, no count: validate SELECT access and cached columns without data.
    const probe = await request(`${name}?${new URLSearchParams({ select: columns.join(','), limit: '0' })}`)
    tables.push({ name, ok: Boolean(metadata) && !missingColumns.length && probe.ok, missingColumns, status: probe.status, code: probe.code })
  }
  const rpcs = Object.entries(contract.rpcs).map(([name, argumentsExpected]) => {
    const endpoint = validDiscovery ? discovery.body.paths[`/rpc/${name}`] : null
    const postParameters = endpoint?.post?.parameters || []
    const bodyParameter = postParameters.find((parameter) => parameter.in === 'body')?.schema
    const bodySchema = bodyParameter?.$ref ? discovery.body.definitions[bodyParameter.$ref.split('/').pop()] : bodyParameter
    const availableArguments = Object.keys(bodySchema?.properties || {})
    const missingArguments = argumentsExpected.filter((argument) => !availableArguments.includes(argument))
    return { name, ok: Boolean(endpoint?.post) && !missingArguments.length, missingArguments, check: 'discovery' }
  })
  for (const [name, parameters] of Object.entries(readonlyProbes)) {
    if (!(name in contract.rpcs)) continue
    const probe = await request(`rpc/${name}?${new URLSearchParams(parameters)}`)
    const result = rpcs.find((rpc) => rpc.name === name)
    result.ok = result.ok && probe.ok
    result.check = 'discovery_and_readonly_execution'
    result.status = probe.status
    result.code = probe.code
  }
  return {
    kind: 'live_postgrest_readonly_contract', checkedAt: new Date().toISOString(),
    contractSha256: createHash('sha256').update(JSON.stringify(contract)).digest('hex'),
    ok: Boolean(validDiscovery) && tables.every((table) => table.ok) && rpcs.every((rpc) => rpc.ok),
    discovery: { ok: Boolean(validDiscovery), status: discovery.status, code: discovery.code },
    tables, rpcs,
    limitations: 'Checks exposed public table/column names and service-role SELECT access, RPC signatures, and two readonly RPC executions. Other RPCs are discovery-only. Does not prove pg_catalog state, RLS isolation, column types, full function semantics or product readiness.',
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    if (!['--env', '--project-dir', '--out'].includes(flag) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: audit-schema-rpcs.mjs [--env file] [--project-dir directory] [--out report.json]')
    options[flag] = args[index + 1]
  }
  const project = path.resolve(options['--project-dir'] || defaultProject)
  const config = dotenv.config({ path: options['--env'] || path.join(project, 'server', '.env'), quiet: true })
  if (options['--env'] && config.error) throw new Error('Explicit audit env file could not be read.')
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required for the live audit.')
  const result = await auditLiveSchema({ contract: collectContract(project), supabaseUrl: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_KEY })
  const report = `${JSON.stringify(result, null, 2)}\n`
  if (options['--out']) fs.writeFileSync(options['--out'], report, 'utf8')
  console.log(report.trim())
  process.exitCode = result.ok ? 0 : 1
}

if (process.argv[1] === '-' || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  main().catch(() => { console.error('Live schema audit failed: check CLI arguments, local schema contract and DB configuration. No credentials or provider messages are logged.'); process.exitCode = 1 })
}
