'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Hospital, PaycheckReceipt } from '@/lib/schedule-db'
import type { Paycheck, PaycheckShift } from '@/lib/paychecks'
import { saveTimeCardAction, saveReceiptAction, clearReceiptAction } from './actions'

const fmtMoney = (n: number) =>
  '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const fmtMoneyShort = (n: number) =>
  n >= 1000 ? '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : '$' + Math.round(n)

function formatDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatPeriod(start: string, end: string): string {
  if (start === end) return formatDay(start)
  return `${formatDay(start)} – ${formatDay(end)}`
}

// Short period label for collapsed rows: "May 3–16" or "May 31 – Jun 13".
function compactPeriod(start: string, end: string): string {
  const [, m1, d1] = start.split('-').map(Number)
  const [, m2, d2] = end.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (start === end) return `${months[m1 - 1]} ${d1}`
  if (m1 === m2) return `${months[m1 - 1]} ${d1}–${d2}`
  return `${months[m1 - 1]} ${d1} – ${months[m2 - 1]} ${d2}`
}

function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((new Date(y1, m1 - 1, d1).getTime() - new Date(y2, m2 - 1, d2).getTime()) / 86_400_000)
}

const receiptKey = (hosp: string, periodEnd: string) => `${hosp}|${periodEnd}`

// ---------- Timing / accuracy summaries ----------

function timingLabel(receivedOn: string, payDate: string): { text: string; ok: boolean } {
  const diff = daysBetween(receivedOn, payDate)
  if (diff === 0) return { text: 'on time', ok: true }
  const dayWord = Math.abs(diff) === 1 ? 'day' : 'days'
  return diff < 0
    ? { text: `${Math.abs(diff)} ${dayWord} early`, ok: true }
    : { text: `${diff} ${dayWord} late`, ok: false }
}

function accuracyLabel(received: number, expected: number): { text: string; ok: boolean } {
  const delta = received - expected
  if (Math.abs(delta) < 1) return { text: 'amount matches', ok: true }
  return delta < 0
    ? { text: `short ${fmtMoney(Math.abs(delta))}`, ok: false }
    : { text: `over by ${fmtMoney(delta)}`, ok: false }
}

// ---------- Time card (save feature #1) ----------

const rowKey = (s: PaycheckShift) => `${s.date}|${s.source}`
const savedStr = (s: PaycheckShift) => (s.hasActual ? String(s.hours) : '')

