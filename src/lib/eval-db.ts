import 'server-only'
import { neon } from '@neondatabase/serverless'
import {
  DEFAULT_EVAL_SETTINGS,
  type EvalDomain,
  type EvalSettings,
  type VoiceSample,
} from './eval-types'

export type { EvalDomain, EvalSettings, VoiceSample } from './eval-types'

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
        CREATE TABLE IF NOT EXISTS voice_samples (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          text text NOT NULL,
          domain text NOT NULL DEFAULT 'general',
          pinned boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `
      await sql`CREATE INDEX IF NOT EXISTS voice_samples_pinned_idx ON voice_samples(pinned)`
      await sql`
        CREATE TABLE IF NOT EXISTS eval_settings (
          id integer PRIMARY KEY DEFAULT 1,
          data jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT eval_settings_singleton CHECK (id = 1)
        )
      `
    })().catch((err) => {
      schemaPromise = null
      throw err
    })
  }
  return schemaPromise
}

export async function listVoiceSamples(): Promise<VoiceSample[]> {
  await ensureSchema()
  const rows = (await getSql()`
    SELECT id, text, domain, pinned, created_at
    FROM voice_samples
    ORDER BY pinned DESC, created_at DESC
  `) as VoiceSample[]
  return rows
}

export async function createVoiceSample(
  text: string,
  domain: EvalDomain,
): Promise<string> {
  await ensureSchema()
  const rows = (await getSql()`
    INSERT INTO voice_samples (text, domain) VALUES (${text}, ${domain}) RETURNING id
  `) as { id: string }[]
  return rows[0].id
}

export async function updateVoiceSample(
  id: string,
  text: string,
  domain: EvalDomain,
): Promise<void> {
  await ensureSchema()
  await getSql()`
    UPDATE voice_samples SET text = ${text}, domain = ${domain} WHERE id = ${id}
  `
}

export async function deleteVoiceSample(id: string): Promise<void> {
  await ensureSchema()
  await getSql()`DELETE FROM voice_samples WHERE id = ${id}`
}

export async function setVoiceSamplePinned(id: string, pinned: boolean): Promise<void> {
  await ensureSchema()
  await getSql()`UPDATE voice_samples SET pinned = ${pinned} WHERE id = ${id}`
}

export async function loadEvalSettings(): Promise<EvalSettings> {
  await ensureSchema()
  const rows = (await getSql()`SELECT data FROM eval_settings WHERE id = 1`) as {
    data: Partial<EvalSettings>
  }[]
  return { ...DEFAULT_EVAL_SETTINGS, ...(rows[0]?.data ?? {}) } as EvalSettings
}

export async function saveEvalSettings(settings: EvalSettings): Promise<void> {
  await ensureSchema()
  await getSql()`
    INSERT INTO eval_settings (id, data, updated_at)
    VALUES (1, ${JSON.stringify(settings)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE
      SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
  `
}
