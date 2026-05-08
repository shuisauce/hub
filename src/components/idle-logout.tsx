'use client'

import { useEffect, useRef } from 'react'

const IDLE_MS = 10 * 60 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const

/**
 * Logs the user out after 10 minutes of no input. The server enforces the same
 * limit via the session cookie's expiry, so this component is just a UX
 * convenience — when it fires the user is bounced to /login and any pending
 * server requests would have failed anyway.
 */
export function IdleLogout() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(async () => {
        try {
          await fetch('/api/auth/logout', { method: 'POST' })
        } catch {
          // ignore — we're redirecting anyway
        }
        window.location.href = '/login'
      }, IDLE_MS)
    }

    const opts: AddEventListenerOptions = { passive: true }
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, reset, opts)
    reset()

    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, reset)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return null
}
