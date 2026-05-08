'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  createNote as dbCreateNote,
  deleteNote as dbDeleteNote,
  updateNote as dbUpdateNote,
} from '@/lib/db'
import { requireSession } from '@/lib/session'

export async function createNoteAction() {
  await requireSession()
  const id = await dbCreateNote()
  revalidatePath('/notes')
  redirect(`/notes/${id}`)
}

export async function deleteNoteAction(formData: FormData) {
  await requireSession()
  const id = formData.get('id')
  if (typeof id !== 'string') return
  await dbDeleteNote(id)
  revalidatePath('/notes')
}

export async function saveNoteAction(
  id: string,
  title: string,
  content: string,
) {
  await requireSession()
  await dbUpdateNote(id, title, content)
  revalidatePath('/notes')
  revalidatePath(`/notes/${id}`)
}
