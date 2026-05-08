import { notFound } from 'next/navigation'
import { getNote, loadNotesSettings } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { Editor } from './editor'

export const metadata = { title: 'Edit note' }
export const dynamic = 'force-dynamic'

const FONT_FAMILIES: Record<'sans' | 'serif' | 'mono', string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
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
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10"
      style={wrapperStyle}
    >
      <Editor note={note} fontSize={settings.fontSize} />
    </main>
  )
}
