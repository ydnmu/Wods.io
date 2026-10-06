import './env'

type KeyState = {
  value: string
  busy: boolean
  cooldownUntil: number
  lastUsedAt: number
}

export type OpenRouterKeyLease = {
  key: string
  release: (cooldownMs?: number) => void
}

export function parseOpenRouterKeys(value?: string) {
  return [...new Set(
    String(value || '')
      .split(/[\r\n,;]+/)
      .map((key) => key.trim())
      .filter(Boolean),
  )]
}

export function createOpenRouterKeyPool(keys: string[]) {
  const states: KeyState[] = keys.map((value) => ({
    value,
    busy: false,
    cooldownUntil: 0,
    lastUsedAt: 0,
  }))

  return {
    get size() {
      return states.length
    },

    snapshot(now = Date.now()) {
      return {
        configured: states.length,
        available: states.filter((state) => !state.busy && state.cooldownUntil <= now).length,
        busy: states.filter((state) => state.busy).length,
        coolingDown: states.filter((state) => !state.busy && state.cooldownUntil > now).length,
      }
    },

    acquire(now = Date.now()): OpenRouterKeyLease | null {
      const state = states
        .filter((candidate) => !candidate.busy && candidate.cooldownUntil <= now)
        .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0]

      if (!state) return null
      state.busy = true
      state.lastUsedAt = now
      let released = false

      return {
        key: state.value,
        release(cooldownMs = 0) {
          if (released) return
          released = true
          state.busy = false
          state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + Math.max(0, cooldownMs))
        },
      }
    },
  }
}

const numberedOpenRouterKeys = Array.from(
  { length: 5 },
  (_, index) => process.env[`OPENROUTER_API_KEY_${index + 1}`],
)

const configuredKeys = parseOpenRouterKeys([
  process.env.OPENROUTER_API_KEYS,
  process.env.OPENROUTER_API_KEY,
  ...numberedOpenRouterKeys,
].filter(Boolean).join(','))

export const openRouterKeyPool = createOpenRouterKeyPool(configuredKeys)
