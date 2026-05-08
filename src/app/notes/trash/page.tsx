import Link from 'next/link'
import { listTrash, loadNotesSettings, type Note } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { purgeNoteAction, restoreNoteAction } from '../actions'

export const metadata = { title: 'Trash' }
export const dynamic = 'force-dynamic'

const FONT_FAMILIES: Record<'sans' | 'serif' | 'mono', string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
}

function previewOf(note: { title: string; content: string }) {
  if (note.title.trim()) return note.title
  const firstLine = note.content.split('\n').find((l) => l.trim()) ?? ''
  return firstLine || 'Untitled'
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
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10"
      style={wrapperStyle}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/notes"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← Notes
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
        </div>
        <span className="text-xs text-zinc-500">Auto-deleted after 30 days</span>
      </header>

      {notes.length === 0 ? (
        <p className="text-sm text-zinc-500">Trash is empty.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-black/10 rounded-md border border-black/10 dark:divide-white/10 dark:border-white/10">
          {notes.map((note: Note) => {
            const left = note.deleted_at ? daysLeft(note.deleted_at) : 30
            return (
              <li
                key={note.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {previewOf(note)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    Auto-deletes in {left} day{left === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <form action={restoreNoteAction}>
                    <input type="hidden" name="id" value={note.id} />
                    <button
                      type="submit"
                      className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-black/5 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
                    >
                      Restore
                    </button>
                  </form>
                  <form action={purgeNoteAction}>
                    <input type="hidden" name="id" value={note.id} />
                    <button
                      type="submit"
                      className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-black/5 hover:text-red-600 dark:hover:bg-white/10 dark:hover:text-red-400"
                    >
                      Delete forever
                    </button>
                  </form>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
