'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { saveNoteAction } from '../actions'
import type { Note } from '@/lib/db'
import './editor.css'

const AUTOSAVE_MS = 600

type Status = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'

// Plain-text notes saved before rich text was added arrive here as raw text
// rather than HTML. Detect that and wrap each line in <p> so newlines survive.
function toEditorContent(raw: string): string {
  if (!raw) return ''
  if (/<[a-z][^>]*>/i.test(raw)) return raw
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return raw
    .split('\n')
    .map((line) => (line ? `<p>${esc(line)}</p>` : '<p></p>'))
    .join('')
}

async function uploadImage(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/blob/upload', { method: 'POST', body: fd })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error || `Upload failed (${res.status})`)
  }
  const json = (await res.json()) as { url: string }
  return json.url
}

function ToolbarButton({
  onClick, active, disabled, title, children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={
        'min-w-[28px] rounded px-2 py-1 text-sm font-medium transition-colors disabled:opacity-40 ' +
        (active
          ? 'bg-black text-white dark:bg-white dark:text-black'
          : 'text-zinc-700 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10')
      }
    >
      {children}
    </button>
  )
}

function Toolbar({
  editor, uploadStatus,
}: {
  editor: TiptapEditor | null
  uploadStatus: string | null
}) {
  if (!editor) return <div className="h-9" />
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-black/10 bg-[var(--background)] px-1 py-1.5 dark:border-white/10">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        title="Bold (⌘B)"
      >
        <span className="font-bold">B</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        title="Italic (⌘I)"
      >
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive('underline')}
        title="Underline (⌘U)"
      >
        <span className="underline">U</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')}
        title="Strikethrough"
      >
        <span className="line-through">S</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive('code')}
        title="Inline code"
      >
        <span className="font-mono text-xs">{'<>'}</span>
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive('heading', { level: 1 })}
        title="Heading 1"
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
        title="Heading 2"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        title="Bullet list"
      >
        •
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        title="Numbered list"
      >
        1.
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
        title="Quote"
      >
        &ldquo;
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" />
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (⌘Z)"
      >
        ↶
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (⌘⇧Z)"
      >
        ↷
      </ToolbarButton>
      {uploadStatus && (
        <span
          className={
            'ml-auto text-xs ' +
            (uploadStatus.startsWith('Upload failed') ||
            uploadStatus.startsWith("Couldn't") ||
            uploadStatus.startsWith('Drag had')
              ? 'text-red-600 dark:text-red-400'
              : 'text-zinc-500')
          }
        >
          {uploadStatus}
        </span>
      )}
    </div>
  )
}

