import 'server-only'
import { randomBytes } from 'crypto'
import { neon } from '@neondatabase/serverless'

export type Hospital = {
  id: string
  name: string
  short: string
  rate: number
  color: string
  pay: 'weekly' | 'biweekly' | 'monthly' | 'per-shift'
  enabled?: boolean
}

export type HourOption =
  | number
  | { label: string; hours: number; oc?: boolean; start?: string; end?: string }

export type ShiftEntry = {
  hosp: string
  h: number
  label?: string
  oc?: boolean
  /** Mark that the day has a "no late shift" constraint — afternoon appointment, evening event, etc. */
  noLate?: boolean
  /** Free-text reason for the No Late constraint, e.g. "concert at 8pm". */
  noLateLabel?: string
  ocOverlay?: { hosp: string; h: number; label?: string }
}

export type Schedule = Record<string, ShiftEntry>

export type ScheduleSettings = {
  showHFH: boolean
  showGR: boolean
  showTraining: boolean
  showIncome: boolean
  weekStart: 'mon' | 'sun'
  theme: 'system' | 'light' | 'dark'
  hospitals: Hospital[]
  hourOptions: HourOption[]
  annualGoal: number
  /** Manually entered "I've earned this much YTD" baseline. */
  earnedYTD: number
  /** Hours per week a comparable full-time W2 would work. Used for the
   * "weeks off vs W2" stat. Default 36. */
  w2WeeklyHours: number
}

export const DEFAULT_SETTINGS: ScheduleSettings = {
  showHFH: true,
  showGR: true,
  showTraining: false,
  showIncome: true,
  weekStart: 'mon',
  theme: 'system',
  hospitals: [
    { id: 'HFH', name: 'Henry Ford', short: 'HFH', rate: 233, color: '#7c3aed', pay: 'biweekly', enabled: true },
    { id: 'GR', name: 'Garden Park', short: 'GR', rate: 250, color: '#0891b2', pay: 'monthly', enabled: true },
  ],
  hourOptions: [
    8,
    10,
    12,
    16,
    24,
    { label: 'OC A', hours: 12, oc: true, start: '07:00', end: '19:00' },
    { label: 'OC P', hours: 12, oc: true, start: '19:00', end: '07:00' },
  ],
  annualGoal: 285000,
  earnedYTD: 0,
  w2WeeklyHours: 36,
}

let cachedSql: ReturnType<typeof neon> | null = null
function getSql() {
  if (cachedSql) return cachedSql
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL env var is required')
  cachedSql = neon(url)
  return cachedSql
}

let schemaPromise: Promise<void> | null = null
function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql()
      await sql`
        CREATE TABLE IF NOT EXISTS schedule_entries (
          date date PRIMARY KEY,
          data jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS schedule_settings (
          id integer PRIMARY KEY DEFAULT 1,
          data jsonb NOT NULL DEFAULT '{}'::jsonb,
          ical_token text,
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT schedule_settings_singleton CHECK (id = 1)
        )
      `
    })().catch((err) => {
      schemaPromise = null
      throw err
    })
  }
  return schemaPromise
}

export async function loadSchedule(): Promise<Schedule> {
  await ensureSchema()
  const rows = (await getSql()`
    SELECT to_char(date, 'YYYY-MM-DD') AS date, data FROM schedule_entries
  `) as { date: string; data: ShiftEntry }[]
  const out: Schedule = {}
  for (const r of rows) out[r.date] = r.data
  return out
}

export async function loadSettings(): Promise<ScheduleSettings> {
  await ensureSchema()
  const rows = (await getSql()`
    SELECT data FROM schedule_settings WHERE id = 1
  `) as { data: Partial<ScheduleSettings> }[]
  const stored = rows[0]?.data ?? {}
  return { ...DEFAULT_SETTINGS, ...stored } as ScheduleSettings
}

export async function saveSettings(settings: ScheduleSettings): Promise<void> {
  await ensureSchema()
  await getSql()`
    INSERT INTO schedule_settings (id, data, updated_at)
    VALUES (1, ${JSON.stringify(settings)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE
      SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
  `
}

export async function syncEntries(
  upserts: Array<{ date: string; data: ShiftEntry }>,
  deletes: string[],
): Promise<void> {
  await ensureSchema()
  const sql = getSql()
  for (const u of upserts) {
    await sql`
      INSERT INTO schedule_entries (date, data, updated_at)
      VALUES (${u.date}::date, ${JSON.stringify(u.data)}::jsonb, now())
      ON CONFLICT (date) DO UPDATE
        SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
    `
  }
  if (deletes.length > 0) {
    await sql`DELETE FROM schedule_entries WHERE date::text = ANY(${deletes})`
  }
}

export async function clearMonthEntries(year: number, month: number): Promise<void> {
  await ensureSchema()
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const endY = month === 11 ? year + 1 : year
  const endM = month === 11 ? 1 : month + 2
  const end = `${endY}-${String(endM).padStart(2, '0')}-01`
  await getSql()`
    DELETE FROM schedule_entries
    WHERE date >= ${start}::date AND date < ${end}::date
      AND NOT (data->>'hosp' = 'OFF')
  `
}

export async function getOrCreateIcalToken(): Promise<string> {
  await ensureSchema()
  const sql = getSql()
  const rows = (await sql`SELECT ical_token FROM schedule_settings WHERE id = 1`) as { ical_token: string | null }[]
  const existing = rows[0]?.ical_token
  if (existing) return existing
  const token = randomBytes(24).toString('hex')
  await sql`
    INSERT INTO schedule_settings (id, ical_token)
    VALUES (1, ${token})
    ON CONFLICT (id) DO UPDATE SET ical_token = EXCLUDED.ical_token
    WHERE schedule_settings.ical_token IS NULL
  `
  const recheck = (await sql`SELECT ical_token FROM schedule_settings WHERE id = 1`) as { ical_token: string }[]
  return recheck[0].ical_token
}

export async function findScheduleByToken(token: string): Promise<Schedule | null> {
  await ensureSchema()
  const sql = getSql()
  const rows = (await sql`SELECT 1 AS ok FROM schedule_settings WHERE id = 1 AND ical_token = ${token}`) as { ok: number }[]
  if (rows.length === 0) return null
  return loadSchedule()
}

export async function findHospitalsByToken(token: string): Promise<Hospital[] | null> {
  await ensureSchema()
  const sql = getSql()
  const rows = (await sql`SELECT data FROM schedule_settings WHERE id = 1 AND ical_token = ${token}`) as { data: Partial<ScheduleSettings> }[]
  if (rows.length === 0) return null
  const merged = { ...DEFAULT_SETTINGS, ...rows[0].data } as ScheduleSettings
  return merged.hospitals
}
