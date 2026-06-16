'use client'

import { useState } from 'react'
import type { Bookmark } from '@/lib/hub-db'
import {
  deleteBookmarkAction,
  pinBookmarkAction,
  unpinBookmarkAction,
  updateBookmarkAction,
} from './actions'

export function BookmarkRow({ bookmark }: { bookmark: Bookmark }) {
  const [editing, setEditing] = useState(false)
  const isPinned = !!bookmark.pinned_at

  if (editing) {
    return (
      <li className="bm-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <form
          action={async (fd) => {
            await updateBookmarkAction(fd)
            setEditing(false)
          }}
          className="add-form"
          style={{ border: 'none', padding: 0, background: 'transparent' }}
        >
          <input type="hidden" name="id" value={bookmark.id} />
          <input
            type="text"
            name="title"
            defaultValue={bookmark.title}
            placeholder="Title"
            required
            autoFocus
          />
          <input
            type="url"
            name="url"
            defaultValue={bookmark.url}
            placeholder="https://…"
            required
          />
          <input
            type="text"
            name="note"
            defaultValue={bookmark.note ?? ''}
            placeholder="Note (optional)"
            className="full"
          />
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => setEditing(false)}
              style={{ marginRight: 8 }}
            >
              Cancel
            </button>
            <button type="submit" className="btn primary">Save</button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="bm-row">
      <div className="bm-main">
        <a
          href={bookmark.url}
          target="_blank"
          rel="noopener noreferrer"
          className="bm-title"
        >
          {isPinned && <span className="pin" aria-hidden title="Pinned">📌</span>}
          {bookmark.title}
        </a>
        <span className="bm-url">{bookmark.url}</span>
        {bookmark.note && <span className="bm-note">{bookmark.note}</span>}
      </div>
      <div className="bm-actions">
        <form action={isPinned ? unpinBookmarkAction : pinBookmarkAction}>
          <input type="hidden" name="id" value={bookmark.id} />
          <button type="submit" className="row-btn" title={isPinned ? 'Unpin' : 'Pin to top'}>
            {isPinned ? 'Unpin' : 'Pin'}
          </button>
        </form>
        <button
          type="button"
          className="row-btn"
          onClick={() => setEditing(true)}
          title="Edit"
        >
          Edit
        </button>
        <form
          action={deleteBookmarkAction}
          onSubmit={(e) => {
            if (!window.confirm(`Delete "${bookmark.title}"?`)) e.preventDefault()
          }}
        >
          <input type="hidden" name="id" value={bookmark.id} />
          <button type="submit" className="row-btn danger" title="Delete">
            Delete
          </button>
        </form>
      </div>
    </li>
  )
}
