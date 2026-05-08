'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveNoteAction } from '../actions'
import type { Note } from '@/lib/db'

const AUTOSAVE_MS = 600

type Status = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'

export function Editor({ note }: { note: Note }) {
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const lastSaved = useRef({ title: note.title, content: note.content })
  const inFlight = useRef<Promise<void> | null>(null)
  const pending = useRef(false)

  async function flush() {
    if (inFlight.current) {
      pending.current = true
      return
    }
    const snapshotTitle = title
    const snapshotContent = content
    if (
      snapshotTitle === lastSaved.current.title &&
      snapshotContent === lastSaved.current.content
    ) {
      setStatus('saved')
      return
    }
    setStatus('saving')
    setError(null)
    inFlight.current = (async () => {
      try {
        await saveNoteAction(note.id, snapshotTitle, snapshotContent)
        lastSaved.current = { title: snapshotTitle, content: snapshotContent }
        setStatus((s) => (s === 'saving' ? 'saved' : s))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed')
        setStatus('error')
      } finally {
        inFlight.current = null
        if (pending.current) {
          pending.current = false
          flush()
        }
      }
    })()
  }

  const flushRef = useRef(flush)
  flushRef.current = flush

  const dirty =
    title !== lastSaved.current.title || content !== lastSaved.current.content

  useEffect(() => {
    if (!dirty) return
    setStatus('unsaved')
    const timer = setTimeout(() => flushRef.current(), AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [title, content, dirty])

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (
        title !== lastSaved.current.title ||
        content !== lastSaved.current.content ||
        inFlight.current
      ) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        flushRef.current()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('keydown', onKey)
    }
  }, [title, content])

  let label = ''
  if (status === 'saving') label = 'Saving…'
  else if (status === 'unsaved') label = 'Unsaved changes'
  else if (status === 'saved') label = 'Saved'
  else if (status === 'error') label = error ? `Error: ${error}` : 'Error'

  async function backToList() {
    await flushRef.current()
    router.push('/notes')
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={backToList}
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← All notes
        </button>
        <span
          className={
            status === 'error'
              ? 'text-xs text-red-600 dark:text-red-400'
              : 'text-xs text-zinc-500'
          }
        >
          {label}
        </span>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-zinc-400"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write something…"
        className="w-full flex-1 resize-none bg-transparent font-mono text-base leading-relaxed outline-none placeholder:text-zinc-400"
      />
    </div>
  )
}
