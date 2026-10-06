import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shellFile = path.join(root, 'deploy/systemd/deploy-release.sh')
const shellSource = fs.readFileSync(shellFile, 'utf8')
const powershellSource = fs.readFileSync(path.join(root, 'deploy.ps1'), 'utf8')
const windows = process.platform === 'win32'
const bash = windows ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const powershell = windows ? 'pwsh.exe' : 'pwsh'
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
const posix = (value) => value.replaceAll('\\', '/')

test('release helper passes Bash syntax validation', () => {
  const result = spawnSync(bash, ['-n', shellFile], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('release helper exposes the protocol without touching app or env files', () => {
  const result = spawnSync(bash, [shellFile, '--protocol-version'], { encoding: 'utf8', env: { ...process.env, APP_ROOT: '/does-not-exist', ENV_FILE: '/does-not-exist' } })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'easytran-release-v2')
  assert.match(shellSource, /^node "\$RELEASE_DIR\/scripts\/audit-schema-rpcs\.mjs" --env "\$ENV_FILE"/m)
})

// Isolated filesystem and service/command doubles exercise the actual shell
// control flow without running npm, SSH, systemd or changing a real symlink.
for (const scenario of ['success', 'readiness', 'smoke', 'restart', 'preflight', 'typecheck', 'first-install', 'rollback-unready']) {
  test(`release helper ${scenario} preserves the previous target and exit status`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'easytran-deploy-test-'))
    try {
      const appRoot = posix(path.join(directory, 'app-root'))
      const previous = `${appRoot}/releases/previous`
      fs.mkdirSync(previous, { recursive: true })
      // Previous can be much older than other historical candidate directories.
      fs.utimesSync(previous, new Date('2000-01-01'), new Date('2000-01-01'))
      for (let index = 0; index < 3; index += 1) fs.mkdirSync(`${appRoot}/releases/history-${index}`)
      const app = `${appRoot}/app`
      if (scenario !== 'first-install') fs.writeFileSync(app, previous)
      const archive = posix(path.join(directory, 'release.tar.gz'))
      fs.writeFileSync(archive, 'fixture')
      const harness = `#!/usr/bin/env bash
set -euo pipefail
export APP_ROOT=${quote(appRoot)}
export READY_ATTEMPTS=1 READY_INTERVAL=0
SCENARIO=${quote(scenario)}
PREVIOUS=${quote(previous)}
LOG=${quote(posix(path.join(directory, 'calls.log')))}
# Model symlinks as files, so this also works without Windows symlink privileges.
function [() {
  if test "$#" -eq 3 && test "$1" = '-L'; then test -f "$2"
  elif test "$#" -eq 4 && test "$1" = '!' && test "$2" = '-L'; then ! test -f "$3"
  else builtin [ "$@"; fi
}
readlink() { cat "\${@: -1}"; }
ln() { printf '%s' "$2" > "$3"; }
install() { mkdir -p "\${@: -1}"; }
chown() { return 0; }
tar() { return 0; }
sudo() { shift 2; "$@"; }
npm() { if test "$SCENARIO" = typecheck && test "\${@: -1}" = typecheck:server; then return 17; fi; return 0; }
systemctl() {
  printf '%s\\n' "$*" >> "$LOG"
  if test "$SCENARIO" = restart && test "$1" = restart && test "$(cat "$APP_ROOT/app")" != "$PREVIOUS"; then return 18; fi
}
node() {
  printf 'node %s\\n' "$*" >> "$LOG"
  if test "$1" != --input-type=module; then
    if test "$SCENARIO" = preflight && test "\${1##*/}" = audit-schema-rpcs.mjs; then return 19; fi
    return 0
  fi
  local script active
  script="$(cat)"; active="$(cat "$APP_ROOT/app")"
  if test "$SCENARIO" = rollback-unready; then return 22; fi
  if test "$active" = "$PREVIOUS"; then return 0; fi
  if test "$SCENARIO" = readiness || test "$SCENARIO" = first-install; then return 20; fi
  if test "$SCENARIO" = smoke && [[ "$script" == *'/api/health'* ]]; then return 21; fi
  return 0
}
source ${quote(posix(shellFile))} ${quote(archive)}
`
      const harnessFile = path.join(directory, 'harness.sh')
      fs.writeFileSync(harnessFile, harness)
      const result = spawnSync(bash, [harnessFile], { encoding: 'utf8', timeout: 15000 })
      assert.equal(result.error, undefined, result.error?.message)
      if (scenario === 'success') {
        assert.equal(result.status, 0, result.stderr)
        assert.notEqual(fs.readFileSync(app, 'utf8'), previous)
        assert.equal(fs.existsSync(archive), false)
        assert.match(result.stdout, /readiness and smoke passed/)
        assert.equal(fs.readdirSync(`${appRoot}/releases`).length, 3)
      } else {
        assert.notEqual(result.status, 0, result.stdout)
        assert.doesNotMatch(result.stdout, /readiness and smoke passed/)
        assert.equal(fs.existsSync(archive), true)
        if (scenario === 'first-install') {
          assert.equal(fs.existsSync(app), false)
          assert.match(fs.readFileSync(path.join(directory, 'calls.log'), 'utf8'), /stop easytran-api/)
        } else {
          assert.equal(fs.readFileSync(app, 'utf8'), previous)
          if (scenario === 'rollback-unready') assert.match(result.stderr, /rollback readiness\/smoke failed. Manual recovery required/)
          else if (!['preflight', 'typecheck'].includes(scenario)) assert.match(result.stderr, /Previous release restored and verified/)
        }
      }
      assert.equal(fs.existsSync(previous), true)
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })
}

