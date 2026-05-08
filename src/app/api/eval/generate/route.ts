import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { readSession } from '@/lib/session'
import { listVoiceSamples } from '@/lib/eval-db'
import {
  buildUserMessage,
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  type GeneratedBlocks,
} from '@/lib/eval-prompt'

export const runtime = 'nodejs'

type Body = {
  level?: 'junior' | 'senior'
  pronoun?: 'she' | 'he' | 'they'
  notes?: string
}

export async function POST(request: NextRequest) {
  if (!(await readSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured. Set it in your Vercel project env vars.' },
      { status: 500 },
    )
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { level, pronoun, notes } = body
  if (level !== 'junior' && level !== 'senior') {
    return NextResponse.json({ error: 'level must be "junior" or "senior"' }, { status: 400 })
  }
  if (pronoun !== 'she' && pronoun !== 'he' && pronoun !== 'they') {
    return NextResponse.json(
      { error: 'pronoun must be "she", "he", or "they"' },
      { status: 400 },
    )
  }
  if (typeof notes !== 'string' || notes.trim().length === 0) {
    return NextResponse.json({ error: 'notes is required' }, { status: 400 })
  }

  const voiceSamples = await listVoiceSamples()

  const client = new Anthropic()

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserMessage({ level, pronoun, notes, voiceSamples }),
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
      },
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'Empty response from model' }, { status: 502 })
    }

    let parsed: GeneratedBlocks
    try {
      parsed = JSON.parse(textBlock.text) as GeneratedBlocks
    } catch {
      return NextResponse.json(
        { error: 'Model returned non-JSON response', raw: textBlock.text },
        { status: 502 },
      )
    }

    return NextResponse.json({ blocks: parsed })
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status ?? 500 },
      )
    }
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
