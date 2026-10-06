import dotenv from 'dotenv'

dotenv.config({ quiet: true })

// Production secrets are injected by systemd through
// /etc/easytran/easytran-api.env. Never let a bundled development file replace
// those values after the process has started.
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: 'server/.env', override: true, quiet: true })
}
