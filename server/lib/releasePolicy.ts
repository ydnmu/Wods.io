export function getReleasePolicy(env: Record<string, string | undefined> = process.env) {
  return { paidWorkspacesEnabled: env.PAID_WORKSPACES_ENABLED === 'true' }
}
