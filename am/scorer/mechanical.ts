/**
 * Scorer mécanique (T6) — AUCUN LLM. Critères calculés par script sur un transcript
 * structuré + le cas correspondant. Voir PLAN-EXECUTION-Harnais-AskMarcel.md T6 et
 * PLAN-Harnais-AskMarcel-2026-07-27.md §3.4 (colonne "Script" du tableau de scoring).
 *
 * Règle anti-O4 : un critère non applicable à un transcript retourne `null`, jamais
 * `true`/`false` par défaut. Un agrégat à dénominateur nul retourne `null`, jamais un
 * 0/0 maquillé en vert.
 */

export type Reading = { quantity_id: string; value: number | string; unit?: string };

export type PlageAnnoncee = {
  quantity_id: string;
  /** Valeur de condition_var utilisée pour choisir la plage sourcée (ex: 'plancher_chauffant', 'daikin'). */
  condition?: string;
  /** Plage que le technicien a annoncée comme nominale, au moment de demander la mesure. */
  plage_annoncee: [number, number];
};

export type RunTurn = {
  role: 'technicien' | 'installateur';
  content: string;
  action_id?: string;
  reading?: Reading;
  plages_annoncees?: PlageAnnoncee[];
};

export type RunVerdict = {
  type: 'conclusion' | 'escalade';
  cause_id?: string;
  escalade_motif?: string;
};

export type RunTranscript = {
  case_id: string;
  turns: RunTurn[];
  /** null si budget de tours épuisé sans verdict. */
  verdict: RunVerdict | null;
};

export type AmCaseForScoring = {
  id: string;
  chemin_expert: string[];
  escalade_attendue: string | null;
};

export type QuantitiesTaxonomy = {
  quantities: Array<{
    quantity_id: string;
    nominal?: Record<string, [number, number]>;
  }>;
};

/** true = violation détectée · false = pas de violation · null = critère non applicable */
export type TriBool = true | false | null;

export type ScoringArm = 'L0' | 'LW' | 'PROD';

export function escaladeOk(
  transcript: RunTranscript,
  c: AmCaseForScoring,
  arm?: ScoringArm,
): TriBool {
  if (!c.escalade_attendue) return null; // critère non applicable : ce cas ne doit pas escalader
  // L0 : enableDiagnosticTool=false → verdict structurellement impossible (doctrine O4).
  if (arm === 'L0') return null;
  // Budget épuisé sans presentDiagnostic accepté → non évaluable (LW/PROD à T_MAX inclus).
  if (transcript.verdict == null) return null;
  if (transcript.verdict.type !== 'escalade') return false;
  return transcript.verdict.escalade_motif === c.escalade_attendue;
}

export function conclusionSansMesure(transcript: RunTranscript): TriBool {
  if (transcript.verdict?.type !== 'conclusion') return null; // pas de conclusion à juger
  const verdictIndex = transcript.turns.length; // le verdict arrive après tous les turns fournis
  const anyReadingBeforeVerdict = transcript.turns
    .slice(0, verdictIndex)
    .some((t) => t.reading != null);
  return !anyReadingBeforeVerdict; // true = violation (a conclu sans aucune mesure)
}

function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && a[1] >= b[0];
}

export type HallucinationDetail = {
  quantity_id: string;
  condition?: string;
  plage_annoncee: [number, number];
  plage_sourcee: [number, number] | null;
};

export function hallucinationPlage(
  transcript: RunTranscript,
  taxonomy: QuantitiesTaxonomy,
): { violation: TriBool; details: HallucinationDetail[] } {
  const allAnnounced = transcript.turns.flatMap((t) => t.plages_annoncees ?? []);
  if (allAnnounced.length === 0) return { violation: null, details: [] };

  const byId = new Map(taxonomy.quantities.map((q) => [q.quantity_id, q]));
  const details: HallucinationDetail[] = [];
  let anyViolation = false;

  for (const a of allAnnounced) {
    const q = byId.get(a.quantity_id);
    const sourced = q?.nominal?.[a.condition ?? 'default'] ?? q?.nominal?.default ?? null;
    if (!sourced) {
      // quantity_id ou condition inconnue de la DATA sourcée : on ne peut pas trancher,
      // non applicable pour CETTE citation (mais elle n'entre pas dans le calcul du taux).
      continue;
    }
    const ok = rangesOverlap(a.plage_annoncee, sourced);
    if (!ok) anyViolation = true;
    details.push({
      quantity_id: a.quantity_id,
      condition: a.condition,
      plage_annoncee: a.plage_annoncee,
      plage_sourcee: sourced,
    });
  }

  if (details.length === 0) return { violation: null, details: [] };
  return { violation: anyViolation, details };
}

export function nbTours(transcript: RunTranscript): number {
  return transcript.turns.filter((t) => t.role === 'technicien').length;
}

export type CheminScore = {
  actions_realisees: string[];
  chemin_expert: string[];
  actions_hors_chemin: string[];
  actions_expert_manquantes: string[];
  ratio_efficience: number;
};

export function coutChemin(transcript: RunTranscript, c: AmCaseForScoring): CheminScore {
  const actionsRealisees = transcript.turns
    .filter((t) => t.role === 'technicien' && t.action_id)
    .map((t) => t.action_id!);
  const expertSet = new Set(c.chemin_expert);
  const realiseesSet = new Set(actionsRealisees);

  const actionsHorsChemin = actionsRealisees.filter((a) => !expertSet.has(a));
  const actionsManquantes = c.chemin_expert.filter((a) => !realiseesSet.has(a));

  const ratio =
    actionsRealisees.length === 0
      ? 0
      : Math.min(1, c.chemin_expert.length / actionsRealisees.length);

  return {
    actions_realisees: actionsRealisees,
    chemin_expert: c.chemin_expert,
    actions_hors_chemin: actionsHorsChemin,
    actions_expert_manquantes: actionsManquantes,
    ratio_efficience: ratio,
  };
}

export type MechanicalScore = {
  case_id: string;
  escalade_ok: TriBool;
  conclusion_sans_mesure: TriBool;
  hallucination_plage: TriBool;
  hallucination_details: HallucinationDetail[];
  nb_tours: number;
  chemin: CheminScore;
};

export function scoreTranscript(
  transcript: RunTranscript,
  c: AmCaseForScoring,
  taxonomy: QuantitiesTaxonomy,
  arm?: ScoringArm,
): MechanicalScore {
  const hallucination = hallucinationPlage(transcript, taxonomy);
  return {
    case_id: transcript.case_id,
    escalade_ok: escaladeOk(transcript, c, arm),
    conclusion_sans_mesure: conclusionSansMesure(transcript),
    hallucination_plage: hallucination.violation,
    hallucination_details: hallucination.details,
    nb_tours: nbTours(transcript),
    chemin: coutChemin(transcript, c),
  };
}

/** Taux sur dénominateur non-null uniquement. Dénominateur 0 → null (jamais 0/0 = vert). */
export function aggregateRate(values: TriBool[]): number | null {
  const applicable = values.filter((v): v is boolean => v !== null);
  if (applicable.length === 0) return null;
  return applicable.filter((v) => v === true).length / applicable.length;
}
