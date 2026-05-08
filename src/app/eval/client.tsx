'use client'

import { useState, useTransition } from 'react'
import { saveSampleAction } from './actions'
import {
  DOMAIN_LABEL,
  type EvalLevel,
  type EvalPronoun,
} from '@/lib/eval-types'

type BlockKey =
  | 'patient_safety'
  | 'knowledge_thinking'
  | 'communication'
  | 'professional_role'
  | 'improvement'
  | 'additional'

const BLOCK_ORDER: BlockKey[] = [
  'patient_safety',
  'knowledge_thinking',
  'communication',
  'professional_role',
  'improvement',
  'additional',
]

type Blocks = Record<BlockKey, string>

const EMPTY_BLOCKS: Blocks = {
  patient_safety: '',
  knowledge_thinking: '',
  communication: '',
  professional_role: '',
  improvement: '',
  additional: '',
}

export function EvalDrafter({
  defaultLevel,
  defaultPronoun,
}: {
  defaultLevel: EvalLevel
  defaultPronoun: EvalPronoun
}) {
  const [level, setLevel] = useState<EvalLevel>(defaultLevel)
  const [pronoun, setPronoun] = useState<EvalPronoun>(defaultPronoun)
  const [notes, setNotes] = useState('')
  const [blocks, setBlocks] = useState<Blocks | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setError(null)
    if (!notes.trim()) {
      setError('Add some notes first.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/eval/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, pronoun, notes }),
      })
      const data = (await res.json()) as
        | { blocks: Blocks }
        | { error: string }
      if (!res.ok || 'error' in data) {
        const msg = 'error' in data ? data.error : `HTTP ${res.status}`
        setError(msg)
        return
      }
      setBlocks(data.blocks)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="form-card">
        <div className="form-row">
          <div className="field">
            <span className="field-label">Level</span>
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
          </div>

          <div className="field">
            <span className="field-label">Pronoun</span>
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
          </div>
        </div>

        <div className="field">
          <span className="field-label">End-of-day notes</span>
          <textarea
            className="input"
            placeholder="Cases, what we discussed, strengths, growth areas — rough is fine."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="submit-row">
          <span className={`status${error ? ' error' : ''}`}>
            {error ? error : busy ? 'Drafting…' : ''}
          </span>
          <button
            type="button"
            className="btn primary"
            onClick={generate}
            disabled={busy}
          >
            {busy ? 'Drafting…' : 'Draft Comments'}
          </button>
        </div>
      </section>

      {blocks && (
        <section className="results">
          {BLOCK_ORDER.map((key) => (
            <BlockCard
              key={key}
              blockKey={key}
              text={blocks[key]}
              onChange={(t) => setBlocks((prev) => (prev ? { ...prev, [key]: t } : prev))}
            />
          ))}
        </section>
      )}
    </>
  )
}

function BlockCard({
  blockKey,
  text,
  onChange,
}: {
  blockKey: BlockKey
  text: string
  onChange: (t: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore — older browsers
    }
  }

  function star() {
    const t = text.trim()
    if (!t) return
    startTransition(async () => {
      await saveSampleAction(t, blockKey)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <article className="card">
      <header className="card-head">
        <span className="card-title">{DOMAIN_LABEL[blockKey]}</span>
        <div className="card-actions">
          <button
            type="button"
            className={`btn ghost ${saved ? 'star active' : 'star'}`}
            onClick={star}
            disabled={pending || !text.trim()}
            title="Save edited version as a voice sample"
          >
            {saved ? '★ Saved' : pending ? '★ …' : '★'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={copy}
            disabled={!text.trim()}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </header>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck
      />
    </article>
  )
}
