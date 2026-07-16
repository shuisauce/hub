import type { Hospital, Schedule, ShiftEntry } from '@/lib/schedule-db'

export type PaycheckShift = {
  date: string
  /** Which part of the day's entry this row is — the main shift or the OC
   *  overlay riding on it. Needed to write actual hours back to the right spot. */
  source: 'primary' | 'overlay'
  /** Hours used for pay: actual clocked hours when recorded, planned otherwise. */
  hours: number
  plannedHours: number
  hasActual: boolean
  amount: number
  label?: string | null
  oc?: boolean
}

export type Paycheck = {
  payDate: string          // YYYY-MM-DD (predicted)
  hospitalId: string
  periodStart: string      // YYYY-MM-DD (for per-shift, same as the shift date)
  periodEnd: string        // YYYY-MM-DD — stable key for receipts
  amount: number
  shifts: PaycheckShift[]
}

// ---------- Date helpers (mirror the ones in client.tsx to avoid circular imports) ----------

function parseKey(k: string): { y: number; m: number; d: number } {
  const [y, m, d] = k.split('-').map(Number)
  return { y, m: m - 1, d }
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function addDays(key: string, days: number): string {
  const p = parseKey(key)
  const d = new Date(p.y, p.m, p.d)
  d.setDate(d.getDate() + days)
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate())
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

// ---------- Effective hours ----------

function effectiveHours(planned: number, actual: number | null | undefined): number {
  return typeof actual === 'number' ? actual : planned
}

// ---------- Period math ----------

/** Period-end at integer offset `n` from the anchor (n may be negative).
 *  Computed directly from the anchor — never iteratively — so monthly
 *  end-of-month clamping can't drift (anchor Mar 31 at n=-2 is Jan 31,
 *  not Jan 28). */
function periodEndAt(hospital: Hospital, n: number): string {
  const anchor = hospital.payAnchor!
  if (hospital.pay === 'weekly') return addDays(anchor, n * 7)
  if (hospital.pay === 'biweekly') return addDays(anchor, n * 14)
  // monthly
  const p = parseKey(anchor)
  const total = p.m + n
  const y = p.y + Math.floor(total / 12)
  const m = ((total % 12) + 12) % 12
  return dateKey(y, m, Math.min(p.d, daysInMonth(y, m)))
}

/** Given a period-end for a hospital, the period-start (day after the previous
 *  period-end). */
function periodStartFor(hospital: Hospital, periodEnd: string): string {
  if (hospital.pay === 'weekly') return addDays(periodEnd, -6)
  if (hospital.pay === 'biweekly') return addDays(periodEnd, -13)
  if (hospital.pay === 'monthly') {
    const p = parseKey(periodEnd)
    // Previous period ends on the anchor day of the prior month (clamped);
    // start is the day after. Deriving from this periodEnd's own day keeps
    // it consistent with periodEndAt's clamping.
    const prevM = p.m - 1
    const y = p.y + Math.floor(prevM / 12)
    const m = ((prevM % 12) + 12) % 12
    const prevEnd = dateKey(y, m, Math.min(p.d, daysInMonth(y, m)))
    return addDays(prevEnd, 1)
  }
  return periodEnd // per-shift or unknown
}

/** All period-ends for `hospital` whose predicted pay date lands in
 *  [from, horizon]. Walks backward and forward from the anchor as needed. */
function periodEndsInWindow(hospital: Hospital, from: string, horizon: string): string[] {
  if (!hospital.payAnchor) return []
  const lag = hospital.payLagDays ?? 0
  // Find the smallest offset whose pay date is >= from.
  let n = 0
  let guard = 0
  while (addDays(periodEndAt(hospital, n), lag) >= from && guard < 2000) { n--; guard++ }
  while (addDays(periodEndAt(hospital, n), lag) < from && guard < 4000) { n++; guard++ }
  const out: string[] = []
  guard = 0
  while (guard < 500) {
    const end = periodEndAt(hospital, n)
    const payDate = addDays(end, lag)
    if (payDate > horizon) break
    out.push(end)
    n++
    guard++
  }
  return out
}

// ---------- Shift collection ----------

/** Rows for everything in the schedule belonging to `hospId` on `date`. */
function shiftRowsFor(hospId: string, rate: number, date: string, s: ShiftEntry): PaycheckShift[] {
  const rows: PaycheckShift[] = []
  if (s.hosp === hospId && s.h > 0) {
    const hours = effectiveHours(s.h, s.actualH)
    rows.push({
      date,
      source: 'primary',
      hours,
      plannedHours: s.h,
      hasActual: typeof s.actualH === 'number',
      amount: rate * hours,
      label: s.label,
      oc: !!s.oc,
    })
  }
  if (s.ocOverlay && s.ocOverlay.hosp === hospId && s.ocOverlay.h > 0) {
    const hours = effectiveHours(s.ocOverlay.h, s.ocOverlay.actualH)
    rows.push({
      date,
      source: 'overlay',
      hours,
      plannedHours: s.ocOverlay.h,
      hasActual: typeof s.ocOverlay.actualH === 'number',
      amount: rate * hours,
      label: s.ocOverlay.label,
      oc: true,
    })
  }
  return rows
}

// ---------- Main API ----------

/** All paychecks whose predicted pay date lands in [from, horizon], from every
 *  hospital with a pay-anchor configured (or per-shift, which pays per worked
 *  day). Sorted by pay date ascending. Amounts use actual clocked hours when
 *  recorded, planned hours otherwise. */
export function computePaychecks(
  schedule: Schedule,
  hospitals: Hospital[],
  from: string,
  horizon: string,
): Paycheck[] {
  const result: Paycheck[] = []

  for (const h of hospitals) {
    if (h.enabled === false) continue

    if (h.pay === 'per-shift') {
      const lag = h.payLagDays ?? 0
      // One check per worked day (primary + overlay on the same day merge).
      for (const k of Object.keys(schedule)) {
        const s = schedule[k]
        if (!s || s.hosp === 'OFF' || s.hosp === 'NL') continue
        const payDate = addDays(k, lag)
        if (payDate < from || payDate > horizon) continue
        const shifts = shiftRowsFor(h.id, h.rate ?? 0, k, s)
        if (shifts.length === 0) continue
        result.push({
          payDate,
          hospitalId: h.id,
          periodStart: k,
          periodEnd: k,
          amount: shifts.reduce((sum, r) => sum + r.amount, 0),
          shifts,
        })
      }
      continue
    }

    if (!h.payAnchor) continue // can't project without an anchor

    const lag = h.payLagDays ?? 0
    for (const periodEnd of periodEndsInWindow(h, from, horizon)) {
      const periodStart = periodStartFor(h, periodEnd)
      const shifts: PaycheckShift[] = []
      for (const k of Object.keys(schedule)) {
        if (k < periodStart || k > periodEnd) continue
        const s = schedule[k]
        if (!s || s.hosp === 'OFF' || s.hosp === 'NL') continue
        shifts.push(...shiftRowsFor(h.id, h.rate ?? 0, k, s))
      }
      shifts.sort((a, b) => a.date.localeCompare(b.date))
      // Emit even zero-amount checks so the pay-date cadence stays visible;
      // the UI deemphasizes $0 rows.
      result.push({
        payDate: addDays(periodEnd, lag),
        hospitalId: h.id,
        periodStart,
        periodEnd,
        amount: shifts.reduce((sum, r) => sum + r.amount, 0),
        shifts,
      })
    }
  }

  result.sort((a, b) => a.payDate.localeCompare(b.payDate) || a.hospitalId.localeCompare(b.hospitalId))
  return result
}
