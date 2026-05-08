import Link from 'next/link'
import { listTrash, loadNotesSettings, type Note } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { purgeNoteAction, restoreNoteAction } from '../actions'
import { ConfirmForm } from '../confirm-form'
import '../notes.css'

export const metadata = { title: 'Trash' }
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

function previewOf(note: { title: string; content: string }) {
  if (note.title.trim()) return note.title
  const text = stripHtml(note.content)
  const firstLine = text.split('\n').find((l) => l.trim()) ?? ''
  return firstLine.trim() || 'Untitled'
}

function daysLeft(deletedAt: string): number {
  const elapsed = (Date.now() - new Date(deletedAt).getTime()) / (1000 * 60 * 60 * 24)
  return Math.max(0, Math.ceil(30 - elapsed))
}

export default async function TrashPage() {
  await requireSession()
  const [notes, settings] = await Promise.all([listTrash(), loadNotesSettings()])

  const wrapperStyle = {
    fontFamily: FONT_FAMILIES[settings.fontFamily],
  }

  return (
    <div className="notes-app">
      <main className="container" style={wrapperStyle}>
        <header className="page-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link href="/notes" className="crumb">← Notes</Link>
            <h1>Trash</h1>
          </div>
          <span className="note-meta">Auto-deleted after 30 days</span>
        </header>

        {notes.length === 0 ? (
          <div className="empty">Trash is empty.</div>
        ) : (
          <ul className="note-list">
            {notes.map((note: Note) => {
              const left = note.deleted_at ? daysLeft(note.deleted_at) : 30
              return (
                <li key={note.id} className="note-row">
                  <div className="note-link" style={{ cursor: 'default' }}>
                    <span className="note-title">
                      <span className="label">{previewOf(note)}</span>
                    </span>
                    <span className="note-meta">
                      Auto-deletes in {left} day{left === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="note-actions">
                    <form action={restoreNoteAction}>
                      <input type="hidden" name="id" value={note.id} />
                      <button type="submit" className="row-btn">Restore</button>
                    </form>
                    <ConfirmForm
                      action={purgeNoteAction}
                      message={`Delete "${previewOf(note)}" forever? This can't be undone.`}
                    >
                      <input type="hidden" name="id" value={note.id} />
                      <button type="submit" className="row-btn danger">Delete forever</button>
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
