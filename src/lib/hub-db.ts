import 'server-only'
import { neon } from '@neondatabase/serverless'

// ---------- Types ----------

export type Bookmark = {
  id: string
  title: string
  url: string
  note: string | null
  pinned_at: string | null
  created_at: string
  updated_at: string
}

export type Countdown = {
  label: string
  /** YYYY-MM-DD */
  target_date: string
  updated_at: string
}

// ---------- Connection ----------

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
        CREATE TABLE IF NOT EXISTS bookmarks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          title text NOT NULL,
          url text NOT NULL,
          note text,
          pinned_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS hub_countdown (
          id integer PRIMARY KEY DEFAULT 1,
          label text NOT NULL DEFAULT '',
          target_date date,
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT hub_countdown_singleton CHECK (id = 1)
        )
      `
    })().catch((err) => {
      schemaPromise = null
      throw err
    })
  }
  return schemaPromise
}

// ---------- Bookmarks ----------

export async function listBookmarks(): Promise<Bookmark[]> {
  await ensureSchema()
  const rows = (await getSql()`
    SELECT id, title, url, note, pinned_at, created_at, updated_at
    FROM bookmarks
    ORDER BY pinned_at DESC NULLS LAST, updated_at DESC
  `) as Bookmark[]
  return rows
}

export async function createBookmark(input: {
  title: string
  url: string
  note: string | null
}): Promise<string> {
  await ensureSchema()
  const rows = (await getSql()`
    INSERT INTO bookmarks (title, url, note)
    VALUES (${input.title}, ${input.url}, ${input.note})
    RETURNING id
  `) as { id: string }[]
  return rows[0].id
}

export async function updateBookmark(
  id: string,
  input: { title: string; url: string; note: string | null },
): Promise<void> {
  await ensureSchema()
  await getSql()`
    UPDATE bookmarks
    SET title = ${input.title}, url = ${input.url}, note = ${input.note}, updated_at = now()
    WHERE id = ${id}
  `
}

export async function deleteBookmark(id: string): Promise<void> {
  await ensureSchema()
  await getSql()`DELETE FROM bookmarks WHERE id = ${id}`
}

export async function pinBookmark(id: string): Promise<void> {
  await ensureSchema()
  await getSql()`UPDATE bookmarks SET pinned_at = now() WHERE id = ${id}`
}

export async function unpinBookmark(id: string): Promise<void> {
  await ensureSchema()
  await getSql()`UPDATE bookmarks SET pinned_at = NULL WHERE id = ${id}`
}

// ---------- Countdown ----------

export async function loadCountdown(): Promise<Countdown | null> {
  await ensureSchema()
  const rows = (await getSql()`
    SELECT label, to_char(target_date, 'YYYY-MM-DD') AS target_date, updated_at
    FROM hub_countdown
    WHERE id = 1 AND target_date IS NOT NULL
  `) as Countdown[]
  return rows[0] ?? null
}

export async function saveCountdown(label: string, targetDate: string): Promise<void> {
  await ensureSchema()
  await getSql()`
    INSERT INTO hub_countdown (id, label, target_date, updated_at)
    VALUES (1, ${label}, ${targetDate}::date, now())
    ON CONFLICT (id) DO UPDATE
      SET label = EXCLUDED.label,
          target_date = EXCLUDED.target_date,
          updated_at = EXCLUDED.updated_at
  `
}

export async function clearCountdown(): Promise<void> {
  await ensureSchema()
  await getSql()`UPDATE hub_countdown SET target_date = NULL, label = '', updated_at = now() WHERE id = 1`
}
