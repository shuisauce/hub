import Link from 'next/link'
import { listNotes, loadNotesSettings } from '@/lib/db'
import { requireSession } from '@/lib/session'
import {
  createNoteAction,
  deleteNoteAction,
  pinNoteAction,
  unpinNoteAction,
} from './actions'
import { NotesSettingsButton } from './settings-popup'
import { LocalTime } from './local-time'
import { ConfirmForm } from './confirm-form'
import './notes.css'

export const metadata = { title: 'Notes' }
export const dynamic = 'force-dynamic'

const FONT_FAMILIES: Record<'sans' | 'serif' | 'mono', string> = {
  sans: 'var(--font-geist-sans), \'Inter\', -apple-system, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'var(--font-geist-mono), \'JetBrains Mono\', ui-monospace, monospace',
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function titleOf(note: { title: string; content: string }): string {
  if (note.title.trim()) return note.title
  const text = stripHtml(note.content)
  const firstLine = text.split('\n').find((l) => l.trim()) ?? ''
  return firstLine.trim() || 'Untitled'
}

function snippetOf(note: { title: string; content: string }): string {
  const text = stripHtml(note.content).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (!note.title.trim()) {
    const firstLine = stripHtml(note.content).split('\n').find((l) => l.trim()) ?? ''
    const idx = text.indexOf(firstLine.trim())
    if (idx >= 0) {
      const rest = text.slice(idx + firstLine.trim().length).trim()
      return rest.slice(0, 140)
    }
  }
  return text.slice(0, 140)
}

export default async function NotesPage() {
  await requireSession()
  const [notes, settings] = await Promise.all([listNotes(), loadNotesSettings()])

  const wrapperStyle = {
    fontFamily: FONT_FAMILIES[settings.fontFamily],
    fontSize: `${settings.fontSize}px`,
  }

  return (
    <div className="notes-app">
      <main className="container" style={wrapperStyle}>
        <header className="page-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link href="/" className="crumb">← Hub</Link>
            <h1>Notes</h1>
          </div>
          <div className="actions">
            <Link href="/notes/trash" className="btn">Trash</Link>
            <NotesSettingsButton initial={settings} />
            <form action={createNoteAction}>
              <button type="submit" className="btn primary">New note</button>
            </form>
          </div>
        </header>

        {notes.length === 0 ? (
          <div className="empty">
            No notes yet. Click <em>New note</em> to create one.
          </div>
        ) : (
          <ul className="note-list">
            {notes.map((note) => {
              const isPinned = !!note.pinned_at
              const snippet = snippetOf(note)
              return (
                <li key={note.id} className="note-row">
                  <Link href={`/notes/${note.id}`} className="note-link">
                    <span className="note-title">
                      {isPinned && <span className="pin" aria-hidden title="Pinned">📌</span>}
                      <span className="label">{titleOf(note)}</span>
                    </span>
                    {snippet && <span className="note-snippet">{snippet}</span>}
                    <span className="note-meta">
                      <LocalTime iso={note.updated_at} />
                    </span>
                  </Link>
                  <div className="note-actions">
                    <form action={isPinned ? unpinNoteAction : pinNoteAction}>
                      <input type="hidden" name="id" value={note.id} />
                      <button type="submit" className="row-btn" title={isPinned ? 'Unpin' : 'Pin to top'}>
                        {isPinned ? 'Unpin' : 'Pin'}
                      </button>
                    </form>
                    <ConfirmForm action={deleteNoteAction} message="Move this note to trash?">
                      <input type="hidden" name="id" value={note.id} />
                      <button
                        type="submit"
                        className="row-btn danger"
                        title="Move to trash (auto-deletes in 30 days)"
                      >
                        Trash
                      </button>
                    </ConfirmForm>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
