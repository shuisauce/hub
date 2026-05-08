// Shared types and constants for the eval section. Safe to import from
// client components (no DB or server-only deps).

export type EvalDomain =
  | 'patient_safety'
  | 'knowledge_thinking'
  | 'communication'
  | 'professional_role'
  | 'improvement'
  | 'additional'
  | 'general'

export const EVAL_DOMAINS: EvalDomain[] = [
  'patient_safety',
  'knowledge_thinking',
  'communication',
  'professional_role',
  'improvement',
  'additional',
  'general',
]

export const DOMAIN_LABEL: Record<EvalDomain, string> = {
  patient_safety: 'Patient Safety & Perianesthesia Care',
  knowledge_thinking: 'Knowledge & Critical Thinking',
  communication: 'Professional Communication & Collaboration',
  professional_role: 'Professional Role',
  improvement: 'Areas for Improvement',
  additional: 'Additional Comments',
  general: 'General',
}

export type VoiceSample = {
  id: string
  text: string
  domain: EvalDomain
  pinned: boolean
  created_at: string
}

export type EvalLevel = 'junior' | 'senior'
export type EvalPronoun = 'she' | 'he' | 'they'

export type EvalSettings = {
  defaultLevel: EvalLevel
  defaultPronoun: EvalPronoun
}

export const DEFAULT_EVAL_SETTINGS: EvalSettings = {
  defaultLevel: 'junior',
  defaultPronoun: 'they',
}
