import 'server-only'
import { neon } from '@neondatabase/serverless'

export type Note = {
  id: string
  title: string
  content: string
  created_at: string
  updated_at: string
}

let cachedSql: ReturnType<typeof neon> | null = null
function getSql() {
  if (cachedSql) return cachedSql
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL env var is required')
  cachedSql = neon(url)
  return cachedSql
}

let schemaPromise: Promise<void> | null = null
function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql()
      await sql`
        CREATE TABLE IF NOT EXISTS notes (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          title text NOT NULL DEFAULT '',
          content text NOT NULL DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `
    })().catch((err) => {
      schemaPromise = null
      throw err
    })
  }
  return schemaPromise
}

export async function listNotes(): Promise<Note[]> {
  await ensureSchema()
  const rows = (await getSql()`
    SELECT id, title, content, created_at, updated_at
    FROM notes
    ORDER BY updated_at DESC
  `) as Note[]
  return rows
}

export async function getNote(id: string): Promise<Note | null> {
  await ensureSchema()
  const rows = (await getSql()`
    SELECT id, title, content, created_at, updated_at
    FROM notes WHERE id = ${id}
  `) as Note[]
  return rows[0] ?? null
}

export async function createNote(): Promise<string> {
  await ensureSchema()
  const rows = (await getSql()`
    INSERT INTO notes (title, content) VALUES ('', '') RETURNING id
  `) as { id: string }[]
  return rows[0].id
}

export async function updateNote(
  id: string,
  title: string,
  content: string,
): Promise<void> {
  await ensureSchema()
  await getSql()`
    UPDATE notes
    SET title = ${title}, content = ${content}, updated_at = now()
    WHERE id = ${id}
  `
}

export async function deleteNote(id: string): Promise<void> {
  await ensureSchema()
  await getSql()`DELETE FROM notes WHERE id = ${id}`
}
