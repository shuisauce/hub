'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import {
  type ScheduleSettings,
  type ShiftEntry,
  clearMonthEntries,
  getOrCreateIcalToken,
  saveSettings,
  syncEntries,
} from '@/lib/schedule-db'

export async function syncEntriesAction(
  upserts: Array<{ date: string; data: ShiftEntry }>,
  deletes: string[],
): Promise<void> {
  await requireSession()
  await syncEntries(upserts, deletes)
  revalidatePath('/schedule')
}

export async function saveSettingsAction(settings: ScheduleSettings): Promise<void> {
  await requireSession()
  await saveSettings(settings)
  revalidatePath('/schedule')
}

export async function clearMonthAction(year: number, month: number): Promise<void> {
  await requireSession()
  await clearMonthEntries(year, month)
  revalidatePath('/schedule')
}

export async function getIcalTokenAction(): Promise<string> {
  await requireSession()
  return getOrCreateIcalToken()
}
