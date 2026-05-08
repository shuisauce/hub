'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import {
  createVoiceSample as dbCreate,
  deleteVoiceSample as dbDelete,
  setVoiceSamplePinned as dbSetPinned,
  updateVoiceSample as dbUpdate,
  saveEvalSettings as dbSaveSettings,
} from '@/lib/eval-db'
import {
  EVAL_DOMAINS,
  type EvalDomain,
  type EvalLevel,
  type EvalPronoun,
} from '@/lib/eval-types'

function isDomain(v: unknown): v is EvalDomain {
  return typeof v === 'string' && (EVAL_DOMAINS as string[]).includes(v)
}

export async function saveSampleAction(text: string, domain: EvalDomain) {
  await requireSession()
  if (!text.trim()) return
  if (!isDomain(domain)) return
  await dbCreate(text.trim(), domain)
  revalidatePath('/eval')
  revalidatePath('/eval/settings')
}

export async function updateSampleAction(
  id: string,
  text: string,
  domain: EvalDomain,
) {
  await requireSession()
  if (!id || !text.trim()) return
  if (!isDomain(domain)) return
  await dbUpdate(id, text.trim(), domain)
  revalidatePath('/eval/settings')
}

export async function deleteSampleAction(formData: FormData) {
  await requireSession()
  const id = formData.get('id')
  if (typeof id !== 'string') return
  await dbDelete(id)
  revalidatePath('/eval/settings')
}

export async function pinSampleAction(formData: FormData) {
  await requireSession()
  const id = formData.get('id')
  if (typeof id !== 'string') return
  await dbSetPinned(id, true)
  revalidatePath('/eval/settings')
}

export async function unpinSampleAction(formData: FormData) {
  await requireSession()
  const id = formData.get('id')
  if (typeof id !== 'string') return
  await dbSetPinned(id, false)
  revalidatePath('/eval/settings')
}

export async function saveDefaultsAction(level: EvalLevel, pronoun: EvalPronoun) {
  await requireSession()
  if (level !== 'junior' && level !== 'senior') return
  if (pronoun !== 'she' && pronoun !== 'he' && pronoun !== 'they') return
  await dbSaveSettings({ defaultLevel: level, defaultPronoun: pronoun })
  revalidatePath('/eval')
  revalidatePath('/eval/settings')
}
