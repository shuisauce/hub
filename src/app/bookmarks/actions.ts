'use server'

import { revalidatePath } from 'next/cache'
import {
  createBookmark as dbCreateBookmark,
  deleteBookmark as dbDeleteBookmark,
  pinBookmark as dbPinBookmark,
  unpinBookmark as dbUnpinBookmark,
  updateBookmark as dbUpdateBookmark,
  saveCountdown as dbSaveCountdown,
  clearCountdown as dbClearCountdown,
} from '@/lib/hub-db'
import { requireSession } from '@/lib/session'

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return 'https://' + trimmed
}

export async function createBookmarkAction(formData: FormData) {
  await requireSession()
  const title = String(formData.get('title') ?? '').trim()
  const url = normalizeUrl(String(formData.get('url') ?? ''))
  const noteRaw = String(formData.get('note') ?? '').trim()
  const note = noteRaw === '' ? null : noteRaw
  if (!title || !url) return
  await dbCreateBookmark({ title, url, note })
  revalidatePath('/bookmarks')
}

export async function updateBookmarkAction(formData: FormData) {
  await requireSession()
  const id = String(formData.get('id') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const url = normalizeUrl(String(formData.get('url') ?? ''))
  const noteRaw = String(formData.get('note') ?? '').trim()
  const note = noteRaw === '' ? null : noteRaw
  if (!id || !title || !url) return
  await dbUpdateBookmark(id, { title, url, note })
  revalidatePath('/bookmarks')
}

export async function deleteBookmarkAction(formData: FormData) {
  await requireSession()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await dbDeleteBookmark(id)
  revalidatePath('/bookmarks')
}

export async function pinBookmarkAction(formData: FormData) {
  await requireSession()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await dbPinBookmark(id)
  revalidatePath('/bookmarks')
}

export async function unpinBookmarkAction(formData: FormData) {
  await requireSession()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await dbUnpinBookmark(id)
  revalidatePath('/bookmarks')
}

// Countdown lives on the hub homepage, but its server actions live with the
// other "hub-level" actions here. Keeping them close to the rest of the
// homepage data layer avoids spinning up a `src/app/actions.ts`.

export async function saveCountdownAction(formData: FormData) {
  await requireSession()
  const label = String(formData.get('label') ?? '').trim()
  const target = String(formData.get('target_date') ?? '').trim()
  if (!label || !target) return
  await dbSaveCountdown(label, target)
  revalidatePath('/')
}

export async function clearCountdownAction() {
  await requireSession()
  await dbClearCountdown()
  revalidatePath('/')
}
