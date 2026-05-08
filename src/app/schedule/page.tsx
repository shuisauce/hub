import { requireSession } from '@/lib/session'
import {
  getOrCreateIcalToken,
  loadSchedule,
  loadSettings,
} from '@/lib/schedule-db'
import { ScheduleClient } from './client'
import './schedule.css'

export const metadata = { title: 'Schedule' }
export const dynamic = 'force-dynamic'

export default async function SchedulePage() {
  await requireSession()
  const [schedule, settings, icalToken] = await Promise.all([
    loadSchedule(),
    loadSettings(),
    getOrCreateIcalToken(),
  ])
  return (
    <ScheduleClient
      initialSchedule={schedule}
      initialSettings={settings}
      icalToken={icalToken}
    />
  )
}
