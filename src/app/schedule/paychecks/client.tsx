'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Hospital } from '@/lib/schedule-db'
import type { Paycheck } from '@/lib/paychecks'

const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString()
const fmtMoneyShort = (n: number) =>
  n >= 1000 ? '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : '$' + Math.round(n)

function formatPayDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatPeriod(start: string, end: string): string {
  if (start === end) return formatPayDate(start)
  return `${formatPayDate(start)} – ${formatPayDate(end)}`
}

function daysFromToday(key: string, today: string): number {
  const [y1, m1, d1] = key.split('-').map(Number)
  const [y2, m2, d2] = today.split('-').map(Number)
  const a = new Date(y1, m1 - 1, d1).getTime()
  const b = new Date(y2, m2 - 1, d2).getTime()
  return Math.round((a - b) / 86_400_000)
}

export function PaychecksClient({
  paychecks,
  hospitals,
  today,
  horizon,
}: {
  paychecks: Paycheck[]
  hospitals: Hospital[]
  today: string
  horizon: string
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const hospLookup = useMemo(() => {
    const out: Record<string, Hospital> = {}
    for (const h of hospitals) out[h.id] = h
    return out
  }, [hospitals])

  const totalAll = paychecks.reduce((s, p) => s + p.amount, 0)
  const nonZeroCount = paychecks.filter((p) => p.amount > 0).length

  // Hospitals that have no anchor configured — surface at the top so the user
  // knows why some checks might be missing.
  const missing = hospitals.filter((h) => h.enabled !== false && h.pay !== 'per-shift' && !h.payAnchor)

  function toggle(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div className="paychecks">
      {missing.length > 0 && (
        <div className="paycheck-warning">
          <strong>Set up pay schedules to see all checks:</strong>{' '}
          {missing.map((h) => h.short).join(', ')} {missing.length === 1 ? "doesn't" : "don't"} have a pay-period anchor yet.
          Open <Link href="/schedule" style={{ color: 'inherit', textDecoration: 'underline' }}>Schedule</Link>,
          click the gear icon, edit each hospital, and set the last period-end date + days-to-check.
        </div>
      )}

      <div className="paycheck-summary">
        <div>
          <div className="lbl">Through {formatPayDate(horizon)}</div>
          <div className="val mono">{fmtMoney(totalAll)}</div>
        </div>
        <div>
          <div className="lbl">Checks</div>
          <div className="val mono">{nonZeroCount}</div>
        </div>
      </div>

      {paychecks.length === 0 ? (
        <div className="paycheck-empty">
          No upcoming checks. Either you have no shifts scheduled between now and {formatPayDate(horizon)},
          or none of your hospitals have a pay-period anchor set.
        </div>
      ) : (
        <ul className="paycheck-list">
          {paychecks.map((p, i) => {
            const hosp = hospLookup[p.hospitalId]
            const isExpanded = expanded.has(i)
            const days = daysFromToday(p.payDate, today)
            const daysLabel =
              days === 0 ? 'today' :
              days === 1 ? 'tomorrow' :
              `in ${days} days`
            return (
              <li
                key={p.payDate + p.hospitalId + i}
                className={'paycheck-row' + (p.amount === 0 ? ' zero' : '')}
              >
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className="paycheck-head"
                  aria-expanded={isExpanded}
                >
                  <span className="pc-date">
                    <span className="pc-day">{formatPayDate(p.payDate)}</span>
                    <span className="pc-when">{daysLabel}</span>
                  </span>
                  <span className="pc-hosp">
                    <span className="dot" style={{ background: hosp?.color ?? '#888' }} />
                    <span className="short">{hosp?.short ?? p.hospitalId}</span>
                  </span>
                  <span className="pc-amount mono">
                    {p.amount === 0 ? '—' : fmtMoneyShort(p.amount)}
                  </span>
                  <span className="pc-chev" aria-hidden>{isExpanded ? '▾' : '▸'}</span>
                </button>
                {isExpanded && (
                  <div className="paycheck-detail">
                    <div className="pc-period">
                      Period: {formatPeriod(p.periodStart, p.periodEnd)}
                    </div>
                    {p.shifts.length === 0 ? (
                      <div className="pc-noshift">No shifts in this period.</div>
                    ) : (
                      <table className="pc-shifts">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Hours</th>
                            <th>Note</th>
                            <th className="right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.shifts.map((s, si) => (
                            <tr key={si}>
                              <td>{formatPayDate(s.date)}</td>
                              <td>{s.hours}</td>
                              <td>{s.label ?? ''}{s.oc ? ' · OC' : ''}</td>
                              <td className="right mono">{fmtMoney(s.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
