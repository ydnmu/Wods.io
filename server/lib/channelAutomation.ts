export type ChannelScheduleFrequency = 'every_15_minutes' | 'hourly' | 'daily'

export type ChannelAutomationSettings = {
  schedule_frequency: ChannelScheduleFrequency
  schedule_time: string
  timezone: string
  auto_summary: boolean
  ai_fallback: boolean
  backfill_limit: number
  paused: boolean
}

const frequencies = new Set<ChannelScheduleFrequency>(['every_15_minutes', 'hourly', 'daily'])

const validTimezone = (value: unknown) => {
  const timezone = String(value || 'UTC').slice(0, 80)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    return timezone
  } catch {
    return 'UTC'
  }
}

const validTime = (value: unknown) => {
  const time = String(value || '09:00').slice(0, 5)
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '09:00'
}

const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback

export function normalizeChannelAutomationSettings(
  input: Record<string, unknown> = {},
  current: Partial<ChannelAutomationSettings> = {},
): ChannelAutomationSettings {
  const requestedFrequency = String(input.schedule_frequency ?? current.schedule_frequency ?? 'daily') as ChannelScheduleFrequency
  const backfill = Number(input.backfill_limit ?? current.backfill_limit ?? 0)
  return {
    schedule_frequency: frequencies.has(requestedFrequency) ? requestedFrequency : 'daily',
    schedule_time: validTime(input.schedule_time ?? current.schedule_time),
    timezone: validTimezone(input.timezone ?? current.timezone),
    auto_summary: bool(input.auto_summary, current.auto_summary ?? true),
    ai_fallback: bool(input.ai_fallback, current.ai_fallback ?? true),
    backfill_limit: Number.isFinite(backfill) ? Math.max(0, Math.min(1000, Math.floor(backfill))) : 0,
    paused: bool(input.paused, current.paused ?? false),
  }
}

const zonedHourMinute = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return {
    hour: Number(parts.find((part) => part.type === 'hour')?.value || 0),
    minute: Number(parts.find((part) => part.type === 'minute')?.value || 0),
  }
}

export function nextChannelRunAt(
  frequency: ChannelScheduleFrequency,
  scheduleTime: string,
  timezone: string,
  from = new Date(),
) {
  if (frequency === 'every_15_minutes') return new Date(from.getTime() + 15 * 60_000).toISOString()
  if (frequency === 'hourly') return new Date(from.getTime() + 60 * 60_000).toISOString()

  const [targetHour, targetMinute] = validTime(scheduleTime).split(':').map(Number)
  const normalizedTimezone = validTimezone(timezone)
  const start = new Date(from)
  start.setUTCSeconds(0, 0)
  start.setUTCMinutes(start.getUTCMinutes() + 1)

  for (let minuteOffset = 0; minuteOffset <= 26 * 60; minuteOffset += 1) {
    const candidate = new Date(start.getTime() + minuteOffset * 60_000)
    const local = zonedHourMinute(candidate, normalizedTimezone)
    if (local.hour === targetHour && local.minute === targetMinute) return candidate.toISOString()
  }

  return new Date(from.getTime() + 24 * 60 * 60_000).toISOString()
}
