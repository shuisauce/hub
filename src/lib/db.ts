import 'server-only'
import { neon } from '@neondatabase/serverless'

export type Note = {
  id: string
  title: string
  content: string
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export type NotesSettings = {
  fontSize: number
  fontFamily: 'sans' | 'serif' | 'mono'
}

export const DEFAULT_NOTES_SETTINGS: NotesSettings = {
  fontSize: 16,
  fontFamily: 'sans',
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
      await sql`ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at timestamptz`
      await sql`CREATE INDEX IF NOT EXISTS notes_deleted_at_idx ON notes(deleted_at)`
      await sql`
        CREATE TABLE IF NOT EXISTS notes_settings (
          id integer PRIMARY KEY DEFAULT 1,
          data jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT notes_settings_singleton CHECK (id = 1)
        )
      `
    })().catch((err) => {
      schemaPromise = null
      throw err
    })
  }
  return schemaPromise
}

// Lazy purge: on every trash listing, delete notes that have been soft-deleted
// for more than 30 days. Cheap (one DELETE) and avoids needing a cron.
async function purgeExpiredTrash() {
  await getSql()`DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'`
}

export async function listNotes(): Promise<Note[]> {
  await ensureSchema()
  const rows = (await getSql()`
    SELECT id, title, content, created_at, updated_at
    FROM notes
    WHERE deleted_at IS NULL
    ORDER BY updated_at DESC
  `) as Note[]
  return rows
}

export async function listTrash(): Promise<Note[]> {
  await ensureSchema()
  await purgeExpiredTrash()
  const rows = (await getSql()`
    SELECT id, title, content, created_at, updated_at, deleted_at
    FROM notes
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `) as Note[]
  return rows
}

export async function getNote(id: string): Promise<Note | null> {
  await ensureSchema()
  const rows = (await getSql()`
    SELECT id, title, content, created_at, updated_at, deleted_at
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
    WHERE id = ${id} AND deleted_at IS NULL
  `
}

// Soft delete — moves to trash. The lazy purge in listTrash() removes rows
// older than 30 days the next time the trash is opened.
export async function softDeleteNote(id: string): Promise<void> {
  await ensureSchema()
  await getSql()`UPDATE notes SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL`
}

export async function restoreNote(id: string): Promise<void> {
  await ensureSchema()
  await getSql()`UPDATE notes SET deleted_at = NULL WHERE id = ${id}`
}

export async function purgeNote(id: string): Promise<void> {
  await ensureSchema()
  await getSql()`DELETE FROM notes WHERE id = ${id}`
}

export async function loadNotesSettings(): Promise<NotesSettings> {
  await ensureSchema()
  const rows = (await getSql()`SELECT data FROM notes_settings WHERE id = 1`) as { data: Partial<NotesSettings> }[]
  return { ...DEFAULT_NOTES_SETTINGS, ...(rows[0]?.data ?? {}) } as NotesSettings
}

export async function saveNotesSettings(settings: NotesSettings): Promise<void> {
  await ensureSchema()
  await getSql()`
    INSERT INTO notes_settings (id, data, updated_at)
    VALUES (1, ${JSON.stringify(settings)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE
      SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
  `
}
