'use client'

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import Link from 'next/link'
import {
  type Hospital,
  type HourOption,
  type Schedule,
  type ScheduleSettings,
  type ShiftEntry,
  type ShiftStatus,
} from '@/lib/schedule-db'
import {
  clearMonthAction,
  saveSettingsAction,
  syncEntriesAction,
} from './actions'

// ---------- helpers ----------

const hoKey = (o: HourOption) => (typeof o === 'object' ? o.label : String(o))
const hoHours = (o: HourOption) => (typeof o === 'object' ? o.hours : o)
const hoOncall = (o: HourOption) => typeof o === 'object' && !!o.oc

const computeRangeHours = (start: string, end: string) => {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = eh * 60 + em - (sh * 60 + sm)
  if (mins <= 0) mins += 24 * 60
  return Math.round((mins / 60) * 4) / 4
}
const fmtTimeAmPm = (t: string) => {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'P' : 'A'
  const h12 = (h % 12) || 12
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}
const rangeLabel = (s: string, e: string) => `${fmtTimeAmPm(s)}-${fmtTimeAmPm(e)}`

const SHIFT_TIMES: Record<number, [string, string]> = {
  8: ['07:00', '15:00'],
  10: ['07:00', '17:00'],
  12: ['06:30', '18:30'],
  16: ['06:30', '22:30'],
  24: ['07:00', '07:00 (+1)'],
}

const dateKey = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const parseKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number)
  return { y, m: m - 1, d }
}
const monthDays = (y: number, m: number) => new Date(y, m + 1, 0).getDate()

const isOffShift = (s?: ShiftEntry) => !!s && s.hosp === 'OFF'
const isOncallShift = (s?: ShiftEntry) => !!s && !!s.oc
const isNoLateOnly = (s?: ShiftEntry) => !!s && s.hosp === 'NL'
const isUncountedShift = (s?: ShiftEntry) =>
  isOffShift(s) || isOncallShift(s) || isNoLateOnly(s)

const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString()
const fmtMoneyShort = (n: number) =>
  n >= 1000 ? '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : '$' + Math.round(n)

const monthName = (m: number) =>
  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m]
const monthShort = (m: number) =>
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]

function todayKey() {
  const d = new Date()
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate())
}

// Find the contiguous stretch of OFF days that includes `key`. Returns date
// keys in chronological order — used to label a whole vacation week with one
// reason in one click.
function findOffStretch(schedule: Schedule, key: string): string[] {
  if (schedule[key]?.hosp !== 'OFF') return [key]
  const out: string[] = [key]
  const step = (k: string, dir: 1 | -1) => {
    const p = parseKey(k)
    const d = new Date(p.y, p.m, p.d + dir)
    return dateKey(d.getFullYear(), d.getMonth(), d.getDate())
  }
  let cursor = step(key, -1)
  while (schedule[cursor]?.hosp === 'OFF') {
    out.unshift(cursor)
    cursor = step(cursor, -1)
  }
  cursor = step(key, 1)
  while (schedule[cursor]?.hosp === 'OFF') {
    out.push(cursor)
    cursor = step(cursor, 1)
  }
  return out
}

// Last date the user can schedule (one calendar year from today, inclusive).
function maxScheduleKey() {
  const t = new Date()
  const d = new Date(t.getFullYear() + 1, t.getMonth(), t.getDate())
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate())
}

// 12 months ahead, plus optionally 3 months of history. ISO date strings sort
// lexically, so `cellKey > maxScheduleKey()` cleanly disables cells past the limit.
function visibleMonths(showPast: boolean): { y: number; m: number }[] {
  const today = new Date()
  const start = showPast ? -3 : 0
  const out: { y: number; m: number }[] = []
  for (let i = start; i <= 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1)
    out.push({ y: d.getFullYear(), m: d.getMonth() })
  }
  return out
}

// Hospitals lookup helper
function makeHospLookup(hospitals: Hospital[]): Record<string, Hospital> {
  const out: Record<string, Hospital> = {
    OFF: { id: 'OFF', name: 'Off', short: 'OFF', rate: 0, color: '#f59e0b', pay: 'biweekly' },
    NL: { id: 'NL', name: 'No Late', short: 'NL', rate: 0, color: '#4338ca', pay: 'biweekly' },
  }
  for (const h of hospitals) out[h.id] = h
  return out
}

function shiftAmount(s: ShiftEntry | undefined, lookup: Record<string, Hospital>): number {
  if (!s || isUncountedShift(s)) return 0
  const h = lookup[s.hosp]
  if (!h) return 0
  return h.rate * s.h
}

function monthStats(schedule: Schedule, y: number, m: number, lookup: Record<string, Hospital>) {
  let shifts = 0
  let hours = 0
  let gross = 0
  for (const k in schedule) {
    const p = parseKey(k)
    if (p.y === y && p.m === m && !isUncountedShift(schedule[k])) {
      shifts++
      hours += schedule[k].h
      gross += shiftAmount(schedule[k], lookup)
    }
  }
  return { shifts, hours, gross }
}

function ytdStats(schedule: Schedule, throughKey: string, lookup: Record<string, Hospital>) {
  let gross = 0
  let shifts = 0
  let hours = 0
  const t = parseKey(throughKey)
  for (const k in schedule) {
    const p = parseKey(k)
    if (
      p.y === t.y &&
      (p.m < t.m || (p.m === t.m && p.d <= t.d)) &&
      !isUncountedShift(schedule[k])
    ) {
      gross += shiftAmount(schedule[k], lookup)
      shifts++
      hours += schedule[k].h
    }
  }
  return { gross, shifts, hours }
}

function yearScheduledStats(schedule: Schedule, y: number, lookup: Record<string, Hospital>) {
  let gross = 0
  for (const k in schedule) {
    const p = parseKey(k)
    if (p.y === y) gross += shiftAmount(schedule[k], lookup)
  }
  return { gross }
}

function expectedPace(throughKey: string, goal: number) {
  const t = parseKey(throughKey)
  const start = new Date(t.y, 0, 1).getTime()
  const end = new Date(t.y, 11, 31).getTime()
  const now = new Date(t.y, t.m, t.d).getTime()
  const frac = (now - start) / (end - start)
  return goal * frac
}

// Per-future-shift cumulative pace: { cum: total earned by this shift's date, expected: pace target on that date }
type PaceInfo = { cum: number; expected: number; status: 'ahead' | 'behind' }
function buildPaceMap(
  schedule: Schedule,
  lookup: Record<string, Hospital>,
  today: string,
  earnedYTD: number,
  annualGoal: number,
): Map<string, PaceInfo> {
  const map = new Map<string, PaceInfo>()
  const todayP = parseKey(today)
  const currentYear = todayP.y
  const dates = Object.keys(schedule)
    .filter((k) => {
      const p = parseKey(k)
      return p.y === currentYear && k > today && !isUncountedShift(schedule[k])
    })
    .sort()

  let cum = earnedYTD
  for (const date of dates) {
    cum += shiftAmount(schedule[date], lookup)
    const p = parseKey(date)
    const start = new Date(p.y, 0, 1).getTime()
    const end = new Date(p.y, 11, 31).getTime()
    const here = new Date(p.y, p.m, p.d).getTime()
    const expected = annualGoal * ((here - start) / (end - start))
    map.set(date, { cum, expected, status: cum >= expected ? 'ahead' : 'behind' })
  }
  return map
}

// ---------- Status helpers ----------

const STATUS_LABELS: Record<ShiftStatus, string> = {
  planned: 'Planned · not sent',
  sent: 'Sent · not yet approved',
  approved: 'Approved · not yet posted',
  posted: 'Posted on official schedule',
}

const STATUS_EMOJI: Record<ShiftStatus, string> = {
  planned: '🔴',
  sent: '🟡',
  approved: '🟢',
  posted: '🔵',
}

const STATUSES: ShiftStatus[] = ['planned', 'sent', 'approved', 'posted']

function normalizeStatus(raw: unknown): ShiftStatus {
  if (raw === 'sent' || raw === 'approved' || raw === 'posted') return raw
  return 'planned'
}

// Past dates are automatically considered posted, regardless of stored status.
// (Once a shift's date is yesterday or earlier, it either happened or didn't —
// the saved approval state is no longer meaningful.)
function effectiveStatus(raw: unknown, dateKey: string, today: string): ShiftStatus {
  if (dateKey < today) return 'posted'
  return normalizeStatus(raw)
}

function renderStatusMark(status: ShiftStatus): ReactElement {
  return (
    <span className="status-mark" title={STATUS_LABELS[status]}>
      {STATUS_EMOJI[status]}
    </span>
  )
}

