import dns from 'node:dns/promises'
import net from 'node:net'

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '')
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || a >= 224
  }
  if (net.isIPv6(normalized)) {
    return normalized === '::' || normalized === '::1' ||
      normalized.startsWith('fc') || normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized)
  }
  return true
}

export async function validateWebhookUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false
  if (net.isIP(hostname)) return !isPrivateAddress(hostname)

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true })
    return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address))
  } catch {
    return false
  }
}
