import { notFound } from 'next/navigation'
import { getNote, loadNotesSettings } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { Editor } from './editor'
import '../notes.css'

export const metadata = { title: 'Edit note' }
export const dynamic = 'force-dynamic'

const FONT_FAMILIES: Record<'sans' | 'serif' | 'mono', string> = {
  sans: 'var(--font-geist-sans), \'Inter\', -apple-system, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'var(--font-geist-mono), \'JetBrains Mono\', ui-monospace, monospace',
}

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireSession()
  const { id } = await params
  const [note, settings] = await Promise.all([getNote(id), loadNotesSettings()])
  if (!note || note.deleted_at) notFound()

  const wrapperStyle = {
    fontFamily: FONT_FAMILIES[settings.fontFamily],
    fontSize: `${settings.fontSize}px`,
  }

  return (
    <div className="notes-app">
      <main className="container" style={wrapperStyle}>
        <Editor note={note} fontSize={settings.fontSize} />
      </main>
    </div>
  )
}
