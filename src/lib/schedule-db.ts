import 'server-only'
import { randomBytes } from 'crypto'
import { neon } from '@neondatabase/serverless'

export type Hospital = {
  id: string
  name: string
  short: string
  rate: number
  /** $/hr paid for on-call hours (both OC-flagged primary shifts and OC
   *  overlays). E.g. HFH pays $120 per 12h OC block = 10. Default 0 —
   *  on-call time is unpaid unless configured. */
  ocRate?: number
  color: string
  pay: 'weekly' | 'biweekly' | 'monthly' | 'per-shift'
  enabled?: boolean
  /** YYYY-MM-DD. A known period-end date. Combined with `pay` cadence, this
   *  drives auto-generation of every future pay period. Ignored for `per-shift`
   *  hospitals (each shift is its own "period"). Null/undefined = paycheck
   *  view can't project this hospital yet. */
  payAnchor?: string | null
  /** Days from period end to the actual pay date. E.g. period ends Sat, check
   *  hits the following Fri = 6. For `per-shift`, days between shift date and
   *  pay date. Default 0. */
  payLagDays?: number
}

export type HourOption =
  | number
  | { label: string; hours: number; oc?: boolean; start?: string; end?: string }

/** Workflow state for a shift / OFF / NL entry:
 *  - planned:  on your calendar, not yet sent to your scheduler (default) — 🔴
 *  - sent:     given to the scheduler, not yet approved — 🟡
 *  - approved: scheduler said yes, not yet on the official schedule — 🟢
 *  - posted:   confirmed on the official schedule — 🔵
 */
export type ShiftStatus = 'planned' | 'sent' | 'approved' | 'posted'

export type ShiftEntry = {
  hosp: string
  h: number
  /** Actual clocked hours (fractional, e.g. 8.25). When set, overrides `h`
   *  for all pay math — paychecks, YTD, projections. Planned `h` stays for
   *  the calendar display and scheduler exports.
   *
   *  OC entries don't use this: an OC block pays a flat retainer
   *  (ocRate × block hours, e.g. $10 × 12 = $120). Getting called in is
   *  recorded by adding a regular shift for the worked hours on that day —
   *  it pays the normal rate alongside the OC retainer. */
  actualH?: number | null
  label?: string
  oc?: boolean
  /** Mark that the day has a "no late shift" constraint — afternoon appointment, evening event, etc. */
  noLate?: boolean
  /** Free-text reason for the No Late constraint, e.g. "concert at 8pm". */
  noLateLabel?: string
  /** Approval/posting workflow state. Absent or 'planned' = default. */
  status?: ShiftStatus
  ocOverlay?: { hosp: string; h: number; label?: string; actualH?: number | null }
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
  /** Manually entered "I've earned this much" baseline as of `ytdAsOf`. */
  earnedYTD: number
  /** Manually entered "I've worked this many paid hours" baseline as of `ytdAsOf`. */
  hoursYTD: number
  /** YYYY-MM-DD. The baseline (earnedYTD + hoursYTD) reflects work done
   *  through this date. Anything scheduled AFTER this date on the calendar
   *  adds on top — so past shifts you've already worked and future shifts
   *  both contribute. `null` means treat the baseline as "as of today,"
   *  i.e. no past shifts count (legacy default). */
  ytdAsOf: string | null
  /** Hours per week a comparable full-time W2 would work. Used for the
   * "weeks off vs W2" stat. Default 36. */
  w2WeeklyHours: number
  /** Hourly rate to assume for offered-off shifts. Used by the "Day off check"
   * dashboard card. Default 190 (typical 8h shift rate). */
  dayOffRate: number
  /** When false (default), the calendar archives months prior to the current
   * one so it always opens to "today and forward." Toggle on to scroll back. */
  showPastMonths: boolean
}

export const DEFAULT_SETTINGS: ScheduleSettings = {
  showHFH: true,
  showGR: true,
  showTraining: false,
  showIncome: true,
  weekStart: 'mon',
  theme: 'system',
  hospitals: [
    { id: 'HFH', name: 'Henry Ford', short: 'HFH', rate: 233, ocRate: 10, color: '#7c3aed', pay: 'biweekly', enabled: true },
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
  hoursYTD: 0,
  ytdAsOf: null,
  w2WeeklyHours: 36,
  dayOffRate: 190,
  showPastMonths: false,
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
      await sql`
        CREATE TABLE IF NOT EXISTS paycheck_receipts (
          hosp text NOT NULL,
          period_end date NOT NULL,
          received_on date,
          amount_received double precision,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (hosp, period_end)
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

// ---------- Paycheck receipts ----------

export type PaycheckReceipt = {
  hosp: string
  /** YYYY-MM-DD — the period-end of the predicted check this receipt verifies.
   *  Stable key even when the actual pay date drifts early/late. */
  period_end: string
  /** YYYY-MM-DD the money actually hit the account, or null if only amount recorded. */
  received_on: string | null
  amount_received: number | null
}

export async function listPaycheckReceipts(): Promise<PaycheckReceipt[]> {
  await ensureSchema()
  const rows = (await getSql()`
    SELECT hosp,
           to_char(period_end, 'YYYY-MM-DD') AS period_end,
           to_char(received_on, 'YYYY-MM-DD') AS received_on,
           amount_received
    FROM paycheck_receipts
  `) as PaycheckReceipt[]
  return rows
}

export async function savePaycheckReceipt(input: {
  hosp: string
  periodEnd: string
  receivedOn: string | null
  amountReceived: number | null
}): Promise<void> {
  await ensureSchema()
  await getSql()`
    INSERT INTO paycheck_receipts (hosp, period_end, received_on, amount_received, updated_at)
    VALUES (${input.hosp}, ${input.periodEnd}::date, ${input.receivedOn}::date, ${input.amountReceived}, now())
    ON CONFLICT (hosp, period_end) DO UPDATE
      SET received_on = EXCLUDED.received_on,
          amount_received = EXCLUDED.amount_received,
          updated_at = EXCLUDED.updated_at
  `
}

export async function deletePaycheckReceipt(hosp: string, periodEnd: string): Promise<void> {
  await ensureSchema()
  await getSql()`
    DELETE FROM paycheck_receipts WHERE hosp = ${hosp} AND period_end = ${periodEnd}::date
  `
}

/** Set (or clear, with null) the actual clocked hours on one day's entry.
 *  `target` picks the primary shift or the OC overlay riding on it. */
export async function setActualHours(
  date: string,
  target: 'primary' | 'overlay',
  actualH: number | null,
): Promise<void> {
  await ensureSchema()
  const sql = getSql()
  const rows = (await sql`
    SELECT data FROM schedule_entries WHERE date = ${date}::date
  `) as { data: ShiftEntry }[]
  const entry = rows[0]?.data
  if (!entry) return
  const obj = target === 'primary' ? entry : entry.ocOverlay
  if (!obj) return
  if (actualH == null) delete obj.actualH
  else obj.actualH = actualH
  await sql`
    UPDATE schedule_entries
    SET data = ${JSON.stringify(entry)}::jsonb, updated_at = now()
    WHERE date = ${date}::date
  `
}
