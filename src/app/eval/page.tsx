import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { loadEvalSettings } from '@/lib/eval-db'
import { EvalDrafter } from './client'
import './eval.css'

export const metadata = { title: 'Eval' }
export const dynamic = 'force-dynamic'

export default async function EvalPage() {
  await requireSession()
  const settings = await loadEvalSettings()

  return (
    <div className="eval-app">
      <main className="container">
        <header className="page-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link href="/" className="crumb">← Hub</Link>
            <h1>Eval</h1>
          </div>
          <div className="actions">
            <Link href="/eval/settings" className="btn">Voice samples</Link>
          </div>
        </header>

        <EvalDrafter
          defaultLevel={settings.defaultLevel}
          defaultPronoun={settings.defaultPronoun}
        />
      </main>
    </div>
  )
}
