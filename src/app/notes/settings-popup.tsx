'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { NotesSettings } from '@/lib/db'
import { saveNotesSettingsAction } from './actions'

type Theme = 'system' | 'light' | 'dark'

function readThemeFromDom(): Theme {
  if (typeof document === 'undefined') return 'system'
  const cookie = document.cookie.split('; ').find((c) => c.startsWith('theme='))
  const v = cookie ? decodeURIComponent(cookie.split('=')[1]) : ''
  if (v === 'light' || v === 'dark') return v
  return 'system'
}

function applyThemeToHtml(theme: Theme) {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  if (theme === 'light') root.classList.add('light')
  else if (theme === 'dark') root.classList.add('dark')
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) root.classList.add('dark')
}

export function NotesSettingsPopup({
  initial, onClose,
}: {
  initial: NotesSettings
  onClose: () => void
}) {
  const [theme, setTheme] = useState<Theme>(readThemeFromDom())
  const [settings, setSettings] = useState<NotesSettings>(initial)
  const [, startSaving] = useTransition()
  const router = useRouter()

  useEffect(() => { applyThemeToHtml(theme) }, [theme])

  async function changeTheme(next: Theme) {
    setTheme(next)
    applyThemeToHtml(next)
    try {
      await fetch('/api/auth/set-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: next }),
      })
    } catch {
      // ignore — DOM is updated optimistically; cookie persistence will retry on next interaction
    }
  }

  function changeSettings(next: NotesSettings) {
    setSettings(next)
    startSaving(() => {
      saveNotesSettingsAction(next).then(() => router.refresh())
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button type="button" onClick={onClose} className="iconbtn" title="Close">✕</button>
        </div>

        <div className="modal-body">
          <section className="modal-section">
            <span className="modal-label">Theme</span>
            <div className="seg">
              {(['system', 'light', 'dark'] as Theme[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => changeTheme(t)}
                  className={theme === t ? 'active' : ''}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </section>

          <section className="modal-section">
            <span className="modal-label">Font</span>
            <div className="seg">
              {(['sans', 'serif', 'mono'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => changeSettings({ ...settings, fontFamily: f })}
                  className={settings.fontFamily === f ? 'active' : ''}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </section>

          <section className="modal-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span className="modal-label" style={{ marginBottom: 0 }}>Text size</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' }}>
                {settings.fontSize}px
              </span>
            </div>
            <input
              type="range"
              min={12}
              max={28}
              step={1}
              value={settings.fontSize}
              onChange={(e) =>
                changeSettings({ ...settings, fontSize: Number(e.target.value) })
              }
              style={{ width: '100%' }}
            />
          </section>
        </div>
      </div>
    </div>
  )
}

export function NotesSettingsButton({ initial }: { initial: NotesSettings }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn">
        Settings
      </button>
      {open && <NotesSettingsPopup initial={initial} onClose={() => setOpen(false)} />}
    </>
  )
}
