'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  createNote as dbCreateNote,
  pinNote as dbPinNote,
  purgeNote as dbPurgeNote,
  restoreNote as dbRestoreNote,
  saveNotesSettings as dbSaveNotesSettings,
  softDeleteNote as dbSoftDeleteNote,
  unpinNote as dbUnpinNote,
  updateNote as dbUpdateNote,
  type NotesSettings,
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
  await dbSoftDeleteNote(id)
  revalidatePath('/notes')
  revalidatePath('/notes/trash')
}

export async function restoreNoteAction(formData: FormData) {
  await requireSession()
  const id = formData.get('id')
  if (typeof id !== 'string') return
  await dbRestoreNote(id)
  revalidatePath('/notes')
  revalidatePath('/notes/trash')
}

export async function purgeNoteAction(formData: FormData) {
  await requireSession()
  const id = formData.get('id')
  if (typeof id !== 'string') return
  await dbPurgeNote(id)
  revalidatePath('/notes/trash')
}

export async function pinNoteAction(formData: FormData) {
  await requireSession()
  const id = formData.get('id')
  if (typeof id !== 'string') return
  await dbPinNote(id)
  revalidatePath('/notes')
}

export async function unpinNoteAction(formData: FormData) {
  await requireSession()
  const id = formData.get('id')
  if (typeof id !== 'string') return
  await dbUnpinNote(id)
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

export async function saveNotesSettingsAction(settings: NotesSettings) {
  await requireSession()
  await dbSaveNotesSettings(settings)
  revalidatePath('/notes')
}
