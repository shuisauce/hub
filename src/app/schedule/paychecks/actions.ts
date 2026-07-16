'use server'

import { revalidatePath } from 'next/cache'
import {
  setActualHours,
  savePaycheckReceipt,
  deletePaycheckReceipt,
} from '@/lib/schedule-db'
import { requireSession } from '@/lib/session'

/** Save a whole check's time card in one go — every row's actual clocked
 *  hours (null clears back to planned). */
export async function saveTimeCardAction(
  entries: Array<{ date: string; target: 'primary' | 'overlay'; actualH: number | null }>,
): Promise<void> {
  await requireSession()
  for (const e of entries) {
    if (e.actualH != null && (!Number.isFinite(e.actualH) || e.actualH < 0 || e.actualH > 48)) continue
    await setActualHours(e.date, e.target, e.actualH)
  }
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