function TimeCard({ p, hosp }: { p: Paycheck; hosp: Hospital | undefined }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(p.shifts.filter((s) => !s.oc).map((s) => [rowKey(s), savedStr(s)])),
  )

  const rate = hosp?.rate ?? 0

  // Walk the rows once: validate drafts, detect unsaved edits, and build the
  // live preliminary total (time-card hours where entered, planned otherwise).
  let invalid = false
  let dirty = false
  let preliminary = 0
  for (const s of p.shifts) {
    if (s.oc) { preliminary += s.amount; continue }
    const raw = (draft[rowKey(s)] ?? savedStr(s)).trim()
    const num = raw === '' ? null : Number(raw)
    if (num !== null && (!Number.isFinite(num) || num < 0)) { invalid = true; continue }
    const savedNum = s.hasActual ? s.hours : null
    if ((num === null) !== (savedNum === null) || (num !== null && savedNum !== null && Math.abs(num - savedNum) > 0.001)) {
      dirty = true
    }
    preliminary += rate * (num ?? s.plannedHours)
  }

  function save() {
    const entries = p.shifts
      .filter((s) => !s.oc)
      .map((s) => {
        const raw = (draft[rowKey(s)] ?? savedStr(s)).trim()
        return { date: s.date, target: s.source, actualH: raw === '' ? null : Number(raw) }
      })
    startTransition(async () => {
      await saveTimeCardAction(entries)
      router.refresh()
    })
  }

  return (
    <div className="pc-timecard">
      {p.shifts.length === 0 ? (
        <div className="pc-noshift">No shifts in this period.</div>
      ) : (
        <>
          <table className="pc-shifts">
            <thead>
              <tr>
                <th>Date</th>
                <th>Planned</th>
                <th>Time card</th>
                <th>Note</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {p.shifts.map((s) => {
                const k = rowKey(s)
                const raw = s.oc ? '' : (draft[k] ?? savedStr(s))
                const num = raw.trim() === '' ? null : Number(raw)
                const rowAmount = s.oc
                  ? s.amount
                  : Number.isFinite(num ?? 0) ? rate * ((num ?? s.plannedHours)) : NaN
                return (
                  <tr key={k}>
                    <td>{formatDay(s.date)}</td>
                    <td>{s.plannedHours}h</td>
                    <td>
                      {s.oc ? (
                        <span
                          className="pc-flat"
                          title="OC pays a flat retainer. Got called in? Add a regular shift on that day for the worked hours."
                        >
                          flat
                        </span>
                      ) : (
                        <input
                          className="pc-actual-input"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.25}
                          value={raw}
                          placeholder={String(s.plannedHours)}
                          title="Hours actually worked per your time card — blank uses the planned hours"
                          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        />
                      )}
                    </td>
                    <td>{s.label ?? ''}{s.oc ? ' · OC' : ''}</td>
                    <td className="right mono">{Number.isNaN(rowAmount) ? '—' : fmtMoney(rowAmount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="pc-timecard-foot">
            <span className="pc-prelim">
              Preliminary total:{' '}
              <b className="mono">{invalid ? '—' : fmtMoney(preliminary)}</b>
              {dirty && !invalid && <em className="pc-unsaved"> · unsaved</em>}
            </span>
            <button
              type="button"
              className="pc-btn primary"
              onClick={save}
              disabled={pending || !dirty || invalid}
            >
              {pending ? 'Saving…' : 'Save time card'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ---------- Bank record (save feature #2) ----------

function ReceiptForm({
  hosp, periodEnd, payDate, expected, receipt,
}: {
  hosp: string
  periodEnd: string
  payDate: string
  expected: number
  receipt: PaycheckReceipt | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [receivedOn, setReceivedOn] = useState(receipt?.received_on ?? '')
  const [amount, setAmount] = useState(receipt?.amount_received != null ? String(receipt.amount_received) : '')

  const dirty =
    receivedOn !== (receipt?.received_on ?? '') ||
    amount !== (receipt?.amount_received != null ? String(receipt.amount_received) : '')

  function save() {
    const amt = amount.trim() === '' ? null : Number(amount)
    if (amt !== null && !Number.isFinite(amt)) return
    startTransition(async () => {
      await saveReceiptAction({
        hosp,
        periodEnd,
        receivedOn: receivedOn || null,
        amountReceived: amt,
      })
      router.refresh()
    })
  }

  function clear() {
    if (!window.confirm('Clear this bank record?')) return
    startTransition(async () => {
      await clearReceiptAction(hosp, periodEnd)
      setReceivedOn('')
      setAmount('')
      router.refresh()
    })
  }

  const timing = receipt?.received_on ? timingLabel(receipt.received_on, payDate) : null
  const accuracy = receipt?.amount_received != null ? accuracyLabel(receipt.amount_received, expected) : null

  return (
    <div className="pc-receipt">
      <div className="pc-receipt-title">Bank</div>
      <div className="pc-expected">
        Expected from time card: <b className="mono">{fmtMoney(expected)}</b>
      </div>
      <div className="pc-receipt-grid">
        <label>
          <span>Money hit on</span>
          <input
            type="date"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
          />
        </label>
        <label>
          <span>Amount received ($)</span>
          <input
            type="number"
            inputMode="decimal"
            step={0.01}
            min={0}
            placeholder={expected > 0 ? expected.toFixed(2) : '0'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <div className="pc-receipt-actions">
          <button type="button" className="pc-btn primary" onClick={save} disabled={pending || !dirty}>
            {pending ? 'Saving…' : 'Save bank record'}
          </button>
          {receipt && (
            <button type="button" className="pc-btn" onClick={clear} disabled={pending}>
              Clear
            </button>
          )}
        </div>
      </div>
      {(timing || accuracy) && (
        <div className="pc-receipt-badges">
          {timing && <span className={'pc-badge ' + (timing.ok ? 'ok' : 'bad')}>{timing.text}</span>}
          {accuracy && <span className={'pc-badge ' + (accuracy.ok ? 'ok' : 'bad')}>{accuracy.text}</span>}
        </div>
      )}
    </div>
  )
}

// ---------- Check row ----------

function CheckRow({
  p, hosp, today, receipt, defaultOpen,
}: {
  p: Paycheck
  hosp: Hospital | undefined
  today: string
  receipt: PaycheckReceipt | null
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const days = daysBetween(p.payDate, today)
  const daysLabel =
    days === 0 ? 'today' :
    days === 1 ? 'tomorrow' :
    days === -1 ? 'yesterday' :
    days > 0 ? `in ${days} days` :
    `${Math.abs(days)} days ago`

  const timing = receipt?.received_on ? timingLabel(receipt.received_on, p.payDate) : null
  const accuracy = receipt?.amount_received != null ? accuracyLabel(receipt.amount_received, p.amount) : null
  const needsVerify = !receipt && p.payDate < today && p.amount > 0

  return (
    <li className={'paycheck-row' + (p.amount === 0 ? ' zero' : '')}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="paycheck-head" aria-expanded={open}>
        <span className="pc-date">
          <span className="pc-day">{formatDay(p.payDate)}</span>
          <span className="pc-when">{daysLabel}</span>
        </span>
        <span className="pc-hosp">
          <span className="dot" style={{ background: hosp?.color ?? '#888' }} />
          <span className="short">{hosp?.short ?? p.hospitalId}</span>
          <span className="pc-per">for {compactPeriod(p.periodStart, p.periodEnd)}</span>
        </span>
        <span className="pc-flags">
          {receipt && <span className={'pc-badge ' + ((timing?.ok ?? true) && (accuracy?.ok ?? true) ? 'ok' : 'bad')}>
            {accuracy && !accuracy.ok ? accuracy.text : timing && !timing.ok ? timing.text : '✓ received'}
          </span>}
          {needsVerify && <span className="pc-badge warn">verify</span>}
        </span>
        <span className="pc-amount mono">{p.amount === 0 ? '—' : fmtMoneyShort(p.amount)}</span>
        <span className="pc-chev" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="paycheck-detail">
          <div className="pc-period">Period: {formatPeriod(p.periodStart, p.periodEnd)}</div>
          <TimeCard p={p} hosp={hosp} />
          <ReceiptForm
            hosp={p.hospitalId}
            periodEnd={p.periodEnd}
            payDate={p.payDate}
            expected={p.amount}
            receipt={receipt}
          />
        </div>
      )}
    </li>
  )
}

// ---------- Page body ----------

export function PaychecksClient({
  paychecks,
  receipts,
  hospitals,
  today,
  horizon,
}: {
  paychecks: Paycheck[]
  receipts: PaycheckReceipt[]
  hospitals: Hospital[]
  today: string
  horizon: string
}) {
  const hospLookup = useMemo(() => {
    const out: Record<string, Hospital> = {}
    for (const h of hospitals) out[h.id] = h
    return out
  }, [hospitals])

  const receiptLookup = useMemo(() => {
    const out: Record<string, PaycheckReceipt> = {}
    for (const r of receipts) out[receiptKey(r.hosp, r.period_end)] = r
    return out
  }, [receipts])

  const missing = hospitals.filter((h) => h.enabled !== false && h.pay !== 'per-shift' && !h.payAnchor)

  const toVerify = paychecks.filter(
    (p) => !receiptLookup[receiptKey(p.hospitalId, p.periodEnd)] && p.payDate < today && p.amount > 0,
  )
  const upcoming = paychecks.filter(
    (p) => !receiptLookup[receiptKey(p.hospitalId, p.periodEnd)] && p.payDate >= today,
  )
  // Calendar order, same as the other sections — reconciling against a bank
  // statement reads top-to-bottom through the year.
  const received = paychecks.filter((p) => receiptLookup[receiptKey(p.hospitalId, p.periodEnd)])

  const upcomingTotal = upcoming.reduce((s, p) => s + p.amount, 0)
  const receivedTotal = received.reduce((s, p) => {
    const r = receiptLookup[receiptKey(p.hospitalId, p.periodEnd)]
    return s + (r.amount_received ?? p.amount)
  }, 0)

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
          <div className="lbl">Upcoming through {formatDay(horizon)}</div>
          <div className="val mono">{fmtMoney(Math.round(upcomingTotal))}</div>
        </div>
        <div>
          <div className="lbl">To verify</div>
          <div className={'val mono' + (toVerify.length > 0 ? ' attention' : '')}>{toVerify.length}</div>
        </div>
        <div>
          <div className="lbl">Received</div>
          <div className="val mono">{fmtMoney(Math.round(receivedTotal))}</div>
        </div>
      </div>

      {toVerify.length > 0 && (
        <section>
          <h2 className="pc-section-title warn">To verify — pay date passed, nothing recorded</h2>
          <ul className="paycheck-list">
            {toVerify.map((p, i) => (
              <CheckRow
                key={p.hospitalId + p.periodEnd}
                p={p}
                hosp={hospLookup[p.hospitalId]}
                today={today}
                receipt={null}
                defaultOpen={i === 0}
              />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="pc-section-title">Upcoming</h2>
        {upcoming.length === 0 ? (
          <div className="paycheck-empty">
            No upcoming checks. Either you have no shifts scheduled between now and {formatDay(horizon)},
            or none of your hospitals have a pay-period anchor set.
          </div>
        ) : (
          <ul className="paycheck-list">
            {upcoming.map((p) => (
              <CheckRow
                key={p.hospitalId + p.periodEnd}
                p={p}
                hosp={hospLookup[p.hospitalId]}
                today={today}
                receipt={null}
              />
            ))}
          </ul>
        )}
      </section>

      {received.length > 0 && (
        <section>
          <h2 className="pc-section-title">Received</h2>
          <ul className="paycheck-list">
            {received.map((p) => (
              <CheckRow
                key={p.hospitalId + p.periodEnd}
                p={p}
                hosp={hospLookup[p.hospitalId]}
                today={today}
                receipt={receiptLookup[receiptKey(p.hospitalId, p.periodEnd)]}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
