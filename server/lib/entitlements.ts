export type EntitlementUser = {
  plan?: string | null
  access_source?: string | null
  beta_expires_at?: string | null
}

export function isBetaExpired(user: EntitlementUser, now = Date.now()) {
  return user.access_source === 'beta' && Boolean(user.beta_expires_at) && new Date(user.beta_expires_at || 0).getTime() <= now
}

export function effectivePlan(user: EntitlementUser, now = Date.now()) {
  return isBetaExpired(user, now) ? 'free' : user.plan || 'free'
}
