export function resolveTrustProxyHops(value: string | undefined, nodeEnv: string | undefined) {
  const fallback = nodeEnv === 'production' ? 1 : 0
  if (!value?.trim()) return fallback

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10 ? parsed : fallback
}

export function resolveRateLimit(value: string | undefined, fallback: number) {
  if (!value?.trim()) return fallback

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100_000 ? parsed : fallback
}
