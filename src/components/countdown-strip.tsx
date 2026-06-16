'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveCountdownAction, clearCountdownAction } from '@/app/bookmarks/actions'

type Props = {
  initial: { label: string; target_date: string } | null
}

/** Days between today (local) and `targetKey` (YYYY-MM-DD, interpreted in
 *  local time). Negative = past. */
function daysUntil(targetKey: string): number {
  if (!targetKey) return 0
  const [y, m, d] = targetKey.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  target.setHours(0, 0, 0, 0)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const ms = target.getTime() - now.getTime()
  return Math.round(ms / 86_400_000)
}

function formatTarget(targetKey: string): string {
  const [y, m, d] = targetKey.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function CountdownStrip({ initial }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  // Re-render once on mount so the date math runs client-side in the user's
  // timezone (avoids hydration mismatch from rendering "X days" with UTC).
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!mounted) {
    // Reserve the space but render an opaque placeholder so the layout
    // doesn't shift when client math kicks in.
    return <div style={{ minHeight: 56 }} />
  }

  if (!initial) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            background: 'transparent',
            border: '1px dashed rgba(0,0,0,0.2)',
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: 13,
            color: '#71717a',
            cursor: 'pointer',
            textAlign: 'left',
          }}
          className="countdown-add"
        >
          + Set a countdown
        </button>
        {open && <CountdownModal initial={null} onClose={() => setOpen(false)} router={router} />}
      </>
    )
  }

  const days = daysUntil(initial.target_date)
  const past = days < 0
  const dayWord = Math.abs(days) === 1 ? 'day' : 'days'
  const dayPhrase =
    days === 0 ? 'today' :
    days === 1 ? 'tomorrow' :
    past ? `${Math.abs(days)} ${dayWord} ago` :
    `in ${days} ${dayWord}`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'rgba(0,0,0,0.04)',
          border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: 10,
          padding: '12px 16px',
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          width: '100%',
          color: 'inherit',
        }}
        className="countdown-strip"
        title="Click to edit"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 13, color: '#71717a' }}>{dayPhrase}</span>
          <span style={{
            fontSize: 16,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {initial.label}
          </span>
        </div>
        <div style={{
          fontSize: 28,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          opacity: past ? 0.5 : 1,
          flexShrink: 0,
        }}>
          {past ? days : `+${days}`}
        </div>
      </button>
      <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 4, paddingLeft: 4 }}>
        {formatTarget(initial.target_date)}
      </div>
      {open && (
        <CountdownModal
          initial={initial}
          onClose={() => setOpen(false)}
          router={router}
        />
      )}
    </>
  )
}

function CountdownModal({
  initial,
  onClose,
  router,
}: {
  initial: { label: string; target_date: string } | null
  onClose: () => void
  router: ReturnType<typeof useRouter>
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--background, #fff)',
          color: 'var(--foreground, #18181b)',
          borderRadius: 12,
          padding: 20,
          width: '100%',
          maxWidth: 380,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        className="countdown-modal"
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Countdown</h3>
        <form
          action={async (fd) => {
            await saveCountdownAction(fd)
            onClose()
            router.refresh()
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#71717a' }}>
            Label
            <input
              type="text"
              name="label"
              required
              defaultValue={initial?.label ?? ''}
              placeholder="e.g. Hawaii trip"
              autoFocus
              style={{
                padding: '8px 10px',
                border: '1px solid rgba(0,0,0,0.15)',
                borderRadius: 6,
                fontSize: 14,
                background: 'transparent',
                color: 'inherit',
              }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#71717a' }}>
            Date
            <input
              type="date"
              name="target_date"
              required
              defaultValue={initial?.target_date ?? ''}
              style={{
                padding: '8px 10px',
                border: '1px solid rgba(0,0,0,0.15)',
                borderRadius: 6,
                fontSize: 14,
                background: 'transparent',
                color: 'inherit',
              }}
            />
          </label>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            {initial ? (
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm('Clear this countdown?')) return
                  await clearCountdownAction()
                  onClose()
                  router.refresh()
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#dc2626',
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: '6px 2px',
                }}
              >
                Clear
              </button>
            ) : <span />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(0,0,0,0.15)',
                  borderRadius: 6,
                  padding: '8px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{
                  background: '#18181b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
