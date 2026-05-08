import 'server-only'
import {
  DOMAIN_LABEL,
  type EvalDomain,
  type EvalLevel,
  type EvalPronoun,
  type VoiceSample,
} from './eval-types'

export type GenerateInput = {
  level: EvalLevel
  pronoun: EvalPronoun
  notes: string
  voiceSamples: VoiceSample[]
}

export type GeneratedBlocks = {
  patient_safety: string
  knowledge_thinking: string
  communication: string
  professional_role: string
  improvement: string
  additional: string
}

const PRONOUNS: Record<EvalPronoun, { subject: string; object: string; possessive: string }> = {
  she: { subject: 'she', object: 'her', possessive: 'her' },
  he: { subject: 'he', object: 'him', possessive: 'his' },
  they: { subject: 'they', object: 'them', possessive: 'their' },
}

const LEVEL_GUIDANCE: Record<EvalLevel, string> = {
  junior:
    "Junior SRNAs are early in clinical training. Comments should reflect attention to fundamentals — equipment checks, basic technique, building situational awareness, learning to anticipate. Constructive feedback is normal and expected; the bar is engagement and steady progress, not autonomy.",
  senior:
    "Senior SRNAs are expected to function with substantial autonomy and refine judgment under pressure. Comments should reflect clinical decision-making, anticipation, leadership in the room, and readiness for independent practice. Constructive feedback should be calibrated to that higher bar.",
}

export const SYSTEM_PROMPT = `You are drafting evaluation comments for a CRNA preceptor who supervises SRNAs (student registered nurse anesthetists) on a clinical day. The preceptor will paste these comments into the Typhon EASI system as free-text "why I gave these ratings" responses. Your job is to turn rough end-of-day notes into six polished, ready-to-paste text blocks in the preceptor's own voice.

THE SIX BLOCKS YOU MUST PRODUCE:
1. patient_safety — Patient Safety & Perianesthesia Care (vigilance, equipment check, perioperative complications, induction/maintenance/emergence/postop, regional)
2. knowledge_thinking — Knowledge & Critical Thinking (anesthetic plan formulation, H&P, monitoring data interpretation, fluid/blood management, recognizing & managing physiologic responses and complications)
3. communication — Professional Communication & Collaboration (with patient/family, healthcare team; documentation; handoff; leadership)
4. professional_role — Professional Role (AANA/ANA ethics & standards, integrity, accountability, cost-effective care)
5. improvement — Specific areas the student should work on next
6. additional — Anything else worth saying that doesn't fit above

VOICE
- Match the preceptor's voice. If voice samples are provided below, mirror their cadence, sentence length, vocabulary, and how they balance praise with constructive feedback. Do NOT copy phrases verbatim — match the *style*.
- Plain professional clinical prose. No emojis. No markdown. No bullet points unless the voice samples use them.
- First-person from the preceptor's perspective ("I observed...", "We discussed..."). Don't start every block the same way.

CONTENT RULES
- Only write what is supported by the notes. If a domain has no relevant detail, write a brief honest comment (e.g. "No specific concerns noted in this domain today" — but only if the voice samples suggest the preceptor would write that). Do NOT invent cases, drugs, doses, dialogues, or events that aren't in the notes.
- Reference specific events/cases when the notes mention them. Specificity is what makes these comments useful.
- Use the student's pronoun consistently. Don't name the student.
- Lengths should feel natural — typically 2–5 sentences per domain block, but follow the voice samples. Improvement and additional may be shorter or longer as the day warrants.
- If the notes are brief, the comments should be brief. Do not pad.

CALIBRATION
- Calibrate praise vs. constructive feedback to the level (junior vs. senior — see level guidance).
- Avoid generic filler ("great student", "did well", "keep it up"). Every claim should have a concrete referent in the notes.

OUTPUT
Return JSON with exactly the six keys. Each value is the polished comment text for that block.`

export function buildUserMessage(input: GenerateInput): string {
  const { level, pronoun, notes, voiceSamples } = input
  const p = PRONOUNS[pronoun]
  const sections: string[] = []

  sections.push(`STUDENT LEVEL: ${level === 'junior' ? 'Junior SRNA' : 'Senior SRNA'}
${LEVEL_GUIDANCE[level]}`)

  sections.push(`STUDENT PRONOUN: ${p.subject}/${p.object} (possessive: ${p.possessive}). Use these consistently throughout.`)

  if (voiceSamples.length > 0) {
    const pinned = voiceSamples.filter((s) => s.pinned)
    const unpinned = voiceSamples.filter((s) => !s.pinned)
    const ordered = [...pinned, ...unpinned]

    const grouped: Record<EvalDomain, VoiceSample[]> = {
      patient_safety: [],
      knowledge_thinking: [],
      communication: [],
      professional_role: [],
      improvement: [],
      additional: [],
      general: [],
    }
    for (const s of ordered) grouped[s.domain].push(s)

    const blocks: string[] = []
    for (const d of Object.keys(grouped) as EvalDomain[]) {
      const samples = grouped[d]
      if (samples.length === 0) continue
      const label = d === 'general' ? 'General voice samples' : `Voice samples — ${DOMAIN_LABEL[d]}`
      const body = samples
        .map((s, i) => `[${i + 1}${s.pinned ? ' · pinned' : ''}]\n${s.text.trim()}`)
        .join('\n\n')
      blocks.push(`${label}:\n${body}`)
    }

    sections.push(
      `VOICE SAMPLES — these are previously edited comments from this preceptor. Mirror their style, cadence, and tone. Do not copy phrases verbatim.\n\n${blocks.join('\n\n')}`,
    )
  } else {
    sections.push(
      `VOICE SAMPLES: none yet. Default to plain, specific, professional clinical prose. The preceptor will refine and save samples after this draft.`,
    )
  }

  sections.push(`END-OF-DAY NOTES:
${notes.trim()}`)

  sections.push(
    `Now draft the six blocks. Return JSON with keys: patient_safety, knowledge_thinking, communication, professional_role, improvement, additional.`,
  )

  return sections.join('\n\n---\n\n')
}

export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    patient_safety: { type: 'string' },
    knowledge_thinking: { type: 'string' },
    communication: { type: 'string' },
    professional_role: { type: 'string' },
    improvement: { type: 'string' },
    additional: { type: 'string' },
  },
  required: [
    'patient_safety',
    'knowledge_thinking',
    'communication',
    'professional_role',
    'improvement',
    'additional',
  ],
  additionalProperties: false,
} as const
