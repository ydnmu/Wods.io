import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(scriptDirectory, '..')

dotenv.config({ path: path.join(projectDirectory, 'server', '.env'), quiet: true })

const migrationsDirectory = path.join(projectDirectory, 'server', 'migrations')

// All migrations participate in the STATIC source check. They are never replayed
// together against a database; execution/export requires one explicit filename.
const migrationFiles = fs.readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => `server/migrations/${file}`)

if (!migrationFiles.length) throw new Error(`No migrations found in ${migrationsDirectory}`)

const args = process.argv.slice(2)
const applying = args.includes('--apply')
const valueAfter = (flag) => {
  const index = args.indexOf(flag)
  if (index === -1) return ''
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${flag} requires a value.`)
  return args[index + 1]
}
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--apply') continue
  if (['--migration', '--out'].includes(args[index])) { index += 1; continue }
  throw new Error(`Unknown argument: ${args[index]}`)
}
const selectedMigration = valueAfter('--migration')
const outPath = valueAfter('--out')
if (applying && outPath) throw new Error('Use --out to review SQL, or --apply to execute it; not both.')
if ((applying || outPath) && !selectedMigration) {
  throw new Error('Explicit --migration <filename.sql> is required. Historical migrations are never replayed as a bundle on an existing database.')
}
if (selectedMigration && !migrationFiles.includes(`server/migrations/${selectedMigration}`)) {
  throw new Error('--migration must name one file in server/migrations (no paths).')
}
const sectionsFor = (files) => files.map((relativePath) => {
  const absolutePath = path.join(projectDirectory, relativePath)
  if (!fs.existsSync(absolutePath)) throw new Error(`Missing migration: ${relativePath}`)
  return `-- BEGIN ${relativePath}\n${fs.readFileSync(absolutePath, 'utf8').trim()}\n-- END ${relativePath}`
})

const migrationSql = sectionsFor(migrationFiles).join('\n\n')
const selectedSql = selectedMigration
  ? `BEGIN;\n\n${sectionsFor([`server/migrations/${selectedMigration}`]).join('\n\n')}\n\nCOMMIT;\n`
  : ''

// Check only local RPC definitions. Live tables, columns, grants and schema-cache
// availability belong to audit-schema-rpcs.mjs and cannot be inferred from SQL.
function auditRuntimeDependencies() {
  const serverDirectory = path.join(projectDirectory, 'server')
  const schemaSql = fs.readFileSync(path.join(serverDirectory, 'schema.sql'), 'utf8')
  const provisionedSql = `${schemaSql}\n${migrationSql}`

  const sourceFiles = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(entryPath)
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) sourceFiles.push(entryPath)
    }
  }
  walk(serverDirectory)

  const calledRpcs = new Set()
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\.rpc\(\s*'([a-z_0-9]+)'/g)) calledRpcs.add(match[1])
  }

  const missing = [...calledRpcs]
    .filter((name) => !new RegExp(`FUNCTION\\s+${name}\\s*\\(`, 'i').test(provisionedSql))
    .sort()

  return { calledRpcs: calledRpcs.size, missing }
}

const audit = auditRuntimeDependencies()

if (audit.missing.length) {
  console.error('STATIC runtime RPC source check FAILED.')
  console.error(`These RPCs are called by server code but defined nowhere in schema.sql or the migration bundle:`)
  for (const name of audit.missing) console.error(`  - ${name}`)
  console.error('Add the missing migration before deploying.')
  process.exit(1)
}

// Export one selected, transaction-wrapped migration for independent review.
if (outPath) {
  fs.writeFileSync(outPath, selectedSql, 'utf8')
  console.log(`Wrote selected migration ${selectedMigration} to ${outPath}`)
  console.log(`SQL bytes: ${Buffer.byteLength(selectedSql, 'utf8')}`)
  process.exit(0)
}

if (!applying) {
  console.log('STATIC migration source check passed (no database connection).')
  console.log(`Files: ${migrationFiles.length}`)
  for (const file of migrationFiles) console.log(`  ${path.basename(file)}`)
  console.log(`SQL bytes: ${Buffer.byteLength(migrationSql, 'utf8')}`)
  console.log(`Runtime RPC source check: ${audit.calledRpcs} called, all defined locally.`)
  console.log('This does not prove that the live schema, grants or schema cache match.')
  console.log('Live readonly check: node scripts/audit-schema-rpcs.mjs')
  console.log('Review/apply only a selected migration with --migration <filename.sql> --out <file> / --apply.')
  console.log('A brand-new database needs server/schema.sql applied once first.')
  process.exit(0)
}

const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim()
const explicitProjectRef = String(process.env.SUPABASE_PROJECT_REF || '').trim()
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim()
const inferredProjectRef = /^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i.exec(supabaseUrl)?.[1] || ''
const projectRef = explicitProjectRef || inferredProjectRef

if (!accessToken) {
  throw new Error('SUPABASE_ACCESS_TOKEN is required. Create a Supabase personal access token with database:write access.')
}
if (!projectRef) {
  throw new Error('SUPABASE_PROJECT_REF is required when it cannot be inferred from SUPABASE_URL.')
}

const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: selectedSql, read_only: false }),
  signal: AbortSignal.timeout(60_000),
})

if (!response.ok) {
  // Provider messages can contain SQL or credentials; never echo their body.
  throw new Error(`Supabase migration failed (HTTP ${response.status}).`)
}

console.log(`Applied selected migration ${selectedMigration}. Run the live readonly audit next.`)
