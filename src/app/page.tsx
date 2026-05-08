import Link from 'next/link'
import { requireSession, clearSession } from '@/lib/session'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

async function signOutAction() {
  'use server'
  await clearSession()
  redirect('/login')
}

export default async function HubPage() {
  await requireSession()

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Hub</h1>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Sign out
          </button>
        </form>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/notes"
          className="flex flex-col gap-1 rounded-lg border border-black/10 p-6 transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          <h2 className="font-medium">Notes</h2>
          <p className="text-sm text-zinc-500">
            A synced notepad — open it on any device.
          </p>
        </Link>

        <Link
          href="/schedule"
          className="flex flex-col gap-1 rounded-lg border border-black/10 p-6 transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          <h2 className="font-medium">Schedule</h2>
          <p className="text-sm text-zinc-500">
            Shifts, hospitals, pace toward your annual goal. Subscribes to your calendar.
          </p>
        </Link>

        <Link
          href="/eval"
          className="flex flex-col gap-1 rounded-lg border border-black/10 p-6 transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          <h2 className="font-medium">Eval</h2>
          <p className="text-sm text-zinc-500">
            Drop end-of-day notes, get six polished EASI comment blocks in your voice.
          </p>
        </Link>

        <div className="flex cursor-not-allowed flex-col gap-1 rounded-lg border border-black/10 p-6 opacity-60 dark:border-white/10">
          <h2 className="font-medium">Drive</h2>
          <p className="text-sm text-zinc-500">Coming in Phase 3</p>
        </div>
      </div>
    </main>
  )
}
