'use client'

import { useRef } from 'react'
import { createBookmarkAction } from './actions'

export function AddBookmarkForm() {
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <form
      ref={formRef}
      className="add-form"
      action={async (fd) => {
        await createBookmarkAction(fd)
        formRef.current?.reset()
      }}
    >
      <input
        type="text"
        name="title"
        placeholder="Title"
        required
      />
      <input
        type="url"
        name="url"
        placeholder="https://… (or just example.com)"
        required
      />
      <input
        type="text"
        name="note"
        placeholder="Note (optional)"
        className="full"
      />
      <div className="actions">
        <button type="submit" className="btn primary">Add bookmark</button>
      </div>
    </form>
  )
}