const runNodeInput = (source, args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--input-type=module', '-', ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('close', (status) => resolve({ status, stderr }))
  child.stdin.end(source)
})

test('actual release HTTP probes reject false readiness, missing assets and broken authentication', async () => {
  const readySource = shellSource.match(/wait_ready\(\)[\s\S]*?<<'NODE'\n([\s\S]*?)\nNODE/)[1]
  const smokeSource = shellSource.match(/smoke\(\)[\s\S]*?<<'NODE'\n([\s\S]*?)\nNODE/)[1]
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'easytran-smoke-test-'))
  fs.mkdirSync(path.join(directory, 'dist'))
  const html = '<div id="root"></div><script type="module" src="/assets/index.js"></script>'
  fs.writeFileSync(path.join(directory, 'dist/index.html'), html)
  let scenario = 'success'
  const server = createServer((request, response) => {
    const sendJson = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)) }
    if (request.url === '/api/ready') return sendJson(scenario === '503' ? 503 : 200, { ok: scenario === 'false' ? false : scenario === 'string' ? 'true' : true })
    if (request.url === '/api/health') return sendJson(200, { ok: true })
    if (request.url === '/v1/transcripts') return sendJson(scenario === 'auth' ? 200 : 401, { error: 'missing_api_key' })
    if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end(html) }
    response.writeHead(scenario === 'asset' ? 404 : 200, { 'Content-Type': scenario === 'html-asset' ? 'text/html' : 'text/javascript' })
    response.end('console.log("fixture")')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    for (scenario of ['success', 'false', 'string', '503']) {
      const result = await runNodeInput(readySource, [base])
      assert.equal(result.status === 0, scenario === 'success', scenario)
    }
    for (scenario of ['success', 'auth', 'asset', 'html-asset']) {
      const result = await runNodeInput(smokeSource, [base, directory])
      assert.equal(result.status === 0, scenario === 'success', scenario)
    }
    fs.writeFileSync(path.join(directory, 'dist/index.html'), '<script src="/assets/other-release.js"></script>')
    scenario = 'success'
    assert.notEqual((await runNodeInput(smokeSource, [base, directory])).status, 0)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('PowerShell native failures and readiness timeouts throw instead of returning success', { skip: !windows }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'easytran-powershell-test-'))
  try {
    const protocolGate = powershellSource.match(/  \$helperProtocol =[\s\S]*?(?=\n  if \(-not \$SkipChecks\))/)[0]
    const harness = `
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${posix(path.join(root, 'deploy.ps1')).replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'PowerShell parse failed.' }
$functions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
foreach ($function in $functions) { Invoke-Expression $function.Extent.Text }
$exe = (Get-Process -Id $PID).Path
Invoke-NativeCommand $exe @('-NoProfile', '-Command', 'exit 0')
$failed = $false
try { Invoke-NativeCommand $exe @('-NoProfile', '-Command', 'exit 7') } catch { $failed = $_.Exception.Message -match 'exit code 7' }
if (-not $failed) { throw 'Failed native command was accepted.' }
$Api = 'http://fixture.invalid'
function Invoke-RestMethod { return @{ ok = $true } }
Wait-Ready 1
function Invoke-RestMethod { return @{ ok = 'true' } }
$failed = $false
try { Wait-Ready 1 } catch { $failed = $_.Exception.Message -match 'did not report ready' }
if (-not $failed) { throw 'Readiness timeout was accepted.' }
$Ssh = 'fixture'
function Invoke-NativeCommand { return 'easytran-release-v1' }
$failed = $false
try {
${protocolGate}
} catch { $failed = $_.Exception.Message -match 'helper is outdated' }
if (-not $failed) { throw 'Outdated helper protocol was accepted.' }
function Invoke-NativeCommand { return 'easytran-release-v2' }
${protocolGate}
Write-Output 'PASS: native failure and readiness timeout; outdated helper refused'
`
    const harnessFile = path.join(directory, 'test.ps1')
    fs.writeFileSync(harnessFile, harness)
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', harnessFile], { encoding: 'utf8', timeout: 15000 })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /PASS: native failure and readiness timeout/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