export function Editor({ note, fontSize }: { note: Note; fontSize: number }) {
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState<string>(toEditorContent(note.content))
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const router = useRouter()

  const lastSaved = useRef({ title: note.title, content: toEditorContent(note.content) })
  const inFlight = useRef<Promise<void> | null>(null)
  const pending = useRef(false)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Image.configure({ allowBase64: false, inline: false }),
      Placeholder.configure({ placeholder: 'Write something…' }),
    ],
    content: content,
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none',
        style: `font-size: ${fontSize}px;`,
      },
      handlePaste(_view, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (file) {
              event.preventDefault()
              void handleImageUpload(file)
              return true
            }
          }
        }
        return false
      },
      handleDrop(_view, event, _slice, moved) {
        if (moved) return false
        const dt = event.dataTransfer
        if (!dt) return false
        // Iterate over .items first — more reliable than .files for drags from
        // some apps (e.g. macOS Photos) where the file is exposed only as an
        // item but not in the files list.
        if (dt.items && dt.items.length > 0) {
          for (let i = 0; i < dt.items.length; i++) {
            const it = dt.items[i]
            if (it.kind === 'file' && it.type.startsWith('image/')) {
              const file = it.getAsFile()
              if (file) {
                event.preventDefault()
                void handleImageUpload(file)
                return true
              }
            }
          }
        }
        if (dt.files && dt.files.length > 0) {
          for (const file of Array.from(dt.files)) {
            if (file.type.startsWith('image/')) {
              event.preventDefault()
              void handleImageUpload(file)
              return true
            }
          }
        }
        // Photos.app sometimes only provides the URL of an exported image. Fetch and upload it.
        const url = dt.getData('text/uri-list') || dt.getData('url') || dt.getData('text/plain')
        if (url && /^https?:\/\/.+\.(png|jpe?g|gif|webp|heic|svg)/i.test(url)) {
          event.preventDefault()
          void (async () => {
            try {
              const res = await fetch(url)
              const blob = await res.blob()
              const ext = blob.type.split('/')[1] || 'png'
              await handleImageUpload(new File([blob], `dropped.${ext}`, { type: blob.type }))
            } catch (err) {
              setUploadStatus(
                `Couldn't fetch dropped image: ${err instanceof Error ? err.message : 'unknown'}`,
              )
              setTimeout(() => setUploadStatus(null), 5000)
            }
          })()
          return true
        }
        // Nothing usable — surface a hint instead of silently doing nothing.
        const types = dt.types ? Array.from(dt.types).join(', ') : '(none)'
        setUploadStatus(
          `Drag had no file. macOS Photos often doesn't expose images via drag — copy & paste (⌘V) instead. (types: ${types})`,
        )
        setTimeout(() => setUploadStatus(null), 8000)
        return false
      },
    },
    onUpdate({ editor: ed }) {
      setContent(ed.getHTML())
    },
  })

  async function handleImageUpload(file: File) {
    if (!editor) return
    setUploadStatus(`Uploading ${file.name || 'image'}…`)
    try {
      const url = await uploadImage(file)
      editor.chain().focus().setImage({ src: url, alt: file.name }).run()
      setUploadStatus(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setUploadStatus(`Upload failed: ${msg}`)
      setTimeout(() => setUploadStatus(null), 8000)
    }
  }

  async function flush() {
    if (inFlight.current) {
      pending.current = true
      return
    }
    const snapshotTitle = title
    const snapshotContent = content
    if (
      snapshotTitle === lastSaved.current.title &&
      snapshotContent === lastSaved.current.content
    ) {
      setStatus('saved')
      return
    }
    setStatus('saving')
    setError(null)
    inFlight.current = (async () => {
      try {
        await saveNoteAction(note.id, snapshotTitle, snapshotContent)
        lastSaved.current = { title: snapshotTitle, content: snapshotContent }
        setStatus((s) => (s === 'saving' ? 'saved' : s))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed')
        setStatus('error')
      } finally {
        inFlight.current = null
        if (pending.current) {
          pending.current = false
          flush()
        }
      }
    })()
  }

  const flushRef = useRef(flush)
  flushRef.current = flush

  const dirty =
    title !== lastSaved.current.title || content !== lastSaved.current.content

  useEffect(() => {
    if (!dirty) return
    setStatus('unsaved')
    const timer = setTimeout(() => flushRef.current(), AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [title, content, dirty])

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (
        title !== lastSaved.current.title ||
        content !== lastSaved.current.content ||
        inFlight.current
      ) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        flushRef.current()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('keydown', onKey)
    }
  }, [title, content])

  let label = ''
  if (status === 'saving') label = 'Saving…'
  else if (status === 'unsaved') label = 'Unsaved changes'
  else if (status === 'saved') label = 'Saved'
  else if (status === 'error') label = error ? `Error: ${error}` : 'Error'

  async function backToList() {
    await flushRef.current()
    router.push('/notes')
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={backToList}
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← All notes
        </button>
        <span
          className={
            status === 'error'
              ? 'text-xs text-red-600 dark:text-red-400'
              : 'text-xs text-zinc-500'
          }
        >
          {label}
        </span>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full bg-transparent font-semibold tracking-tight outline-none placeholder:text-zinc-400"
        style={{ fontSize: `${Math.round(fontSize * 1.5)}px` }}
      />

      <Toolbar editor={editor} uploadStatus={uploadStatus} />

      <div className="flex-1 min-h-0">
        <EditorContent editor={editor} className="tiptap-wrapper h-full" />
      </div>
    </div>
  )
}
