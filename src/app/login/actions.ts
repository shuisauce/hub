'use server'

import bcrypt from 'bcryptjs'
import { redirect } from 'next/navigation'
import { createSession } from '@/lib/session'

export type LoginState = { error?: string } | undefined

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const hash = process.env.APP_PASSWORD_HASH
  if (!hash) return { error: 'APP_PASSWORD_HASH is not configured on the server.' }

  const password = formData.get('password')
  if (typeof password !== 'string' || !(await bcrypt.compare(password, hash))) {
    return { error: 'Incorrect password.' }
  }

  await createSession()
  redirect('/')
}
