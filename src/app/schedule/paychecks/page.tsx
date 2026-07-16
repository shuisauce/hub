import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { loadSchedule, loadSettings, listPaycheckReceipts } from '@/lib/schedule-db'
import { computePaychecks } from '@/lib/paychecks'
import { PaychecksClient } from './client'
import './paychecks.css'

export const metadata = { title: 'Paychecks' }
export const dynamic = 'force-dynamic'

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default async function PaychecksPage() {
  await requireSession()

  const [schedule, settings, receipts] = await Promise.all([
    loadSchedule(),
    loadSettings(),
    listPaycheckReceipts(),
  ])

  const now = new Date()
  const today = keyOf(now)
  // Whole current year: past checks stay visible for double-checking (even
  // when their calendar months are archived — archiving only hides the
  // calendar view, the data is all still here), plus everything upcoming.
  const from = `${now.getFullYear()}-01-01`
  const yearEnd = `${now.getFullYear()}-12-31`
  const paychecks = computePaychecks(schedule, settings.hospitals, from, yearEnd)

  return (
    <div className="paychecks-app">
      <main className="paychecks-container">
        <header className="paychecks-head">
          <Link href="/schedule" className="crumb">← Schedule</Link>
          <h1>Paychecks</h1>
          <span className="sub">all of {now.getFullYear()}</span>
        </header>

        <PaychecksClient
          paychecks={paychecks}
          receipts={receipts}
          hospitals={settings.hospitals}
          today={today}
          horizon={yearEnd}
        />
      </main>
    </div>
  )
}
