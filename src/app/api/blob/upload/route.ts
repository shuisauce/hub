import { NextResponse, type NextRequest } from 'next/server'
import { put } from '@vercel/blob'
import { readSession } from '@/lib/session'

export const runtime = 'nodejs'

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/svg+xml',
])

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(request: NextRequest) {
  if (!(await readSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          'BLOB_READ_WRITE_TOKEN is not configured. In Vercel, create a Blob store under Storage → it sets this env var automatically.',
      },
      { status: 500 },
    )
  }

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported type: ${file.type}` }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 })
  }

  const ext = (file.type.split('/')[1] || 'bin').replace('+xml', '').replace('jpeg', 'jpg')
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  const path = `notes/${stamp}-${rand}.${ext}`

  const blob = await put(path, file, {
    access: 'public',
    contentType: file.type,
  })
  return NextResponse.json({ url: blob.url })
}
