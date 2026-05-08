import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { listVoiceSamples, loadEvalSettings } from '@/lib/eval-db'
import { DOMAIN_LABEL, EVAL_DOMAINS, type EvalDomain } from '@/lib/eval-types'
import { SampleRow, NewSampleForm, DefaultsForm } from './client'
import {
  deleteSampleAction,
  pinSampleAction,
  unpinSampleAction,
} from '../actions'
import '../eval.css'

export const metadata = { title: 'Voice samples' }
export const dynamic = 'force-dynamic'

const DOMAIN_OPTIONS = EVAL_DOMAINS.map((d) => ({ value: d, label: DOMAIN_LABEL[d] }))

export default async function EvalSettingsPage() {
  await requireSession()
  const [samples, settings] = await Promise.all([
    listVoiceSamples(),
    loadEvalSettings(),
  ])

  return (
    <div className="eval-app">
      <main className="container">
        <header className="page-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link href="/eval" className="crumb">← Eval</Link>
            <h1>Voice samples</h1>
          </div>
        </header>

        <section className="form-card">
          <div className="field">
            <span className="field-label">Defaults for new drafts</span>
            <DefaultsForm
              defaultLevel={settings.defaultLevel}
              defaultPronoun={settings.defaultPronoun}
            />
          </div>
        </section>

        <section className="form-card">
          <div className="field">
            <span className="field-label">Add a sample</span>
            <NewSampleForm domains={DOMAIN_OPTIONS} />
          </div>
        </section>

        {samples.length === 0 ? (
          <div className="empty">
            No voice samples yet. After you draft on <Link href="/eval" className="crumb" style={{ display: 'inline' }}>Eval</Link>,
            edit any block and tap ★ to save it here.
          </div>
        ) : (
          <ul className="sample-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {samples.map((s) => (
              <li key={s.id} className="sample-row">
                <div className="sample-meta">
                  <span>{DOMAIN_LABEL[s.domain as EvalDomain] ?? s.domain}</span>
                  {s.pinned && <span className="pin">★ pinned</span>}
                  <span style={{ marginLeft: 'auto' }}>
                    <form action={s.pinned ? unpinSampleAction : pinSampleAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" className="row-btn">
                        {s.pinned ? 'Unpin' : 'Pin'}
                      </button>
                    </form>
                    <form action={deleteSampleAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" className="row-btn danger">Delete</button>
                    </form>
                  </span>
                </div>
                <SampleRow
                  id={s.id}
                  initialText={s.text}
                  initialDomain={s.domain as EvalDomain}
                  domains={DOMAIN_OPTIONS}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
