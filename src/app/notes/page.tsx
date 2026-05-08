import Link from 'next/link'
import { listNotes, loadNotesSettings } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { createNoteAction, deleteNoteAction } from './actions'
import { NotesSettingsButton } from './settings-popup'

export const metadata = { title: 'Notes' }
export const dynamic = 'force-dynamic'

const FONT_FAMILIES: Record<'sans' | 'serif' | 'mono', string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default async function NotesPage() {
  await requireSession()
  const [notes, settings] = await Promise.all([listNotes(), loadNotesSettings()])

  const wrapperStyle = {
    fontFamily: FONT_FAMILIES[settings.fontFamily],
    fontSize: `${settings.fontSize}px`,
  }

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10"
      style={wrapperStyle}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← Hub
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/notes/trash"
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          >
            Trash
          </Link>
          <NotesSettingsButton initial={settings} />
          <form action={createNoteAction}>
            <button
              type="submit"
              className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
            >
              New note
            </button>
          </form>
        </div>
      </header>

      {notes.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No notes yet. Click <em>New note</em> to create one.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-black/10 rounded-md border border-black/10 dark:divide-white/10 dark:border-white/10">
          {notes.map((note) => (
            <li
              key={note.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <Link
                href={`/notes/${note.id}`}
                className="flex min-w-0 flex-1 flex-col gap-0.5"
              >
                <span className="truncate text-sm font-medium">
                  {previewOf(note)}
                </span>
                <span className="text-xs text-zinc-500">
                  {formatDate(note.updated_at)}
                </span>
              </Link>
              <form action={deleteNoteAction}>
                <input type="hidden" name="id" value={note.id} />
                <button
                  type="submit"
                  className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-black/5 hover:text-red-600 dark:hover:bg-white/10 dark:hover:text-red-400"
                  aria-label="Move to trash"
                  title="Move to trash (auto-deletes in 30 days)"
                >
                  Trash
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
