import { requireSession } from '@/lib/session'
import {
  getOrCreateIcalToken,
  loadSchedule,
  loadSettings,
  listPaycheckReceipts,
} from '@/lib/schedule-db'
import { ScheduleClient } from './client'
import './schedule.css'

export const metadata = { title: 'Schedule' }
export const dynamic = 'force-dynamic'

export default async function SchedulePage() {
  await requireSession()
  const [schedule, settings, icalToken, receipts] = await Promise.all([
    loadSchedule(),
    loadSettings(),
    getOrCreateIcalToken(),
    listPaycheckReceipts(),
  ])
  return (
    <ScheduleClient
      initialSchedule={schedule}
      initialSettings={settings}
      icalToken={icalToken}
      initialReceipts={receipts}
    />
  )
}
