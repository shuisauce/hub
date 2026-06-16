import Link from 'next/link'
import { listBookmarks } from '@/lib/hub-db'
import { requireSession } from '@/lib/session'
import { AddBookmarkForm } from './add-form'
import { BookmarkRow } from './bookmark-row'
import './bookmarks.css'

export const metadata = { title: 'Bookmarks' }
export const dynamic = 'force-dynamic'

export default async function BookmarksPage() {
  await requireSession()
  const bookmarks = await listBookmarks()

  return (
    <div className="bookmarks-app">
      <main className="container">
        <header className="page-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link href="/" className="crumb">← Hub</Link>
            <h1>Bookmarks</h1>
          </div>
        </header>

        <AddBookmarkForm />

        {bookmarks.length === 0 ? (
          <div className="empty">
            No bookmarks yet. Add one above.
          </div>
        ) : (
          <ul className="bm-list">
            {bookmarks.map((b) => (
              <BookmarkRow key={b.id} bookmark={b} />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
