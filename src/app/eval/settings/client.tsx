'use client'

import { useState, useTransition } from 'react'
import {
  saveDefaultsAction,
  saveSampleAction,
  updateSampleAction,
} from '../actions'
import type { EvalDomain, EvalLevel, EvalPronoun } from '@/lib/eval-types'

type DomainOption = { value: EvalDomain; label: string }

export function DefaultsForm({
  defaultLevel,
  defaultPronoun,
}: {
  defaultLevel: EvalLevel
  defaultPronoun: EvalPronoun
}) {
  const [level, setLevel] = useState<EvalLevel>(defaultLevel)
  const [pronoun, setPronoun] = useState<EvalPronoun>(defaultPronoun)
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function save() {
    startTransition(async () => {
      await saveDefaultsAction(level, pronoun)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="seg">
        <button
          type="button"
          className={level === 'junior' ? 'active' : ''}
          onClick={() => setLevel('junior')}
        >
          Junior
        </button>
        <button
          type="button"
          className={level === 'senior' ? 'active' : ''}
          onClick={() => setLevel('senior')}
        >
          Senior
        </button>
      </div>
      <div className="seg">
        <button
          type="button"
          className={pronoun === 'she' ? 'active' : ''}
          onClick={() => setPronoun('she')}
        >
          she/her
        </button>
        <button
          type="button"
          className={pronoun === 'he' ? 'active' : ''}
          onClick={() => setPronoun('he')}
        >
          he/him
        </button>
        <button
          type="button"
          className={pronoun === 'they' ? 'active' : ''}
          onClick={() => setPronoun('they')}
        >
          they/them
        </button>
      </div>
      <div className="submit-row">
        <span className="status">{saved ? 'Saved' : ''}</span>
        <button type="button" className="btn primary" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save defaults'}
        </button>
      </div>
    </div>
  )
}

export function NewSampleForm({ domains }: { domains: DomainOption[] }) {
  const [text, setText] = useState('')
  const [domain, setDomain] = useState<EvalDomain>('general')
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function save() {
    if (!text.trim()) return
    startTransition(async () => {
      await saveSampleAction(text, domain)
      setText('')
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <textarea
        className="input"
        placeholder="Paste an example of how you write evaluation comments — anything you'd want future drafts to sound like."
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        style={{ minHeight: 110 }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="input"
          style={{ width: 'auto', flex: '0 1 auto', minWidth: 220 }}
          value={domain}
          onChange={(e) => setDomain(e.target.value as EvalDomain)}
          disabled={pending}
        >
          {domains.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <span className="status" style={{ marginLeft: 'auto' }}>
          {saved ? 'Added' : ''}
        </span>
        <button
          type="button"
          className="btn primary"
          disabled={pending || !text.trim()}
          onClick={save}
        >
          {pending ? 'Saving…' : 'Add sample'}
        </button>
      </div>
    </div>
  )
}

export function SampleRow({
  id,
  initialText,
  initialDomain,
  domains,
}: {
  id: string
  initialText: string
  initialDomain: EvalDomain
  domains: DomainOption[]
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(initialText)
  const [domain, setDomain] = useState<EvalDomain>(initialDomain)
  const [pending, startTransition] = useTransition()

  function save() {
    if (!text.trim()) return
    startTransition(async () => {
      await updateSampleAction(id, text, domain)
      setEditing(false)
    })
  }

  if (!editing) {
    return (
      <>
        <div className="sample-text">{initialText}</div>
        <div className="sample-actions">
          <button type="button" className="row-btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
      </>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        style={{ minHeight: 110 }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="input"
          style={{ width: 'auto', flex: '0 1 auto', minWidth: 220 }}
          value={domain}
          onChange={(e) => setDomain(e.target.value as EvalDomain)}
          disabled={pending}
        >
          {domains.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto' }} />
        <button
          type="button"
          className="btn"
          onClick={() => {
            setText(initialText)
            setDomain(initialDomain)
            setEditing(false)
          }}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={save}
          disabled={pending || !text.trim()}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
