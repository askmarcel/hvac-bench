/**
 * Contrôle de conformité au contrat de réponse (CDC REQ-O1).
 *
 * Volontairement écrit à la main plutôt que via le paquet `answer-contract` : le scorer
 * doit pouvoir juger un bras A/B/C dont la sortie est reconstruite par un parseur, et
 * rester lisible par un tiers qui audite le bench sans accès au monorepo.
 * Un échec de parse est un échec de format, pas une absence de mesure.
 */

export const ABSTENTION_STATES = ['unknown_code', 'ambiguous', 'empty', 'off_topic'] as const;

export const KNOWN_STATES = [
  'answer',
  'empty',
  'loading',
  'unknown_code',
  'off_topic',
  'ambiguous',
  'api_error',
  'degraded',
  'quota_warning',
  'quota_exceeded',
] as const;

export type ObservedAnswer = {
  state: string;
  brand: string | null;
  code: string | null;
  label: string | null;
  /** Concaténation du texte assertif : cause, étapes, libellé. Base des contrôles de sens. */
  text: string;
  citation: { manual_title: string | null; page: number | null; source_type: string | null } | null;
  steps: string[];
};

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join(' ');
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([k]) => k !== 'state')
      .map(([, v]) => textOf(v))
      .join(' ');
  }
  return '';
}

export type FormatCheck = { compliant: boolean; reason: string; observed: ObservedAnswer | null };

export function checkFormat(answer: Record<string, unknown> | null): FormatCheck {
  if (!answer) return { compliant: false, reason: 'aucune réponse (appel en échec)', observed: null };

  const state = typeof answer.state === 'string' ? answer.state : null;
  if (!state) return { compliant: false, reason: 'champ `state` absent', observed: null };
  if (!(KNOWN_STATES as readonly string[]).includes(state)) {
    return { compliant: false, reason: `état inconnu : ${state}`, observed: null };
  }

  const identification = (answer.identification ?? null) as Record<string, unknown> | null;
  const citationRaw = (answer.citation ?? null) as Record<string, unknown> | null;
  const stepsRaw = Array.isArray(answer.steps) ? (answer.steps as unknown[]) : [];

  const observed: ObservedAnswer = {
    state,
    brand: typeof identification?.brand === 'string' ? identification.brand : null,
    code: typeof identification?.code === 'string' ? identification.code : null,
    label: typeof identification?.label === 'string' ? identification.label : null,
    text: [textOf(answer.cause), textOf(answer.steps), textOf(identification?.label)].join(' ').trim(),
    citation: citationRaw
      ? {
          manual_title: typeof citationRaw.manual_title === 'string' ? citationRaw.manual_title : null,
          page: typeof citationRaw.page === 'number' ? citationRaw.page : null,
          source_type: typeof citationRaw.source_type === 'string' ? citationRaw.source_type : null,
        }
      : null,
    steps: stepsRaw.map(textOf).filter(Boolean),
  };

  if (state === 'answer') {
    const missing: string[] = [];
    if (!observed.brand) missing.push('identification.brand');
    if (!observed.code) missing.push('identification.code');
    if (!observed.citation?.manual_title) missing.push('citation.manual_title');
    if (!observed.citation?.page) missing.push('citation.page');
    if (observed.steps.length === 0) missing.push('steps');
    if (missing.length > 0) {
      return { compliant: false, reason: `état answer incomplet : ${missing.join(', ')}`, observed };
    }
  }

  return { compliant: true, reason: 'conforme', observed };
}

export function isAbstention(state: string): boolean {
  return (ABSTENTION_STATES as readonly string[]).includes(state);
}
