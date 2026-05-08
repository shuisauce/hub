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
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-black/10 bg-white p-5 shadow-lg dark:border-white/10 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Close
          </button>
        </header>

        <section className="mb-5">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Theme
          </label>
          <div className="flex gap-1 rounded-md border border-black/10 p-1 dark:border-white/10">
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => changeTheme(t)}
                className={
                  'flex-1 rounded px-2 py-1 text-sm font-medium transition-colors ' +
                  (theme === t
                    ? 'bg-black text-white dark:bg-white dark:text-black'
                    : 'text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10')
                }
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-5">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Font
          </label>
          <div className="flex gap-1 rounded-md border border-black/10 p-1 dark:border-white/10">
            {(['sans', 'serif', 'mono'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => changeSettings({ ...settings, fontFamily: f })}
                className={
                  'flex-1 rounded px-2 py-1 text-sm font-medium transition-colors ' +
                  (settings.fontFamily === f
                    ? 'bg-black text-white dark:bg-white dark:text-black'
                    : 'text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10')
                }
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Text size
            </label>
            <span className="text-xs text-zinc-500">{settings.fontSize}px</span>
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
            className="w-full"
          />
        </section>
      </div>
    </div>
  )
}

export function NotesSettingsButton({ initial }: { initial: NotesSettings }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
      >
        Settings
      </button>
      {open && <NotesSettingsPopup initial={initial} onClose={() => setOpen(false)} />}
    </>
  )
}