function StatusSelector({
  value, onChange,
}: {
  value: ShiftStatus
  onChange: (next: ShiftStatus) => void
}) {
  return (
    <div className="popup-row">
      <span className="label">Status</span>
      <div className="chip-group" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <button
            key={s}
            className={'chip' + (value === s ? ' active' : '')}
            onClick={() => onChange(s)}
            title={STATUS_LABELS[s]}
          >
            {STATUS_EMOJI[s]} {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- Exports (CSV + .ics download) ----------

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}

function csvEscape(v: string | number | null | undefined): string {
  const s = String(v == null ? '' : v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

type CsvAudience = 'personal' | 'work'

function exportCSV(schedule: Schedule, settings: ScheduleSettings, audience: CsvAudience = 'personal') {
  if (audience === 'work') return exportWorkCSV(schedule, settings)
  const today = todayKey()
  const lookup = makeHospLookup(settings.hospitals)
  const rows: (string | number)[][] = [
    ['Date', 'Day', 'Type', 'Hospital', 'Hospital ID', 'Hours', 'Label', 'Rate', 'Gross', 'On-call', 'No Late', 'No-Late reason', 'Status'],
  ]
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const emit = (key: string, s: ShiftEntry, isOverlay: boolean, noLate: boolean, noLateLabel: string, status: string) => {
    const p = parseKey(key)
    const dt = new Date(p.y, p.m, p.d)
    const hosp = lookup[s.hosp]
    const isOff = s.hosp === 'OFF'
    const isNL = s.hosp === 'NL'
    const isOc = !!s.oc || isOverlay
    const type = isOff ? 'OFF' : isNL ? 'No Late' : isOc ? 'On-call' : 'Shift'
    const rate = hosp?.rate ?? 0
    const gross = isOff || isNL || isOc ? 0 : rate * (s.h || 0)
    rows.push([
      key,
      dows[dt.getDay()],
      type,
      hosp?.name ?? '',
      s.hosp,
      s.h || 0,
      s.label ?? '',
      rate,
      gross,
      isOc ? 'yes' : '',
      noLate ? 'yes' : '',
      noLateLabel,
      status,
    ])
  }
  Object.keys(schedule).sort().forEach((k) => {
    const s = schedule[k]
    if (!s) return
    const nlLabel = s.hosp === 'NL' ? (s.noLateLabel ?? '') : (s.noLate ? (s.noLateLabel ?? '') : '')
    // OFF and standalone No-Late entries don't carry status; everything else
    // gets "posted" automatically once it's in the past.
    const status =
      s.hosp === 'OFF' || s.hosp === 'NL'
        ? ''
        : effectiveStatus(s.status, k, today)
    emit(k, s, false, !!s.noLate || s.hosp === 'NL', nlLabel, status)
    if (s.ocOverlay) emit(k, { hosp: s.ocOverlay.hosp, h: s.ocOverlay.h, label: s.ocOverlay.label }, true, false, '', status)
  })
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n')
  triggerDownload('schedule-personal-' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv')
}

// Stripped CSV for schedulers — only date + the bare scheduling facts. No
// reasons, OFF labels, rates, or gross are included.
function exportWorkCSV(schedule: Schedule, settings: ScheduleSettings) {
  const lookup = makeHospLookup(settings.hospitals)
  const rows: (string | number)[][] = [
    ['Date', 'Day', 'Hospital', 'Hours', 'On-call', 'No Late', 'OFF'],
  ]
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  Object.keys(schedule).sort().forEach((k) => {
    const s = schedule[k]
    if (!s) return
    const p = parseKey(k)
    const dt = new Date(p.y, p.m, p.d)
    const day = dows[dt.getDay()]
    const hosp = lookup[s.hosp]
    const isOff = s.hosp === 'OFF'
    const isNL = s.hosp === 'NL'
    if (isOff) {
      rows.push([k, day, '', 0, '', '', 'yes'])
      return
    }
    if (isNL) {
      rows.push([k, day, '', 0, '', 'yes', ''])
      return
    }
    rows.push([k, day, hosp?.short ?? s.hosp, s.h || 0, s.oc ? 'yes' : '', s.noLate ? 'yes' : '', ''])
    if (s.ocOverlay) {
      const oh = lookup[s.ocOverlay.hosp]
      rows.push([k, day, oh?.short ?? s.ocOverlay.hosp, s.ocOverlay.h || 0, 'yes', '', ''])
    }
  })
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n')
  triggerDownload('schedule-work-' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function icsDate(y: number, m: number, d: number): string {
  return `${y}${pad2(m + 1)}${pad2(d)}`
}
function icsEscape(s: string | null | undefined): string {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function exportICS(schedule: Schedule, settings: ScheduleSettings) {
  const today = todayKey()
  const lookup = makeHospLookup(settings.hospitals)
  const opts = settings.hourOptions
  const findTpl = (label: string | undefined | null) =>
    label
      ? (opts.find((o) => typeof o === 'object' && o.label === label) as
          | { label: string; hours: number; oc?: boolean; start?: string; end?: string }
          | undefined)
      : undefined

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KMS Anesthesia//Schedule Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:CRNA Schedule',
    'X-WR-TIMEZONE:America/Detroit',
  ]
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

  const emit = (key: string, s: ShiftEntry, suffix: string) => {
    const p = parseKey(key)
    const hosp = lookup[s.hosp]
    const isOff = s.hosp === 'OFF'
    const isNL = s.hosp === 'NL'
    const isOc = !!s.oc || suffix === 'oc'
    const tpl = findTpl(s.label)
    const uid = key + (suffix ? '-' + suffix : '') + '@kms-schedule'
    let summary: string
    let dtStart: string
    let dtEnd: string
    if (isOff) {
      summary = s.label ? `OFF · ${s.label}` : 'OFF'
      dtStart = 'DTSTART;VALUE=DATE:' + icsDate(p.y, p.m, p.d)
      const next = new Date(p.y, p.m, p.d + 1)
      dtEnd = 'DTEND;VALUE=DATE:' + icsDate(next.getFullYear(), next.getMonth(), next.getDate())
    } else if (isNL) {
      summary = s.noLateLabel ? `No Late · ${s.noLateLabel}` : 'No Late'
      dtStart = 'DTSTART;VALUE=DATE:' + icsDate(p.y, p.m, p.d)
      const next = new Date(p.y, p.m, p.d + 1)
      dtEnd = 'DTEND;VALUE=DATE:' + icsDate(next.getFullYear(), next.getMonth(), next.getDate())
    } else {
      const short = hosp?.short ?? hosp?.name ?? s.hosp
      summary =
        short +
        ' · ' +
        (isOc ? 'On-call' + (s.label ? ' (' + s.label + ')' : '') : (s.label || `${s.h}h`))
      let sh = 7
      let sm = 0
      let eh = 7 + (s.h || 0)
      let em = 0
      if (tpl?.start && tpl?.end) {
        const [a0, a1] = tpl.start.split(':').map(Number)
        const [b0, b1] = tpl.end.split(':').map(Number)
        sh = a0; sm = a1 || 0; eh = b0; em = b1 || 0
      }
      const startStr = icsDate(p.y, p.m, p.d) + 'T' + pad2(sh) + pad2(sm) + '00'
      const endDate = new Date(p.y, p.m, p.d, eh, em)
      if (eh * 60 + em <= sh * 60 + sm) endDate.setDate(endDate.getDate() + 1)
      const endStr =
        icsDate(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()) +
        'T' +
        pad2(endDate.getHours()) +
        pad2(endDate.getMinutes()) +
        '00'
      dtStart = 'DTSTART;TZID=America/Detroit:' + startStr
      dtEnd = 'DTEND;TZID=America/Detroit:' + endStr
    }
    // OFF / NL don't carry status; paid shifts auto-promote to "posted" in the past.
    const showStatus = !isOff && !isNL
    const eff = showStatus ? effectiveStatus(s.status, key, today) : 'planned'
    const statusLabel =
      !showStatus || eff === 'planned' ? '' : ` · ${eff.charAt(0).toUpperCase() + eff.slice(1)}`
    const desc = (isOff
      ? (s.label ? `Unavailable — ${s.label}` : 'Unavailable')
      : isNL
        ? "Can't work a late shift"
        : isOc
          ? `${hosp?.name ?? s.hosp} on-call`
          : `${hosp?.name ?? s.hosp} · ${s.h || 0}h · $${(((hosp?.rate ?? 0) * (s.h || 0))).toLocaleString()}${s.noLate ? ' · No Late' : ''}`)
      + statusLabel
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + stamp,
      dtStart,
      dtEnd,
      'SUMMARY:' + icsEscape(summary),
      'DESCRIPTION:' + icsEscape(desc),
      'CATEGORIES:' + (isOff ? 'OFF' : isNL ? 'No-Late' : isOc ? 'On-call' : 'Shift'),
      'END:VEVENT',
    )
  }

  const emitNoLateMarker = (key: string, reason?: string) => {
    const p = parseKey(key)
    const next = new Date(p.y, p.m, p.d + 1)
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + key + '-nolate@kms-schedule',
      'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + icsDate(p.y, p.m, p.d),
      'DTEND;VALUE=DATE:' + icsDate(next.getFullYear(), next.getMonth(), next.getDate()),
      'SUMMARY:' + icsEscape(reason ? `No Late · ${reason}` : 'No Late'),
      'DESCRIPTION:' + icsEscape(reason ? `Can't work a late shift — ${reason}` : "Can't work a late shift"),
      'CATEGORIES:No-Late',
      'END:VEVENT',
    )
  }

  Object.keys(schedule).sort().forEach((k) => {
    const s = schedule[k]
    if (!s) return
    emit(k, s, '')
    if (s.ocOverlay)
      emit(k, { hosp: s.ocOverlay.hosp, h: s.ocOverlay.h, label: s.ocOverlay.label }, 'oc')
    // Add a separate all-day No-Late event if the day has a noLate flag on a real shift.
    if (s.noLate && s.hosp !== 'NL') emitNoLateMarker(k, s.noLateLabel)
  })
  lines.push('END:VCALENDAR')
  triggerDownload(
    'crna-schedule-' + new Date().toISOString().slice(0, 10) + '.ics',
    lines.join('\r\n'),
    'text/calendar',
  )
}

// ---------- Icon ----------

type IconName =
  | 'menu' | 'plus' | 'x' | 'chev-down' | 'chev-left' | 'chev-right'
  | 'brush' | 'calendar' | 'sparkles' | 'trash' | 'sun' | 'today'
  | 'download' | 'warn' | 'settings' | 'archive' | 'refresh' | 'edit' | 'copy'

function Icon({ name, size = 16, stroke = 'currentColor', fill = 'none' }:
  { name: IconName; size?: number; stroke?: string; fill?: string }) {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24', fill, stroke,
    strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'menu': return <svg {...props}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    case 'plus': return <svg {...props}><path d="M12 5v14M5 12h14" /></svg>
    case 'x': return <svg {...props}><path d="M6 6l12 12M18 6L6 18" /></svg>
    case 'chev-down': return <svg {...props}><path d="M6 9l6 6 6-6" /></svg>
    case 'chev-left': return <svg {...props}><path d="M15 6l-6 6 6 6" /></svg>
    case 'chev-right': return <svg {...props}><path d="M9 6l6 6-6 6" /></svg>
    case 'brush': return <svg {...props}><path d="M9.5 14.5L4 20l3 .5L7.5 24l5.5-5.5" /><path d="M14.5 9.5l5-5a2 2 0 012.83 2.83l-5 5" /><path d="M9.5 14.5l5-5 4.5 4.5-5 5z" /></svg>
    case 'calendar': return <svg {...props}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
    case 'sparkles': return <svg {...props}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" /><path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z" /></svg>
    case 'trash': return <svg {...props}><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M5 6l1 14a2 2 0 002 2h8a2 2 0 002-2l1-14" /></svg>
    case 'sun': return <svg {...props}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
    case 'today': return <svg {...props}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" /><circle cx="12" cy="15" r="2" fill={stroke} stroke="none" /></svg>
    case 'download': return <svg {...props}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
    case 'warn': return <svg {...props}><path d="M12 3L2 20h20L12 3z" /><path d="M12 10v5M12 18v.01" /></svg>
    case 'settings': return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1.11-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09a1.7 1.7 0 001.55-1.11 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34H9a1.7 1.7 0 001-1.55V3a2 2 0 114 0v.09a1.7 1.7 0 001 1.55 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87V9a1.7 1.7 0 001.55 1H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.55 1z" /></svg>
    case 'archive': return <svg {...props}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 13h4" /></svg>
    case 'refresh': return <svg {...props}><path d="M3 12a9 9 0 0115-6.7L21 8M21 3v5h-5M21 12a9 9 0 01-15 6.7L3 16M3 21v-5h5" /></svg>
    case 'edit': return <svg {...props}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 113 3L7 19l-4 1 1-4z" /></svg>
    case 'copy': return <svg {...props}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
    default: return null
  }
}

// ---------- Paint state ----------

type PaintState = {
  active: boolean
  hosp: string
  hours: number
  mode: 'add' | 'erase'
  label?: string | null
  oc?: boolean
  /** When hosp === 'STATUS', this is the status that gets stamped onto each
   * existing entry the user paints across. */
  statusValue?: ShiftStatus
}

// ---------- PaceStrip ----------

function PaceStrip({
  schedule, open, onToggle, lookup, annualGoal, earnedYTD,
}: {
  schedule: Schedule
  open: boolean
  onToggle: () => void
  lookup: Record<string, Hospital>
  annualGoal: number
  earnedYTD: number
}) {
  const today = todayKey()
  const expected = expectedPace(today, annualGoal)
  const ty = parseKey(today).y
  const futureScheduled = useMemo(() => {
    let sum = 0
    for (const k in schedule) {
      const p = parseKey(k)
      if (p.y !== ty) continue
      if (k <= today) continue
      sum += shiftAmount(schedule[k], lookup)
    }
    return sum
  }, [schedule, lookup, today, ty])

  const farthestKey = useMemo(() => {
    let last: string | null = null
    for (const k in schedule) {
      const p = parseKey(k)
      if (p.y !== ty) continue
      if (k <= today) continue
      if (isUncountedShift(schedule[k])) continue
      if (!last || k > last) last = k
    }
    return last
  }, [schedule, today, ty])
  const farthestExpected = farthestKey ? expectedPace(farthestKey, annualGoal) : null

  const projected = earnedYTD + futureScheduled
  const delta = earnedYTD - expected
  const earnedPct = Math.min(100, (earnedYTD / annualGoal) * 100)
  const projectedPct = Math.min(100, (projected / annualGoal) * 100)
  const expectedPct = Math.min(100, (expected / annualGoal) * 100)
  const farthestPct = farthestExpected != null ? Math.min(100, (farthestExpected / annualGoal) * 100) : null

  let farthestTitle: string | undefined
  if (farthestKey && farthestExpected != null) {
    const p = parseKey(farthestKey)
    farthestTitle = `Pace by your last scheduled shift (${monthShort(p.m)} ${p.d}): ${fmtMoney(farthestExpected)}`
  }

  return (
    <div className="pace-strip" data-open={open} onClick={onToggle}>
      <div className="pace-stat">
        <span className="lbl">Earned</span>
        <span className="val mono">{fmtMoneyShort(earnedYTD)}</span>
      </div>
      <div className="pace-stat">
        <span className="lbl">Goal</span>
        <span className="val mono">{fmtMoneyShort(annualGoal)}</span>
      </div>
      <div className="pace-bar-wrap">
        <div className="pace-bar" title={`Earned ${fmtMoney(earnedYTD)} · projected ${fmtMoney(projected)} · pace ${fmtMoney(expected)}`}>
          <div className="fill-projected" style={{ width: projectedPct + '%' }} />
          <div className="fill" style={{ width: earnedPct + '%' }} />
          <div className="marker" style={{ left: expectedPct + '%' }} title={`Today's pace: ${fmtMoney(expected)}`} />
          {farthestPct != null && (
            <div className="marker future" style={{ left: farthestPct + '%' }} title={farthestTitle} />
          )}
        </div>
        <span className={'pace-delta ' + (delta < 0 ? 'behind' : 'ahead')}>
          {delta < 0 ? '−' : '+'}{fmtMoneyShort(Math.abs(delta))} {delta < 0 ? 'behind' : 'ahead'}
        </span>
      </div>
      <div className="pace-stat">
        <span className="lbl">Year-end</span>
        <span className="val mono">{fmtMoneyShort(projected)}</span>
      </div>
      <span className="chev"><Icon name="chev-down" size={16} /></span>
    </div>
  )
}

// ---------- Drawer ----------

function Drawer({
  open, schedule, lookup, annualGoal, earnedYTD, hoursYTD, w2WeeklyHours, dayOffRate,
}: {
  open: boolean
  schedule: Schedule
  lookup: Record<string, Hospital>
  annualGoal: number
  earnedYTD: number
  hoursYTD: number
  w2WeeklyHours: number
  dayOffRate: number
}) {
  const today = todayKey()
  const expected = expectedPace(today, annualGoal)
  const delta = earnedYTD - expected
  const todayP = parseKey(today)

  // Walk the year once, collecting all stats we need. Past entries in the
  // schedule are ignored for hour and gross totals — the manual hoursYTD /
  // earnedYTD baselines cover them, exactly like the money path.
  let futureGross = 0
  let futureHours = 0
  let paidShiftCount = 0
  let paidShiftGross = 0
  let lastFutureKey: string | null = null
  for (const k in schedule) {
    const p = parseKey(k)
    if (p.y !== todayP.y) continue
    const s = schedule[k]
    if (isUncountedShift(s)) continue
    paidShiftCount++
    paidShiftGross += shiftAmount(s, lookup)
    if (k > today) {
      futureGross += shiftAmount(s, lookup)
      futureHours += s.h
      if (!lastFutureKey || k > lastFutureKey) lastFutureKey = k
    }
  }

  const projected = earnedYTD + futureGross
  const remaining = Math.max(0, annualGoal - projected)

  // Day-off check uses the dayOffRate setting; 8h × that rate is the per-day cost.
  const safeDayOffRate = dayOffRate > 0 ? dayOffRate : 190
  const dayOffCost = safeDayOffRate * 8

  // W2 comparison: only count the period actually covered by your schedule —
  // Jan 1 through the last scheduled future shift (or today if you have no
  // future shifts). Unscheduled future months don't get counted as "vacation."
  const yearStart = new Date(todayP.y, 0, 1)
  const periodEnd = lastFutureKey ? (() => {
    const p = parseKey(lastFutureKey)
    return new Date(p.y, p.m, p.d)
  })() : new Date(todayP.y, todayP.m, todayP.d)
  const periodWeeks = Math.max(
    0,
    (periodEnd.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24 * 7),
  )
  const baseline = Math.max(1, w2WeeklyHours)
  const w2PeriodHours = periodWeeks * baseline
  const totalHours = hoursYTD + futureHours
  const weeksOffVsW2 = (w2PeriodHours - totalHours) / baseline

  const periodEndLabel = lastFutureKey
    ? (() => {
        const p = parseKey(lastFutureKey)
        return `${monthShort(p.m)} ${p.d}`
      })()
    : 'today'

  return (
    <div className="drawer" style={{ maxHeight: open ? 360 : 0 }}>
      <div className="drawer-inner">
        <div className="drawer-card">
          <div className="lbl">Earned YTD</div>
          <div className="val mono">{fmtMoney(earnedYTD)}</div>
          <div className="sub">Pace target today: {fmtMoneyShort(expected)}</div>
          <div className={'delta ' + (delta < 0 ? 'behind' : 'ahead')}>
            {delta < 0 ? '↓ ' : '↑ '}{fmtMoneyShort(Math.abs(delta))} vs pace
          </div>
        </div>
        <div className="drawer-card">
          <div className="lbl">{todayP.y} Year-end</div>
          <div className="val mono">{fmtMoney(projected)}</div>
          <div className="sub">+ {fmtMoneyShort(futureGross)} from scheduled future shifts</div>
          <div className={'delta ' + (projected >= annualGoal ? 'ahead' : 'behind')}>
            {projected >= annualGoal
              ? `+${fmtMoneyShort(projected - annualGoal)} over goal`
              : `${fmtMoneyShort(remaining)} still to schedule`}
          </div>
        </div>
        <div className="drawer-card">
          <div className="lbl">Weeks off vs W2</div>
          <div className="val mono">{weeksOffVsW2 >= 0 ? weeksOffVsW2.toFixed(1) : `−${Math.abs(weeksOffVsW2).toFixed(1)}`}</div>
          <div className="sub">
            Through {periodEndLabel}: {Math.round(totalHours)}h total ({Math.round(hoursYTD)}h YTD + {Math.round(futureHours)}h scheduled) / {Math.round(w2PeriodHours)}h W2 ({w2WeeklyHours}h × {periodWeeks.toFixed(1)} wk)
          </div>
          <div className={'delta ' + (weeksOffVsW2 < 0 ? 'ahead' : 'behind')}>
            {weeksOffVsW2 < 0
              ? `Working ${Math.abs(weeksOffVsW2).toFixed(1)} more weeks than W2`
              : `Like ${weeksOffVsW2.toFixed(1)} weeks of PTO`}
          </div>
        </div>
        <div className="drawer-card">
          <div className="lbl">Can I take tomorrow off?</div>
          {(() => {
            // Pace-relative balance: where am I RIGHT NOW vs where I should be?
            // Answer in 8h-shift units so the count maps directly to "days off".
            const ytdShiftBalance = dayOffCost > 0 ? (earnedYTD - expected) / dayOffCost : 0
            const aheadCount = Math.floor(ytdShiftBalance)
            const behindCount = Math.ceil(-ytdShiftBalance)
            const cushionVsPace = earnedYTD - expected
            if (ytdShiftBalance >= 1) {
              return (
                <>
                  <div className="val mono" style={{ color: 'var(--positive)' }}>
                    ✓ +{aheadCount} shift{aheadCount === 1 ? '' : 's'}
                  </div>
                  <div className="sub">+{fmtMoneyShort(cushionVsPace)} vs today&rsquo;s pace · 8h × ${safeDayOffRate}/hr</div>
                  <div className="delta ahead">Yes — you can take tomorrow off</div>
                </>
              )
            }
            if (ytdShiftBalance > -1) {
              return (
                <>
                  <div className="val mono">On pace</div>
                  <div className="sub">
                    {cushionVsPace >= 0 ? '+' : '−'}{fmtMoneyShort(Math.abs(cushionVsPace))} vs today&rsquo;s pace · within one shift
                  </div>
                  <div className="delta">Cutting it close — depends on what&rsquo;s already booked</div>
                </>
              )
            }
            return (
              <>
                <div className="val mono" style={{ color: 'var(--accent)' }}>
                  ✗ −{behindCount} shift{behindCount === 1 ? '' : 's'}
                </div>
                <div className="sub">−{fmtMoneyShort(-cushionVsPace)} vs today&rsquo;s pace · 8h × ${safeDayOffRate}/hr</div>
                <div className="delta behind">No — you&rsquo;re behind, don&rsquo;t skip a shift</div>
              </>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

// ---------- PaintToolbar ----------

function PaintToolbar({
  paint, setPaint, hospitals, hourOptions, onOpenSettings,
}: {
  paint: PaintState
  setPaint: (p: PaintState) => void
  hospitals: Hospital[]
  hourOptions: HourOption[]
  onOpenSettings: () => void
}) {
  const setHosp = (hosp: string) => setPaint({ ...paint, hosp, statusValue: undefined })
  const clear = () => setPaint({ active: false, hosp: paint.hosp, hours: paint.hours, mode: 'add' })
  const setMode = (mode: 'add' | 'erase') => setPaint({ ...paint, mode, active: true })
  const toggleOff = () => {
    if (paint.active && paint.hosp === 'OFF') clear()
    else setPaint({ ...paint, hosp: 'OFF', mode: 'add', active: true, statusValue: undefined })
  }
  const toggleNoLate = () => {
    if (paint.active && paint.hosp === 'NL') clear()
    else setPaint({ ...paint, hosp: 'NL', mode: 'add', active: true, statusValue: undefined })
  }
  const toggleStatus = (value: ShiftStatus) => {
    if (paint.active && paint.hosp === 'STATUS' && paint.statusValue === value) clear()
    else setPaint({ ...paint, hosp: 'STATUS', statusValue: value, mode: 'add', active: true })
  }
  const visibleHosps = hospitals.filter(h => h.enabled !== false)
  const offArmed = paint.active && paint.hosp === 'OFF'
  const noLateArmed = paint.active && paint.hosp === 'NL'
  const statusArmed = (v: ShiftStatus) =>
    paint.active && paint.hosp === 'STATUS' && paint.statusValue === v
  const isPainting =
    paint.active &&
    paint.hosp &&
    (paint.hosp === 'OFF' || paint.hosp === 'NL' || paint.hosp === 'STATUS' || paint.hours)

  return (
    <div className="toolbar">
      <span className="label">Paint</span>
      <div className="chip-group">
        {visibleHosps.map(h => (
          <button
            key={h.id}
            className={`chip hosp ${paint.hosp === h.id ? 'active' : ''}`}
            style={paint.hosp === h.id ? { background: h.color, color: '#fff' } : { color: h.color }}
            onClick={() => { setHosp(h.id); if (!paint.active) setPaint({ ...paint, hosp: h.id, active: !!paint.hours }) }}
          >
            {h.short}
          </button>
        ))}
      </div>
      <div className="chip-group">
        {hourOptions.map(o => {
          const key = hoKey(o)
          const hours = hoHours(o)
          const isOc = hoOncall(o)
          const label = typeof o === 'object' ? o.label : `${o}`
          const isActive =
            paint.label === (typeof o === 'object' ? o.label : null) &&
            paint.hours === hours &&
            !!paint.oc === isOc &&
            paint.hosp !== 'OFF' && paint.hosp !== 'NL'
          const disabled = paint.hosp === 'OFF' || paint.hosp === 'NL'
          return (
            <button
              key={key}
              className={`chip ${isActive ? 'active' : ''} ${isOc ? 'oc' : ''}`}
              disabled={disabled}
              style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
              onClick={() => {
                const lab = typeof o === 'object' ? o.label : null
                setPaint({ ...paint, hours, label: lab, oc: isOc, active: paint.active || !!paint.hosp })
              }}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div className="divider" />
      <div className="chip-group">
        <button className={`chip ${paint.mode === 'add' ? 'active' : ''}`} onClick={() => setMode('add')}>+ Add</button>
        <button className={`chip ${paint.mode === 'erase' ? 'active' : ''}`} onClick={() => setMode('erase')}>− Erase</button>
      </div>
      <div className="divider" />
      {isPainting ? (
        <div className="paint-status on">
          <span className="pulse" />
          {paint.mode === 'erase'
            ? 'Erasing shifts'
            : paint.hosp === 'OFF'
              ? 'Painting OFF days'
              : paint.hosp === 'STATUS' && paint.statusValue
                ? `Marking ${STATUS_EMOJI[paint.statusValue]} ${paint.statusValue}`
                : `Painting ${paint.hours}h ${paint.hosp}`}
          <button className="iconbtn" style={{ width: 18, height: 18, marginLeft: 4 }} onClick={(e) => { e.stopPropagation(); clear() }}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ) : (
        <div className="paint-status off">
          <Icon name="brush" size={12} />
          Pick hospital + hours, then click days
        </div>
      )}
      <span style={{ flex: 1 }} />
      <div className="mark-paint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className="label">Mark</span>
        <div className="chip-group" title="Status paint — drag across days to mark them all at once">
          {STATUSES.map((s) => (
            <button
              key={s}
              className={'chip' + (statusArmed(s) ? ' active' : '')}
              onClick={() => toggleStatus(s)}
              title={STATUS_LABELS[s]}
            >
              {STATUS_EMOJI[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="divider" />
      <button
        className={'paint-nolate' + (noLateArmed ? ' armed' : '')}
        onClick={toggleNoLate}
        title="Paint days where you can't work a late shift (concert, dinner, appointment, etc.)"
      >
        {noLateArmed ? '● No Late' : '○ No Late'}
      </button>
      <button
        className={'paint-off' + (offArmed ? ' armed' : '')}
        onClick={toggleOff}
        title="Paint days as OFF (unavailable). Click an existing OFF day to add a reason."
      >
        {offArmed ? '● Off' : '○ Off'}
      </button>
      <button className="iconbtn" onClick={onOpenSettings} title="Settings"><Icon name="settings" size={16} /></button>
    </div>
  )
}

// ---------- DayCell ----------

function DayCell({
  y, m, d, k, schedule, isFirstOfMonth, painting, faded, beyondLimit, lookup, today, paceInfo,
  onClick, onPaintEnter, onPaintStart,
}: {
  y: number; m: number; d: number; k: string
  schedule: Schedule
  isFirstOfMonth: boolean
  painting: boolean
  faded: boolean
  beyondLimit: boolean
  lookup: Record<string, Hospital>
  today: string
  paceInfo?: PaceInfo
  onClick: (k: string, e: ReactMouseEvent) => void
  onPaintEnter: (k: string) => void
  onPaintStart: (k: string, e: ReactMouseEvent) => void
}) {
  const inactive = faded || beyondLimit
  const shift = faded ? undefined : schedule[k]
  const isToday = k === today
  const dow = new Date(y, m, d).getDay()
  const isWeekend = dow === 0 || dow === 6

  const cls = ['day']
  if (inactive) cls.push('faded')
  if (beyondLimit) cls.push('beyond-limit')
  if (isToday) cls.push('today')
  if (isWeekend) cls.push('weekend')
  if (painting) cls.push('painting')
  if (isFirstOfMonth) cls.push('first-of-month')

  const renderShiftCard = (s: ShiftEntry, asOverlay = false): ReactElement | null => {
    if (s.hosp === 'OFF') {
      return (
        <div key="off" className="shift-card OFF">
          <span>OFF</span>
          {s.label && <span className="reason">· {s.label}</span>}
        </div>
      )
    }
    if (s.hosp === 'NL') {
      return (
        <div key="nl" className="shift-card NL">
          <span>NO LATE</span>
          {s.noLateLabel && <span className="reason">· {s.noLateLabel}</span>}
        </div>
      )
    }
    const status = effectiveStatus(s.status, k, today)
    const h = lookup[s.hosp]
    if (!h) return null
    const isOc = !!s.oc || asOverlay
    const isCustom = !['HFH', 'GR'].includes(h.id)
    const style: CSSProperties | undefined = isCustom
      ? {
        background: `color-mix(in srgb, ${h.color} 14%, transparent)`,
        borderColor: h.color,
        color: h.color,
      }
      : undefined
    const showDot = !asOverlay && !isOc && s.hosp !== 'OFF' && paceInfo
    return (
      <div
        key={asOverlay ? 'oc' : 'main'}
        className={`shift-card ${h.id} ${isOc ? 'oc' : ''}`}
        style={style}
      >
        {!asOverlay && renderStatusMark(status)}
        <span className="h">{s.label || `${s.h}`}</span>
        <span className="hosp-short">{h.short}</span>
        <span className="amt mono">{isOc ? 'on-call' : fmtMoneyShort(shiftAmount(s, lookup))}</span>
        {showDot && (
          <span
            className="pace-dot"
            data-status={paceInfo!.status}
            title={`After this shift: ${fmtMoney(paceInfo!.cum)} · pace target ${fmtMoney(paceInfo!.expected)} (${paceInfo!.cum >= paceInfo!.expected ? '+' : '−'}${fmtMoney(Math.abs(paceInfo!.cum - paceInfo!.expected))})`}
          />
        )}
      </div>
    )
  }

  return (
    <div
      className={cls.join(' ')}
      onMouseDown={(e) => onPaintStart(k, e)}
      onMouseEnter={() => onPaintEnter(k)}
      onClick={(e) => onClick(k, e)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span className="num">
          {isFirstOfMonth ? <span className="month-prefix">{monthShort(m)} </span> : null}
          {d}
        </span>
        {isToday && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', letterSpacing: 0.05, marginLeft: 'auto' }}>TODAY</span>}
      </div>
      {shift && renderShiftCard(shift)}
      {shift && shift.ocOverlay && renderShiftCard({ hosp: shift.ocOverlay.hosp, h: shift.ocOverlay.h, label: shift.ocOverlay.label, oc: true }, true)}
      {shift && shift.noLate && shift.hosp !== 'NL' && (
        <span className="nolate-badge">
          NO LATE
          {shift.noLateLabel && <span className="reason">· {shift.noLateLabel}</span>}
        </span>
      )}
    </div>
  )
}

// ---------- Calendar ----------

function buildContinuousCells(months: { y: number; m: number }[], weekStart: 'mon' | 'sun') {
  const cells: { y: number; m: number; d: number; key: string; faded?: boolean; firstOfMonth?: boolean }[] = []
  if (!months.length) return cells
  const first = months[0]
  const wd = new Date(first.y, first.m, 1).getDay()
  const offset = weekStart === 'sun' ? wd : (wd + 6) % 7
  const prevY = first.m === 0 ? first.y - 1 : first.y
  const prevM = first.m === 0 ? 11 : first.m - 1
  const prevDays = monthDays(prevY, prevM)
  for (let i = 0; i < offset; i++) {
    const d = prevDays - offset + 1 + i
    cells.push({ y: prevY, m: prevM, d, key: dateKey(prevY, prevM, d), faded: true })
  }
  for (const { y, m } of months) {
    const days = monthDays(y, m)
    for (let d = 1; d <= days; d++) {
      cells.push({ y, m, d, key: dateKey(y, m, d), firstOfMonth: d === 1 })
    }
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]
    let { y, m, d } = last
    d++
    const dd = monthDays(y, m)
    if (d > dd) {
      m++
      if (m > 11) { m = 0; y++ }
      d = 1
    }
    cells.push({ y, m, d, key: dateKey(y, m, d), faded: true })
  }
  return cells
}

function MonthDivider({
  y, m, schedule, lookup, onClearMonth,
}: {
  y: number; m: number
  schedule: Schedule
  lookup: Record<string, Hospital>
  onClearMonth: (y: number, m: number) => void
}) {
  const stats = monthStats(schedule, y, m, lookup)
  const handleClear = () => {
    if (stats.shifts === 0) return
    if (confirm(`Clear all ${stats.shifts} shift${stats.shifts === 1 ? '' : 's'} in ${monthName(m)} ${y}? This cannot be undone.`)) {
      onClearMonth(y, m)
    }
  }
  return (
    <div className="month-divider">
      <h2>{monthName(m)} <span className="year">{y}</span></h2>
      <span className="meta mono">{stats.shifts} shifts · {stats.hours}h · {fmtMoney(stats.gross)}</span>
      <div className="actions">
        <button
          className="btn"
          onClick={handleClear}
          disabled={stats.shifts === 0}
          style={stats.shifts === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : { color: 'var(--warn)' }}
        >
          <Icon name="trash" size={12} /> Clear all
        </button>
      </div>
    </div>
  )
}

function Calendar({
  schedule, paintHover, months, weekStart, lookup, today, maxKey, paceMap,
  onDayClick, onPaintStart, onPaintEnter, onClearMonth,
}: {
  schedule: Schedule
  paintHover: Record<string, boolean>
  months: { y: number; m: number }[]
  weekStart: 'mon' | 'sun'
  lookup: Record<string, Hospital>
  today: string
  maxKey: string
  paceMap: Map<string, PaceInfo>
  onDayClick: (k: string, e: ReactMouseEvent) => void
  onPaintStart: (k: string, e: ReactMouseEvent) => void
  onPaintEnter: (k: string) => void
  onClearMonth: (y: number, m: number) => void
}) {
  const cells = buildContinuousCells(months, weekStart)
  const seenMonths = new Set<string>()
  const elements: ReactElement[] = []

  const dowMon = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const dowSun = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dowLabels = weekStart === 'sun' ? dowSun : dowMon
  const weekendIdx = weekStart === 'sun' ? [0, 6] : [5, 6]

  elements.push(
    <div key="dow" className="cal-dow-row">
      {dowLabels.map((d, i) => (
        <div key={d} className={'cal-dow' + (weekendIdx.includes(i) ? ' we' : '')}>{d}</div>
      ))}
    </div>,
  )

  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7)
    const firstOfMonthCell = week.find((c) => c.firstOfMonth && !seenMonths.has(`${c.y}-${c.m}`))
    if (firstOfMonthCell) {
      seenMonths.add(`${firstOfMonthCell.y}-${firstOfMonthCell.m}`)
      elements.push(
        <MonthDivider
          key={`md-${firstOfMonthCell.y}-${firstOfMonthCell.m}`}
          y={firstOfMonthCell.y}
          m={firstOfMonthCell.m}
          schedule={schedule}
          lookup={lookup}
          onClearMonth={onClearMonth}
        />,
      )
    }
    elements.push(
      <div key={`w-${i}`} className="cal-week">
        {week.map((c) => {
          const beyondLimit = !c.faded && c.key > maxKey
          const inactive = !!c.faded || beyondLimit
          return (
            <DayCell
              key={c.key}
              y={c.y}
              m={c.m}
              d={c.d}
              k={c.key}
              schedule={schedule}
              isFirstOfMonth={!!c.firstOfMonth}
              faded={!!c.faded}
              beyondLimit={beyondLimit}
              lookup={lookup}
              today={today}
              paceInfo={paceMap.get(c.key)}
              painting={!!paintHover[c.key]}
              onClick={inactive ? () => {} : onDayClick}
              onPaintStart={inactive ? () => {} : onPaintStart}
              onPaintEnter={inactive ? () => {} : onPaintEnter}
            />
          )
        })}
      </div>,
    )
  }

  return <div className="cal-scroll"><div className="cal-flow">{elements}</div></div>
}

// ---------- DayPopup ----------

function DayPopup({
  k, schedule, hospitals, hourOptions, onSave, onDelete, onClose,
}: {
  k: string
  schedule: Schedule
  hospitals: Hospital[]
  hourOptions: HourOption[]
  onSave: (k: string, entry: ShiftEntry) => void
  onDelete: (k: string) => void
  onClose: () => void
}) {
  const p = parseKey(k)
  const date = new Date(p.y, p.m, p.d)
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()]
  const existing = schedule[k]
  const visibleHosps = hospitals.filter((h) => h.enabled !== false)

  // OFF-day editor branch — single text field for the reason, with optional
  // "apply to range" for a contiguous stretch of OFF days.
  if (existing?.hosp === 'OFF') {
    return (
      <OffReasonPopup
        dayName={dayName}
        month={p.m}
        day={p.d}
        existing={existing}
        stretch={findOffStretch(schedule, k)}
        onSave={(entry) => { onSave(k, entry); onClose() }}
        onSaveRange={(reason, dates) => {
          for (const d of dates) {
            const cur = schedule[d]
            if (cur?.hosp !== 'OFF') continue
            const next: ShiftEntry = { hosp: 'OFF', h: 0 }
            if (reason) next.label = reason
            onSave(d, next)
          }
          onClose()
        }}
        onDelete={() => { onDelete(k); onClose() }}
        onClose={onClose}
      />
    )
  }

  // No-Late-only editor branch — text field for what makes it No Late.
  if (existing?.hosp === 'NL') {
    return (
      <NoLateReasonPopup
        dayName={dayName}
        month={p.m}
        day={p.d}
        existing={existing}
        onSave={(entry) => { onSave(k, entry); onClose() }}
        onDelete={() => { onDelete(k); onClose() }}
        onClose={onClose}
      />
    )
  }

  const defaultHosp = existing?.hosp ? existing.hosp : (visibleHosps[0]?.id || '')
  const [hosp, setHosp] = useState(defaultHosp)
  const [hours, setHours] = useState<number>(existing?.h && existing.h ? existing.h : 12)
  const [noLate, setNoLate] = useState<boolean>(!!existing?.noLate)
  const [noLateLabel, setNoLateLabel] = useState<string>(existing?.noLateLabel ?? '')
  const [status, setStatus] = useState<ShiftStatus>(normalizeStatus(existing?.status))

  const hospObj = hospitals.find((h) => h.id === hosp)
  const amt = hospObj ? hospObj.rate * hours : 0
  const times = SHIFT_TIMES[hours]

  const save = () => {
    if (!hosp) return
    const entry: ShiftEntry = { hosp, h: hours }
    if (noLate) {
      entry.noLate = true
      if (noLateLabel.trim()) entry.noLateLabel = noLateLabel.trim()
    }
    if (status !== 'planned') entry.status = status
    onSave(k, entry)
    onClose()
  }
  const remove = () => { onDelete(k); onClose() }

  return (
    <div className="popup-backdrop" onClick={onClose}>
      <div className="popup" onClick={(e) => e.stopPropagation()}>
        <div className="popup-head">
          <Icon name="calendar" size={18} />
          <h3>{dayName}, {monthShort(p.m)} {p.d}</h3>
          <button className="iconbtn close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="popup-body">
          <div className="popup-row">
            <span className="label">Hospital</span>
            <div className="chip-group" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
              {visibleHosps.map((h) => (
                <button
                  key={h.id}
                  className={`chip hosp ${hosp === h.id ? 'active' : ''}`}
                  style={hosp === h.id ? { background: h.color, color: '#fff' } : undefined}
                  onClick={() => setHosp(h.id)}
                >
                  {h.name} · ${h.rate}/h
                </button>
              ))}
            </div>
          </div>
          <div className="popup-row">
            <span className="label">Shift length</span>
            <div className="chip-group" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
              {hourOptions.filter((o) => !hoOncall(o)).map((o) => {
                const k2 = hoKey(o)
                const h = hoHours(o)
                const label = typeof o === 'object' ? o.label : `${o}`
                return (
                  <button key={k2} className={`chip ${hours === h ? 'active' : ''}`} onClick={() => setHours(h)}>
                    {label}
                  </button>
                )
              })}
            </div>
            {times && (
              <span style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                {times[0]} → {times[1]}
              </span>
            )}
          </div>
          <div className="popup-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={noLate}
                onChange={(e) => setNoLate(e.target.checked)}
              />
              <span>Mark <strong>No Late</strong> — afternoon appointment, evening event</span>
            </label>
            {noLate && (
              <input
                className="s-input"
                placeholder="Reason (optional) — e.g. concert at 8pm"
                value={noLateLabel}
                onChange={(e) => setNoLateLabel(e.target.value)}
                style={{ marginTop: 6, height: 32, fontSize: 13 }}
              />
            )}
          </div>
          <StatusSelector value={status} onChange={setStatus} />
          <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Estimated gross</span>
            <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{fmtMoney(amt)}</span>
          </div>
        </div>
        <div className="popup-foot">
          {existing && <button className="btn danger" onClick={remove}><Icon name="trash" size={12} /> Remove</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={!hosp}>{existing ? 'Update shift' : 'Add shift'}</button>
        </div>
      </div>
    </div>
  )
}

function OffReasonPopup({
  dayName, month, day, existing, stretch, onSave, onSaveRange, onDelete, onClose,
}: {
  dayName: string
  month: number
  day: number
  existing: ShiftEntry
  stretch: string[]
  onSave: (entry: ShiftEntry) => void
  onSaveRange: (reason: string, dates: string[]) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [reason, setReason] = useState(existing.label ?? '')
  const [applyToRange, setApplyToRange] = useState(stretch.length > 1)

  const save = () => {
    const trimmed = reason.trim()
    if (applyToRange && stretch.length > 1) {
      onSaveRange(trimmed, stretch)
      return
    }
    const next: ShiftEntry = { hosp: 'OFF', h: 0 }
    if (trimmed) next.label = trimmed
    onSave(next)
  }

  const stretchLabel = stretch.length > 1
    ? (() => {
        const a = parseKey(stretch[0])
        const b = parseKey(stretch[stretch.length - 1])
        return `${monthShort(a.m)} ${a.d} – ${monthShort(b.m)} ${b.d}`
      })()
    : null

  return (
    <div className="popup-backdrop" onClick={onClose}>
      <div className="popup" onClick={(e) => e.stopPropagation()}>
        <div className="popup-head">
          <Icon name="calendar" size={18} />
          <h3>{dayName}, {monthShort(month)} {day} · OFF</h3>
          <button className="iconbtn close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="popup-body">
          <div className="popup-row">
            <span className="label">Reason</span>
            <input
              className="s-input"
              autoFocus
              placeholder="e.g. Vacation, family wedding, training day"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save() }}
              style={{ height: 38, fontSize: 14 }}
            />
          </div>
          {stretch.length > 1 && (
            <div className="popup-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={applyToRange}
                  onChange={(e) => setApplyToRange(e.target.checked)}
                />
                <span>
                  Apply to all <strong>{stretch.length} consecutive OFF days</strong> ({stretchLabel})
                </span>
              </label>
            </div>
          )}
        </div>
        <div className="popup-foot">
          <button className="btn danger" onClick={onDelete}><Icon name="trash" size={12} /> Clear OFF</button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

function NoLateReasonPopup({
  dayName, month, day, existing, onSave, onDelete, onClose,
}: {
  dayName: string
  month: number
  day: number
  existing: ShiftEntry
  onSave: (entry: ShiftEntry) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [reason, setReason] = useState(existing.noLateLabel ?? '')

  const save = () => {
    const next: ShiftEntry = { hosp: 'NL', h: 0 }
    if (reason.trim()) next.noLateLabel = reason.trim()
    onSave(next)
  }

  return (
    <div className="popup-backdrop" onClick={onClose}>
      <div className="popup" onClick={(e) => e.stopPropagation()}>
        <div className="popup-head">
          <Icon name="calendar" size={18} />
          <h3>{dayName}, {monthShort(month)} {day} · No Late</h3>
          <button className="iconbtn close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="popup-body">
          <div className="popup-row">
            <span className="label">Reason</span>
            <input
              className="s-input"
              autoFocus
              placeholder="e.g. concert at 8pm, kid's recital, dinner reservation"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save() }}
              style={{ height: 38, fontSize: 14 }}
            />
          </div>
        </div>
        <div className="popup-foot">
          <button className="btn danger" onClick={onDelete}><Icon name="trash" size={12} /> Clear</button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ---------- SettingsModal ----------

function SettingsModal({
  open, onClose, settings, setSettings, icalUrl,
}: {
  open: boolean
  onClose: () => void
  settings: ScheduleSettings
  setSettings: (s: ScheduleSettings) => void
  icalUrl: string
}) {
  const [newHospId, setNewHospId] = useState('')
  const [newHospName, setNewHospName] = useState('')
  const [newHospRate, setNewHospRate] = useState<number | string>(225)
  const [newHospColor, setNewHospColor] = useState('#16a34a')
  const [newHour, setNewHour] = useState('')
  const [newRangeStart, setNewRangeStart] = useState('11:00')
  const [newRangeEnd, setNewRangeEnd] = useState('19:00')
  const [hourTab, setHourTab] = useState<'hours' | 'range'>('hours')
  const [editingHospId, setEditingHospId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (!open) return null

  const updateHosp = (id: string, patch: Partial<Hospital>) => {
    setSettings({
      ...settings,
      hospitals: settings.hospitals.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    })
  }
  const toggleHosp = (id: string) => {
    setSettings({
      ...settings,
      hospitals: settings.hospitals.map((h) => (h.id === id ? { ...h, enabled: !(h.enabled !== false) } : h)),
    })
  }
  const removeHosp = (id: string) => {
    if (!confirm(`Remove hospital "${id}"? Existing shifts at this hospital will stay on the calendar.`)) return
    setSettings({
      ...settings,
      hospitals: settings.hospitals.filter((h) => h.id !== id),
    })
  }
  const addHosp = () => {
    const id = newHospId.trim().toUpperCase()
    const name = newHospName.trim()
    if (!id || !name) return
    if (settings.hospitals.some((h) => h.id === id)) {
      alert('A hospital with that ID already exists.')
      return
    }
    setSettings({
      ...settings,
      hospitals: [
        ...settings.hospitals,
        { id, name, short: id, rate: Number(newHospRate) || 200, color: newHospColor, pay: 'biweekly', enabled: true },
      ],
    })
    setNewHospId(''); setNewHospName(''); setNewHospRate(225)
  }
  const removeHour = (key: string) => {
    setSettings({ ...settings, hourOptions: settings.hourOptions.filter((x) => hoKey(x) !== key) })
  }
  const addHour = () => {
    const n = Number(newHour)
    if (!n || n <= 0 || n > 48) return
    if (settings.hourOptions.some((x) => hoKey(x) === String(n))) return
    const next = [...settings.hourOptions, n]
    next.sort((a, b) => hoHours(a) - hoHours(b))
    setSettings({ ...settings, hourOptions: next })
    setNewHour('')
  }
  const addRange = () => {
    const hours = computeRangeHours(newRangeStart, newRangeEnd)
    if (!hours) return
    const label = rangeLabel(newRangeStart, newRangeEnd)
    if (settings.hourOptions.some((x) => hoKey(x) === label)) return
    const next: HourOption[] = [...settings.hourOptions, { label, hours, start: newRangeStart, end: newRangeEnd }]
    next.sort((a, b) => hoHours(a) - hoHours(b))
    setSettings({ ...settings, hourOptions: next })
  }

  const copyIcal = async () => {
    try {
      await navigator.clipboard.writeText(icalUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="popup-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <Icon name="settings" size={18} />
          <h3>Settings</h3>
          <button className="iconbtn close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="settings-body">
          <div className="settings-section">
            <h4>Calendar subscription</h4>
            <div className="desc">Add this URL to Apple Calendar / Google Calendar / Outlook. They re-fetch on their own.</div>
            <div className="ical-box">
              <code>{icalUrl}</code>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="s-add-btn" onClick={copyIcal}>
                  <Icon name="copy" size={12} /> {copied ? 'Copied' : 'Copy URL'}
                </button>
                <a className="btn" href={icalUrl} target="_blank" rel="noreferrer">Preview .ics</a>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h4>Calendar</h4>
            <div className="desc">Layout preferences for the calendar grid.</div>
            <div className="settings-row">
              <div className="row-label"><span className="name">Week starts on</span></div>
              <div className="chip-group">
                <button className={'chip' + (settings.weekStart === 'sun' ? ' active' : '')} onClick={() => setSettings({ ...settings, weekStart: 'sun' })}>Sunday</button>
                <button className={'chip' + (settings.weekStart === 'mon' ? ' active' : '')} onClick={() => setSettings({ ...settings, weekStart: 'mon' })}>Monday</button>
              </div>
            </div>
            <div className="settings-row">
              <div className="row-label"><span className="name">Theme</span></div>
              <div className="chip-group">
                <button className={'chip' + ((settings.theme ?? 'system') === 'system' ? ' active' : '')} onClick={() => setSettings({ ...settings, theme: 'system' })}>System</button>
                <button className={'chip' + (settings.theme === 'light' ? ' active' : '')} onClick={() => setSettings({ ...settings, theme: 'light' })}>Light</button>
                <button className={'chip' + (settings.theme === 'dark' ? ' active' : '')} onClick={() => setSettings({ ...settings, theme: 'dark' })}>Dark</button>
              </div>
            </div>
            <div className="settings-row">
              <div className="row-label">
                <span className="name">Show previous months</span>
                <span className="meta">past months are archived by default</span>
              </div>
              <button
                className="s-toggle"
                data-on={!!settings.showPastMonths}
                onClick={() => setSettings({ ...settings, showPastMonths: !settings.showPastMonths })}
              >
                <i />
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h4>Income tracker</h4>
            <div className="desc">Set what you&rsquo;ve already been paid this year. Future shifts on the calendar add on top of it. The pace dot on each shift shows whether that shift puts you ahead (green) or behind (orange) on its date.</div>
            <div className="settings-row">
              <div className="row-label">
                <span className="name">Show YTD bar & dashboard</span>
              </div>
              <button className="s-toggle" data-on={settings.showIncome !== false} onClick={() => setSettings({ ...settings, showIncome: !(settings.showIncome !== false) })}><i /></button>
            </div>
            <div className="settings-row">
              <div className="row-label">
                <span className="name">Earned this year</span>
                <span className="meta">paid YTD baseline ($)</span>
              </div>
              <input
                className="s-input"
                type="number"
                min={0}
                step={100}
                value={settings.earnedYTD}
                onChange={(e) => setSettings({ ...settings, earnedYTD: Number(e.target.value) || 0 })}
                style={{ width: 120 }}
              />
            </div>
            <div className="settings-row">
              <div className="row-label">
                <span className="name">Hours worked this year</span>
                <span className="meta">paid YTD baseline (hrs)</span>
              </div>
              <input
                className="s-input"
                type="number"
                min={0}
                step={1}
                value={settings.hoursYTD ?? 0}
                onChange={(e) => setSettings({ ...settings, hoursYTD: Number(e.target.value) || 0 })}
                style={{ width: 120 }}
              />
            </div>
            <div className="settings-row">
              <div className="row-label">
                <span className="name">Annual goal</span>
              </div>
              <input
                className="s-input"
                type="number"
                min={0}
                step={1000}
                value={settings.annualGoal}
                onChange={(e) => setSettings({ ...settings, annualGoal: Number(e.target.value) || 0 })}
                style={{ width: 120 }}
              />
            </div>
            <div className="settings-row">
              <div className="row-label">
                <span className="name">W2 hours/week</span>
                <span className="meta">baseline for "weeks off vs W2"</span>
              </div>
              <input
                className="s-input"
                type="number"
                min={1}
                max={80}
                step={1}
                value={settings.w2WeeklyHours ?? 36}
                onChange={(e) => setSettings({ ...settings, w2WeeklyHours: Number(e.target.value) || 36 })}
                style={{ width: 80 }}
              />
            </div>
            <div className="settings-row">
              <div className="row-label">
                <span className="name">Day-off rate ($/hr)</span>
                <span className="meta">8h × this rate = cost of one offered-off shift</span>
              </div>
              <input
                className="s-input"
                type="number"
                min={1}
                step={1}
                value={settings.dayOffRate ?? 190}
                onChange={(e) => setSettings({ ...settings, dayOffRate: Number(e.target.value) || 190 })}
                style={{ width: 80 }}
              />
            </div>
          </div>

          <div className="settings-section">
            <h4>Hospitals</h4>
            <div className="desc">Hospitals that appear in the paint toolbar and color the calendar.</div>
            {settings.hospitals.map((h) => {
              const archived = h.enabled === false
              const isEditing = editingHospId === h.id
              return (
                <div key={h.id} className={'settings-row hosp-row' + (isEditing ? ' editing' : '')}>
                  {!isEditing ? (
                    <>
                      <div className="row-label">
                        <span className="swatch-sm" style={{ background: h.color, opacity: archived ? 0.4 : 1 }} />
                        <span className="name" style={{ textDecoration: archived ? 'line-through' : 'none', color: archived ? 'var(--ink-3)' : undefined }}>{h.name}</span>
                        <span className="meta">{h.id} · ${h.rate}/h</span>
                        {archived && <span className="archived-tag">Archived</span>}
                      </div>
                      <div className="row-actions">
                        <button className="s-archive" onClick={() => setEditingHospId(h.id)}>
                          <Icon name="edit" size={12} /> Edit
                        </button>
                        <button
                          className={'s-archive' + (archived ? ' is-archived' : '')}
                          onClick={() => toggleHosp(h.id)}
                        >
                          <Icon name={archived ? 'refresh' : 'archive'} size={12} />
                          {archived ? ' Restore' : ' Archive'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="hosp-edit">
                      <div className="hosp-edit-grid">
                        <label className="add-field">
                          <span className="add-field-lbl">Name</span>
                          <input className="s-input" value={h.name} onChange={(e) => updateHosp(h.id, { name: e.target.value })} />
                        </label>
                        <label className="add-field">
                          <span className="add-field-lbl">Short</span>
                          <input className="s-input" value={h.short} maxLength={6} onChange={(e) => updateHosp(h.id, { short: e.target.value.toUpperCase() })} />
                        </label>
                        <label className="add-field">
                          <span className="add-field-lbl">Rate $/h</span>
                          <input className="s-input" type="number" min={0} value={h.rate} onChange={(e) => updateHosp(h.id, { rate: Number(e.target.value) || 0 })} />
                        </label>
                        <label className="add-field">
                          <span className="add-field-lbl">Pay</span>
                          <select className="s-input" value={h.pay || 'biweekly'} onChange={(e) => updateHosp(h.id, { pay: e.target.value as Hospital['pay'] })}>
                            <option value="weekly">weekly</option>
                            <option value="biweekly">biweekly</option>
                            <option value="monthly">monthly</option>
                            <option value="per-shift">per-shift</option>
                          </select>
                        </label>
                        <label className="add-field">
                          <span className="add-field-lbl">Color</span>
                          <input className="s-input color-large" type="color" value={h.color} onChange={(e) => updateHosp(h.id, { color: e.target.value })} />
                        </label>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <button
                          className="s-archive"
                          style={{ color: 'var(--warn)' }}
                          onClick={() => { removeHosp(h.id); setEditingHospId(null) }}
                        >
                          <Icon name="trash" size={12} /> Remove
                        </button>
                        <button className="s-archive" onClick={() => setEditingHospId(null)}>Done</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            <div className="add-hosp-form">
              <div className="add-hosp-grid">
                <label className="add-field">
                  <span className="add-field-lbl">ID</span>
                  <input className="s-input" placeholder="e.g. BCH" maxLength={5} value={newHospId} onChange={(e) => setNewHospId(e.target.value.toUpperCase())} />
                </label>
                <label className="add-field">
                  <span className="add-field-lbl">Hospital name</span>
                  <input className="s-input" placeholder="e.g. Beaumont Children's" value={newHospName} onChange={(e) => setNewHospName(e.target.value)} />
                </label>
                <label className="add-field">
                  <span className="add-field-lbl">Rate ($/hr)</span>
                  <input className="s-input" type="number" min={1} placeholder="225" value={newHospRate} onChange={(e) => setNewHospRate(e.target.value)} />
                </label>
                <label className="add-field">
                  <span className="add-field-lbl">Color</span>
                  <input type="color" className="s-input color-large" value={newHospColor} onChange={(e) => setNewHospColor(e.target.value)} />
                </label>
              </div>
              <button type="button" className="s-add-btn add-hosp-btn" onClick={addHosp} disabled={!newHospId.trim() || !newHospName.trim()}>
                <Icon name="plus" size={12} /> Add hospital
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h4>Shift lengths</h4>
            <div className="desc">Hour presets that show as chips in the paint toolbar.</div>
            <div className="hour-pills">
              {settings.hourOptions.map((o) => {
                const key = hoKey(o)
                const label = typeof o === 'object' ? o.label : `${o}`
                return (
                  <span key={key} className="hour-pill">
                    {label}
                    {typeof o === 'object' && <span className="hour-pill-meta">· {o.hours}h</span>}
                    <button onClick={() => removeHour(key)} title="Remove"><Icon name="x" size={12} /></button>
                  </span>
                )
              })}
            </div>
            <div className="chip-group" style={{ marginTop: 10 }}>
              <button className={'chip' + (hourTab === 'hours' ? ' active' : '')} onClick={() => setHourTab('hours')}>Hours</button>
              <button className={'chip' + (hourTab === 'range' ? ' active' : '')} onClick={() => setHourTab('range')}>Time range</button>
            </div>
            {hourTab === 'hours' ? (
              <div className="settings-add">
                <input className="s-input tiny" type="number" min={1} max={48} placeholder="hours" value={newHour} onChange={(e) => setNewHour(e.target.value)} />
                <button className="s-add-btn" onClick={addHour} disabled={!newHour}>
                  <Icon name="plus" size={12} /> Add hours
                </button>
              </div>
            ) : (
              <div className="settings-add">
                <label className="add-field" style={{ flex: '0 0 auto' }}>
                  <span className="add-field-lbl">Start</span>
                  <input className="s-input" type="time" value={newRangeStart} onChange={(e) => setNewRangeStart(e.target.value)} />
                </label>
                <label className="add-field" style={{ flex: '0 0 auto' }}>
                  <span className="add-field-lbl">End</span>
                  <input className="s-input" type="time" value={newRangeEnd} onChange={(e) => setNewRangeEnd(e.target.value)} />
                </label>
                <span style={{ fontSize: 11, color: 'var(--ink-3)', alignSelf: 'flex-end', marginBottom: 7 }}>
                  = {computeRangeHours(newRangeStart, newRangeEnd)}h · {rangeLabel(newRangeStart, newRangeEnd)}
                </span>
                <button className="s-add-btn" style={{ alignSelf: 'flex-end', marginBottom: 1 }} onClick={addRange}>
                  <Icon name="plus" size={12} /> Add range
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Main client component ----------

export function ScheduleClient({
  initialSchedule,
  initialSettings,
  icalToken,
}: {
  initialSchedule: Schedule
  initialSettings: ScheduleSettings
  icalToken: string
}) {
  const [schedule, setScheduleState] = useState<Schedule>(initialSchedule)
  const [settings, setSettingsState] = useState<ScheduleSettings>(initialSettings)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [paint, setPaint] = useState<PaintState>({
    active: false,
    hosp: initialSettings.hospitals[0]?.id || '',
    hours: 12,
    mode: 'add',
  })
  const [popupKey, setPopupKey] = useState<string | null>(null)
  const [paintHover, setPaintHover] = useState<Record<string, boolean>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [csvPickerOpen, setCsvPickerOpen] = useState(false)

  const today = useMemo(() => todayKey(), [])
  const maxKey = useMemo(() => maxScheduleKey(), [])
  const months = useMemo(
    () => visibleMonths(settings.showPastMonths ?? false),
    [settings.showPastMonths],
  )
  const lookup = useMemo(() => makeHospLookup(settings.hospitals), [settings.hospitals])
  const paceMap = useMemo(
    () => buildPaceMap(schedule, lookup, today, settings.earnedYTD, settings.annualGoal),
    [schedule, lookup, today, settings.earnedYTD, settings.annualGoal],
  )
  const scheduleAppRef = useRef<HTMLDivElement | null>(null)

  const scrollToToday = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const root = scheduleAppRef.current
    if (!root) return
    const el = root.querySelector('.day.today') as HTMLElement | null
    if (el) el.scrollIntoView({ block: 'start', behavior })
  }, [])

  useLayoutEffect(() => {
    scrollToToday('auto')
  }, [scrollToToday])
  const icalUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/api/ical/${icalToken}.ics`
  }, [icalToken])

  // Optimistic-sync infrastructure
  const persistedScheduleRef = useRef<Schedule>(initialSchedule)
  const scheduleRef = useRef<Schedule>(initialSchedule)
  const persistedSettingsRef = useRef<ScheduleSettings>(initialSettings)
  const scheduleSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settingsSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDragging = useRef(false)
  const paintRef = useRef(paint)
  paintRef.current = paint

  const flushSchedule = useCallback(async () => {
    const cur = scheduleRef.current
    const persisted = persistedScheduleRef.current
    const upserts: Array<{ date: string; data: ShiftEntry }> = []
    const deletes: string[] = []
    for (const k in cur) {
      if (JSON.stringify(cur[k]) !== JSON.stringify(persisted[k])) {
        upserts.push({ date: k, data: cur[k] })
      }
    }
    for (const k in persisted) {
      if (!(k in cur)) deletes.push(k)
    }
    if (upserts.length === 0 && deletes.length === 0) return
    try {
      await syncEntriesAction(upserts, deletes)
      persistedScheduleRef.current = { ...cur }
    } catch (err) {
      console.error('schedule sync failed', err)
    }
  }, [])

  const queueScheduleSync = useCallback(() => {
    if (scheduleSyncTimer.current) clearTimeout(scheduleSyncTimer.current)
    scheduleSyncTimer.current = setTimeout(() => { void flushSchedule() }, 500)
  }, [flushSchedule])

  const setSchedule = useCallback((next: Schedule | ((s: Schedule) => Schedule)) => {
    const newSched = typeof next === 'function' ? next(scheduleRef.current) : next
    scheduleRef.current = newSched
    setScheduleState(newSched)
    queueScheduleSync()
  }, [queueScheduleSync])

  const flushSettings = useCallback(async () => {
    const cur = settings
    if (JSON.stringify(cur) === JSON.stringify(persistedSettingsRef.current)) return
    try {
      await saveSettingsAction(cur)
      persistedSettingsRef.current = cur
    } catch (err) {
      console.error('settings save failed', err)
    }
  }, [settings])

  const setSettings = useCallback((next: ScheduleSettings) => {
    setSettingsState(next)
    if (settingsSyncTimer.current) clearTimeout(settingsSyncTimer.current)
    settingsSyncTimer.current = setTimeout(() => { void flushSettings() }, 500)
  }, [flushSettings])

  // Re-flush settings when state actually changes (closure capture)
  useEffect(() => {
    if (settingsSyncTimer.current) clearTimeout(settingsSyncTimer.current)
    if (JSON.stringify(settings) === JSON.stringify(persistedSettingsRef.current)) return
    settingsSyncTimer.current = setTimeout(() => { void flushSettings() }, 500)
    return () => {
      if (settingsSyncTimer.current) clearTimeout(settingsSyncTimer.current)
    }
  }, [settings, flushSettings])

  const visibleSchedule = useMemo(() => {
    const out: Schedule = {}
    for (const k in schedule) {
      const s = schedule[k]
      const h = settings.hospitals.find((x) => x.id === s.hosp)
      if (h && h.enabled === false) continue
      out[k] = s
    }
    return out
  }, [schedule, settings.hospitals])

  useEffect(() => {
    const up = () => {
      isDragging.current = false
      setPaintHover({})
      // Force-flush at end of drag for instant feedback
      if (scheduleSyncTimer.current) clearTimeout(scheduleSyncTimer.current)
      void flushSchedule()
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [flushSchedule])

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (scheduleSyncTimer.current) clearTimeout(scheduleSyncTimer.current)
      if (settingsSyncTimer.current) clearTimeout(settingsSyncTimer.current)
      void flushSchedule()
      void flushSettings()
    }
  }, [flushSchedule, flushSettings])

  const applyPaint = (key: string): boolean => {
    const p = paintRef.current
    if (!p.active) return false
    if (key > maxKey) return false
    const cur = scheduleRef.current
    if (p.mode === 'erase') {
      if (cur[key]) {
        const next = { ...cur }
        delete next[key]
        setSchedule(next)
        return true
      }
      return false
    }
    if (!p.hosp) return false
    if (p.hosp === 'STATUS') {
      const ex = cur[key]
      if (!ex) return false
      // Status only applies to paid shifts. OFF and No-Late don't carry an
      // approval state — let drag-paints skip them so you can swipe across a
      // mixed week without trampling the markers.
      if (ex.hosp === 'OFF' || ex.hosp === 'NL') return false
      const target = p.statusValue ?? 'planned'
      const currentStatus = normalizeStatus(ex.status)
      if (currentStatus === target) return false
      const next: ShiftEntry = { ...ex }
      if (target === 'planned') delete next.status
      else next.status = target
      setSchedule({ ...cur, [key]: next })
      return true
    }
    if (p.hosp !== 'OFF' && p.hosp !== 'NL' && !p.hours) return false
    const ex = cur[key]

    let nextEntry: ShiftEntry
    if (p.hosp === 'OFF') {
      nextEntry = { hosp: 'OFF', h: 0 }
      if (ex && ex.hosp === 'OFF' && ex.label) nextEntry.label = ex.label
      if (ex && ex.hosp === 'OFF' && ex.noLate) nextEntry.noLate = true
      if (ex && ex.hosp === 'OFF' && ex.status) nextEntry.status = ex.status
    } else if (p.hosp === 'NL') {
      if (!ex) {
        nextEntry = { hosp: 'NL', h: 0 }
      } else if (ex.hosp === 'NL') {
        return false
      } else if (ex.hosp === 'OFF') {
        return false
      } else {
        nextEntry = { ...ex, noLate: true }
        if (ex.noLateLabel) nextEntry.noLateLabel = ex.noLateLabel
        // status preserved via spread
      }
    } else {
      const hours = p.hours
      const label = p.label || null
      const oc = !!p.oc
      if (oc) {
        const newOc: ShiftEntry = { hosp: p.hosp, h: hours }
        if (label) newOc.label = label
        if (!ex || ex.hosp === 'OFF' || ex.hosp === 'NL' || (ex.oc && !ex.ocOverlay)) {
          nextEntry = { ...newOc, oc: true }
          if (ex?.noLate) nextEntry.noLate = true
        } else {
          const { ocOverlay: _ignore, ...rest } = ex
          void _ignore
          nextEntry = { ...rest, ocOverlay: { hosp: p.hosp, h: hours, ...(label ? { label } : {}) } }
        }
      } else {
        const newRegular: ShiftEntry = { hosp: p.hosp, h: hours }
        if (label) newRegular.label = label
        let preservedOc: ShiftEntry['ocOverlay'] | null = null
        let preservedNoLate = false
        let preservedNoLateLabel: string | undefined
        let preservedStatus: ShiftStatus | undefined
        if (ex && ex.hosp !== 'OFF' && ex.hosp !== 'NL') {
          if (ex.oc && !ex.ocOverlay) {
            preservedOc = { hosp: ex.hosp, h: ex.h }
            if (ex.label) preservedOc.label = ex.label
          } else if (ex.ocOverlay) {
            preservedOc = ex.ocOverlay
          }
          preservedNoLate = !!ex.noLate
          preservedNoLateLabel = ex.noLateLabel
          preservedStatus = ex.status
        } else if (ex?.hosp === 'NL') {
          preservedNoLate = true
          preservedNoLateLabel = ex.noLateLabel
          preservedStatus = ex.status
        }
        nextEntry = preservedOc ? { ...newRegular, ocOverlay: preservedOc } : newRegular
        if (preservedNoLate) nextEntry.noLate = true
        if (preservedNoLateLabel) nextEntry.noLateLabel = preservedNoLateLabel
        if (preservedStatus) nextEntry.status = preservedStatus
      }
    }

    if (ex && JSON.stringify(ex) === JSON.stringify(nextEntry)) return false
    setSchedule({ ...cur, [key]: nextEntry })
    return true
  }

  const onPaintStart = (key: string, e: ReactMouseEvent) => {
    if (!paintRef.current.active) return
    e.preventDefault()
    isDragging.current = true
    setPaintHover({ [key]: true })
    applyPaint(key)
  }
  const onPaintEnter = (key: string) => {
    if (!isDragging.current) return
    setPaintHover((h) => ({ ...h, [key]: true }))
    applyPaint(key)
  }
  const onDayClick = (key: string) => {
    if (key > maxKey) return
    const p = paintRef.current
    const cur = scheduleRef.current[key]
    // Click-while-painting opens a reason editor when the paint mode and the
    // cell match (OFF on OFF day, or No Late on a No-Late day). Drag-painting
    // is unaffected because click only fires when mouseDown+up land on the
    // same cell with no movement.
    if (p.active && p.hosp === 'OFF' && cur?.hosp === 'OFF') {
      setPopupKey(key)
      return
    }
    if (p.active && p.hosp === 'NL' && (cur?.hosp === 'NL' || cur?.noLate)) {
      setPopupKey(key)
      return
    }
    if (p.active) return
    setPopupKey(key)
  }

  const handleClearMonth = (y: number, m: number) => {
    const next: Schedule = {}
    for (const k in scheduleRef.current) {
      const p = parseKey(k)
      const s = scheduleRef.current[k]
      if (!(p.y === y && p.m === m) || isOffShift(s)) next[k] = s
    }
    setSchedule(next)
    // Also fire targeted DB clear for safety
    void clearMonthAction(y, m)
  }

  const handlePopupSave = (k: string, entry: ShiftEntry) => {
    setSchedule({ ...scheduleRef.current, [k]: entry })
  }
  const handlePopupDelete = (k: string) => {
    const next = { ...scheduleRef.current }
    delete next[k]
    setSchedule(next)
  }

  return (
    <div className="schedule-app" data-theme={settings.theme} ref={scheduleAppRef}>
      <div className="pane">
        <div className="topbar">
          <Link href="/" className="btn" title="Back to Hub">
            <Icon name="chev-left" size={14} /> Hub
          </Link>
          <h1>Schedule</h1>
          <span className="subtle">· {monthName(parseKey(today).m)} {parseKey(today).y}</span>
          <span className="spacer" />
          <button className="btn" onClick={() => scrollToToday('smooth')} title="Scroll to today">
            <Icon name="today" size={14} /> Today
          </button>
          <button
            className="btn"
            onClick={() => setCsvPickerOpen(true)}
            title="Download CSV"
          >
            <Icon name="download" size={14} /> CSV
          </button>
          <button
            className="btn"
            onClick={() => exportICS(schedule, settings)}
            title="Download .ics snapshot for Apple/Google Calendar"
          >
            <Icon name="calendar" size={14} /> .ics
          </button>
          <button className="iconbtn" onClick={() => setSettingsOpen(true)} title="Settings">
            <Icon name="settings" size={16} />
          </button>
        </div>

        {settings.showIncome !== false && (
          <PaceStrip
            schedule={visibleSchedule}
            open={drawerOpen}
            onToggle={() => setDrawerOpen((o) => !o)}
            lookup={lookup}
            annualGoal={settings.annualGoal}
            earnedYTD={settings.earnedYTD}
          />
        )}
        {settings.showIncome !== false && (
          <Drawer
            open={drawerOpen}
            schedule={visibleSchedule}
            lookup={lookup}
            annualGoal={settings.annualGoal}
            earnedYTD={settings.earnedYTD}
            hoursYTD={settings.hoursYTD ?? 0}
            w2WeeklyHours={settings.w2WeeklyHours ?? 36}
            dayOffRate={settings.dayOffRate ?? 190}
          />
        )}

        <PaintToolbar
          paint={paint}
          setPaint={setPaint}
          hospitals={settings.hospitals}
          hourOptions={settings.hourOptions}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <Calendar
          schedule={visibleSchedule}
          paintHover={paintHover}
          months={months}
          weekStart={settings.weekStart}
          lookup={lookup}
          today={today}
          maxKey={maxKey}
          paceMap={paceMap}
          onDayClick={onDayClick}
          onPaintStart={onPaintStart}
          onPaintEnter={onPaintEnter}
          onClearMonth={handleClearMonth}
        />

        {popupKey && (
          <DayPopup
            k={popupKey}
            schedule={schedule}
            hospitals={settings.hospitals}
            hourOptions={settings.hourOptions}
            onSave={handlePopupSave}
            onDelete={handlePopupDelete}
            onClose={() => setPopupKey(null)}
          />
        )}

        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          setSettings={setSettings}
          icalUrl={icalUrl}
        />

        {csvPickerOpen && (
          <CsvPickerPopup
            onPersonal={() => { exportCSV(schedule, settings, 'personal'); setCsvPickerOpen(false) }}
            onWork={() => { exportCSV(schedule, settings, 'work'); setCsvPickerOpen(false) }}
            onClose={() => setCsvPickerOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

function CsvPickerPopup({
  onPersonal, onWork, onClose,
}: {
  onPersonal: () => void
  onWork: () => void
  onClose: () => void
}) {
  return (
    <div className="popup-backdrop" onClick={onClose}>
      <div className="popup" onClick={(e) => e.stopPropagation()}>
        <div className="popup-head">
          <Icon name="download" size={18} />
          <h3>Download CSV</h3>
          <button className="iconbtn close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="popup-body">
          <button
            className="btn"
            onClick={onPersonal}
            style={{ justifyContent: 'flex-start', flexDirection: 'column', alignItems: 'flex-start', padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 8, gap: 4 }}
          >
            <span style={{ fontWeight: 700, fontSize: 14 }}>Personal — full export</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400 }}>
              Every column: hospital name, rate, gross pay, OFF reason, No-Late reason. Use for your own records.
            </span>
          </button>
          <button
            className="btn"
            onClick={onWork}
            style={{ justifyContent: 'flex-start', flexDirection: 'column', alignItems: 'flex-start', padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 8, gap: 4 }}
          >
            <span style={{ fontWeight: 700, fontSize: 14 }}>Work — for schedulers</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400 }}>
              Date · day · hospital · hours · on-call · no-late · OFF. No reasons, no rates, no pay.
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
