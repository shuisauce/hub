'use server'

import { revalidatePath } from 'next/cache'
import {
  setActualHours,
  savePaycheckReceipt,
  deletePaycheckReceipt,
} from '@/lib/schedule-db'
import { requireSession } from '@/lib/session'

export async function saveActualHoursAction(
  date: string,
  target: 'primary' | 'overlay',
  actualH: number | null,
): Promise<void> {
  await requireSession()
  if (actualH != null && (!Number.isFinite(actualH) || actualH < 0 || actualH > 48)) return
  await setActualHours(date, target, actualH)
  revalidatePath('/schedule/paychecks')
  revalidatePath('/schedule')
}

export async function saveReceiptAction(input: {
  hosp: string
  periodEnd: string
  receivedOn: string | null
  amountReceived: number | null
}): Promise<void> {
  await requireSession()
  if (!input.hosp || !input.periodEnd) return
  if (input.receivedOn == null && input.amountReceived == null) {
    await deletePaycheckReceipt(input.hosp, input.periodEnd)
  } else {
    await savePaycheckReceipt(input)
  }
  revalidatePath('/schedule/paychecks')
}

export async function clearReceiptAction(hosp: string, periodEnd: string): Promise<void> {
  await requireSession()
  await deletePaycheckReceipt(hosp, periodEnd)
  revalidatePath('/schedule/paychecks')
}
