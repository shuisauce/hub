import type { Hospital, Schedule, ShiftEntry } from '@/lib/schedule-db'

export type PaycheckShift = {
  date: string
  hours: number
  amount: number
  label?: string | null
  oc?: boolean
}

export type Paycheck = {
  payDate: string          // YYYY-MM-DD
  hospitalId: string
  periodStart: string      // YYYY-MM-DD (for per-shift, same as the shift date)
  periodEnd: string        // YYYY-MM-DD
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

// Add one calendar month to a period-end date, clamping day to end-of-month
// when needed. E.g. Jan 31 + 1mo = Feb 28/29.
function addMonth(key: string): string {
  const p = parseKey(key)
  const targetMonth = p.m + 1
  const targetY = p.y + Math.floor(targetMonth / 12)
  const targetM = ((targetMonth % 12) + 12) % 12
  const clampedDay = Math.min(p.d, daysInMonth(targetY, targetM))
  return dateKey(targetY, targetM, clampedDay)
}

function subMonth(key: string): string {
  const p = parseKey(key)
  const targetMonth = p.m - 1
  const targetY = p.y + Math.floor(targetMonth / 12)
  const targetM = ((targetMonth % 12) + 12) % 12
  const clampedDay = Math.min(p.d, daysInMonth(targetY, targetM))
  return dateKey(targetY, targetM, clampedDay)
}

// ---------- Shift amount (kept local so this file has no client deps) ----------

function shiftAmount(s: ShiftEntry, hospitals: Record<string, Hospital>): number {
  if (!s || s.hosp === 'OFF' || s.hosp === 'NL') return 0
  const hosp = hospitals[s.hosp]
  const primary = (hosp?.rate ?? 0) * (s.h ?? 0)
  const ov = s.ocOverlay
  const ovRate = ov ? hospitals[ov.hosp]?.rate ?? 0 : 0
  const overlay = ov ? ovRate * (ov.h ?? 0) : 0
  return primary + overlay
}

// ---------- Period-end walker ----------

/** All period-end dates for `hospital` (excluding per-shift) that could produce
 *  a paycheck landing in [today, horizon]. Walks forward from the anchor. */
function* periodEnds(hospital: Hospital, today: string, horizon: string): Generator<string> {
  const anchor = hospital.payAnchor
  if (!anchor) return
  const lag = hospital.payLagDays ?? 0
  // Move forward past history until pay date >= today. This handles the case
  // where the anchor is in the past — walk in period-length steps.
  let end = anchor
  // Safety cap: don't loop forever if config is nonsensical (e.g. horizon before anchor).
  let iter = 0
  const step: (k: string) => string =
    hospital.pay === 'weekly'  ? (k) => addDays(k, 7) :
    hospital.pay === 'biweekly' ? (k) => addDays(k, 14) :
    hospital.pay === 'monthly'  ? addMonth :
    (k) => k // shouldn't happen — per-shift filtered out at call site

  // Advance to first pay-date >= today
  while (iter < 5000) {
    const payDate = addDays(end, lag)
    if (payDate >= today) break
    end = step(end)
    iter++
  }
  // Emit until horizon
  iter = 0
  while (iter < 500) {
    const payDate = addDays(end, lag)
    if (payDate > horizon) return
    yield end
    end = step(end)
    iter++
  }
}

/** Given a period-end for a hospital, return the period-start (day after the
 *  previous period-end). */
function periodStartFor(hospital: Hospital, periodEnd: string): string {
  if (hospital.pay === 'weekly') return addDays(periodEnd, -6)
  if (hospital.pay === 'biweekly') return addDays(periodEnd, -13)
  if (hospital.pay === 'monthly') {
    const prev = subMonth(periodEnd)
    return addDays(prev, 1)
  }
  return periodEnd // per-shift or unknown
}

// ---------- Main API ----------

/** All upcoming paychecks (pay date >= `today`) through `horizon`, from every
 *  hospital that has a pay-anchor configured (or `per-shift`, which uses shift
 *  dates directly). Sorted by pay date ascending. */
export function upcomingPaychecks(
  schedule: Schedule,
  hospitals: Hospital[],
  today: string,
  horizon: string,
): Paycheck[] {
  const byId: Record<string, Hospital> = {}
  for (const h of hospitals) byId[h.id] = h

  const result: Paycheck[] = []

  for (const h of hospitals) {
    if (h.enabled === false) continue

    if (h.pay === 'per-shift') {
      const lag = h.payLagDays ?? 0
      // Each worked shift becomes its own check
      for (const k of Object.keys(schedule)) {
        const s = schedule[k]
        if (!s) continue
        // Primary
        if (s.hosp === h.id && s.h > 0) {
          const payDate = addDays(k, lag)
          if (payDate < today || payDate > horizon) continue
          const amt = (h.rate ?? 0) * s.h
          result.push({
            payDate,
            hospitalId: h.id,
            periodStart: k,
            periodEnd: k,
            amount: amt,
            shifts: [{ date: k, hours: s.h, amount: amt, label: s.label, oc: !!s.oc }],
          })
        }
        // OC overlay at this hospital
        if (s.ocOverlay && s.ocOverlay.hosp === h.id && s.ocOverlay.h > 0) {
          const payDate = addDays(k, lag)
          if (payDate < today || payDate > horizon) continue
          const amt = (h.rate ?? 0) * s.ocOverlay.h
          result.push({
            payDate,
            hospitalId: h.id,
            periodStart: k,
            periodEnd: k,
            amount: amt,
            shifts: [{ date: k, hours: s.ocOverlay.h, amount: amt, label: s.ocOverlay.label, oc: true }],
          })
        }
      }
      continue
    }

    if (!h.payAnchor) continue // can't project without an anchor

    const lag = h.payLagDays ?? 0
    for (const periodEnd of periodEnds(h, today, horizon)) {
      const periodStart = periodStartFor(h, periodEnd)
      const shifts: PaycheckShift[] = []
      let amount = 0

      // Walk schedule for anything in this window belonging to this hospital
      for (const k of Object.keys(schedule)) {
        if (k < periodStart || k > periodEnd) continue
        const s = schedule[k]
        if (!s) continue

        if (s.hosp === h.id && s.h > 0) {
          const amt = (h.rate ?? 0) * s.h
          amount += amt
          shifts.push({ date: k, hours: s.h, amount: amt, label: s.label, oc: !!s.oc })
        }
        if (s.ocOverlay && s.ocOverlay.hosp === h.id && s.ocOverlay.h > 0) {
          const amt = (h.rate ?? 0) * s.ocOverlay.h
          amount += amt
          shifts.push({ date: k, hours: s.ocOverlay.h, amount: amt, label: s.ocOverlay.label, oc: true })
        }
      }

      // Emit even zero-amount checks so the user sees the schedule of pay dates.
      // The UI can visually deemphasize $0 rows.
      shifts.sort((a, b) => a.date.localeCompare(b.date))
      result.push({
        payDate: addDays(periodEnd, lag),
        hospitalId: h.id,
        periodStart,
        periodEnd,
        amount,
        shifts,
      })
    }
  }

  result.sort((a, b) => a.payDate.localeCompare(b.payDate) || a.hospitalId.localeCompare(b.hospitalId))
  return result
}
