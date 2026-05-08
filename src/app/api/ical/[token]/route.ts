import { NextResponse } from 'next/server'
import ical, { ICalEventBusyStatus } from 'ical-generator'
import { findHospitalsByToken, findScheduleByToken } from '@/lib/schedule-db'

export const dynamic = 'force-dynamic'

const SHIFT_TIME_DEFAULTS: Record<number, [string, string]> = {
  8: ['07:00', '15:00'],
  10: ['07:00', '17:00'],
  12: ['06:30', '18:30'],
  16: ['06:30', '22:30'],
  24: ['07:00', '07:00'],
}

function parseLocal(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm)
}

function shiftBounds(
  date: string,
  hours: number,
  start: string | undefined,
  end: string | undefined,
): { start: Date; end: Date } {
  const fallback = SHIFT_TIME_DEFAULTS[hours] ?? ['07:00', null as string | null]
  const s = start || fallback[0]
  let e = end || fallback[1] || ''
  if (!e) {
    // Compute end by adding hours.
    const [sh, sm] = s.split(':').map(Number)
    const totalMin = sh * 60 + sm + Math.round(hours * 60)
    const eh = Math.floor((totalMin / 60) % 24)
    const em = totalMin % 60
    e = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
  }
  const startDt = parseLocal(date, s)
  let endDt = parseLocal(date, e)
  if (endDt <= startDt) endDt = new Date(endDt.getTime() + 24 * 60 * 60 * 1000)
  return { start: startDt, end: endDt }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  if (!token || !/^[a-f0-9]{8,}$/.test(token)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const schedule = await findScheduleByToken(token)
  if (!schedule) return new NextResponse('Not found', { status: 404 })
  const hospitals = (await findHospitalsByToken(token)) ?? []
  const hospById = new Map(hospitals.map((h) => [h.id, h]))

  const cal = ical({ name: 'Schedule', timezone: 'America/New_York' })

  const dates = Object.keys(schedule).sort()
  for (const date of dates) {
    const entry = schedule[date]
    if (!entry) continue
    if (entry.hosp === 'OFF') {
      cal.createEvent({
        start: parseLocal(date, '00:00'),
        allDay: true,
        summary: 'OFF',
        busystatus: ICalEventBusyStatus.FREE,
        id: `off-${date}`,
      })
      continue
    }
    const hosp = hospById.get(entry.hosp)
    const summary = hosp
      ? `${hosp.short} ${entry.label || `${entry.h}h`}${entry.oc ? ' (on-call)' : ''}`
      : `${entry.hosp} ${entry.h}h`
    const range = entry.label && /^\d{1,2}(:\d{2})?[AP]?-/.test(entry.label) ? null : null
    void range
    const bounds = shiftBounds(date, entry.h, undefined, undefined)
    cal.createEvent({
      start: bounds.start,
      end: bounds.end,
      summary,
      description: hosp ? `${hosp.name} · $${hosp.rate}/hr` : '',
      id: `shift-${date}`,
    })

    if (entry.ocOverlay) {
      const oh = hospById.get(entry.ocOverlay.hosp)
      const ocSummary = oh
        ? `${oh.short} ${entry.ocOverlay.label || `${entry.ocOverlay.h}h`} (on-call)`
        : `${entry.ocOverlay.hosp} on-call`
      cal.createEvent({
        start: parseLocal(date, '00:00'),
        allDay: true,
        summary: ocSummary,
        busystatus: ICalEventBusyStatus.FREE,
        id: `oc-${date}`,
      })
    }
  }

  return new NextResponse(cal.toString(), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
