import { notFound } from 'next/navigation'
import { getNote } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { Editor } from './editor'

export const metadata = { title: 'Edit note' }
export const dynamic = 'force-dynamic'

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireSession()
  const { id } = await params
  const note = await getNote(id)
  if (!note) notFound()

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <Editor note={note} />
    </main>
  )
}
