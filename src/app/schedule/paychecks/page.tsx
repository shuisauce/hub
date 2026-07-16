import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { loadSchedule, loadSettings } from '@/lib/schedule-db'
import { upcomingPaychecks } from '@/lib/paychecks'
import { PaychecksClient } from './client'
import './paychecks.css'

export const metadata = { title: 'Paychecks' }
export const dynamic = 'force-dynamic'

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default async function PaychecksPage() {
  await requireSession()

  const [schedule, settings] = await Promise.all([loadSchedule(), loadSettings()])
  const today = todayKey()
  const yearEnd = `${new Date().getFullYear()}-12-31`
  const paychecks = upcomingPaychecks(schedule, settings.hospitals, today, yearEnd)

  return (
    <div className="paychecks-app">
      <main className="paychecks-container">
        <header className="paychecks-head">
          <Link href="/schedule" className="crumb">← Schedule</Link>
          <h1>Paychecks</h1>
          <span className="sub">upcoming through Dec 31</span>
        </header>

        <PaychecksClient
          paychecks={paychecks}
          hospitals={settings.hospitals}
          today={today}
          horizon={yearEnd}
        />
      </main>
    </div>
  )
}
