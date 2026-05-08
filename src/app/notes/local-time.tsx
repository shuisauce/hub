'use client'

import { useEffect, useState } from 'react'

/**
 * Renders an ISO timestamp in the user's local timezone. Empty during SSR
 * (because the server doesn't know the user's TZ) and fills in on mount.
 */
export function LocalTime({ iso, withTime = true }: { iso: string; withTime?: boolean }) {
  const [text, setText] = useState<string>('')
  useEffect(() => {
    const opts: Intl.DateTimeFormatOptions = withTime
      ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
    setText(new Date(iso).toLocaleString(undefined, opts))
  }, [iso, withTime])
  return <span suppressHydrationWarning>{text}</span>
}
