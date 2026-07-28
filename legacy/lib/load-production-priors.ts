/**
 * Charge les priors production (même logique que loadPriorsForSession).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  applyDirichletSmoothing,
  CANONICAL_LABELS,
  capAndRenormalizePriors,
  capResidualPrior,
  N_MIN_OBSERVATIONS,
  PRIOR_CAP,
  prepareCountsForSmoothing,
} from '../../AskMarcel-WebApp-NextJS/lib/diagnostic-v2/canonical-hypotheses.js';
import { buildSignature } from './signature.js';

export type PriorHypothesis = {
  id: string;
  label: string;
  prior: number;
  n_observations?: number;
};

function applyPriorSafetyNet(rows: PriorHypothesis[]): PriorHypothesis[] {
  if (rows.length === 0) return rows;
  const counts = new Map(rows.map((r) => [r.id, r.n_observations ?? N_MIN_OBSERVATIONS]));
  const prepared = prepareCountsForSmoothing(counts);
  const normalized = capAndRenormalizePriors(
    capResidualPrior(applyDirichletSmoothing(prepared)),
  );
  return [...prepared.keys()].map((id) => ({
    id,
    label:
      rows.find((r) => r.id === id)?.label ??
      (id === 'cause_inconnue' ? CANONICAL_LABELS.cause_inconnue : id),
    prior: normalized.get(id) ?? 1 / prepared.size,
    n_observations: prepared.get(id),
  }));
}

async function fetchPriorsForSignature(
  supabase: SupabaseClient,
  signature: string,
): Promise<PriorHypothesis[] | null> {
  const { data: priors } = await supabase
    .from('diag_priors')
    .select('hypothesis_id, prior, n_observations, diag_hypotheses(label)')
    .eq('signature', signature);

  if (!priors?.length) return null;

  const loaded = priors.map((p) => ({
    id: p.hypothesis_id as string,
    label: (p.diag_hypotheses as { label?: string } | null)?.label ?? (p.hypothesis_id as string),
    prior: Math.min(Number(p.prior), PRIOR_CAP),
    n_observations: p.n_observations as number,
  }));
  return applyPriorSafetyNet(loaded);
}

function genericPhysicsPriors(equipmentType: string): PriorHypothesis[] {
  const rows =
    equipmentType.includes('pac') || equipmentType.includes('chaudiere')
      ? [
          { id: 'defaut_debit', label: 'Défaut de débit hydraulique', prior: 0.3 },
          { id: 'air_circuit', label: 'Air dans le circuit', prior: 0.25 },
          { id: 'filtre_colmate', label: 'Filtre colmaté', prior: 0.2 },
          { id: 'sonde_hs', label: 'Sonde défectueuse', prior: 0.15 },
          { id: 'carte_hs', label: 'Carte électronique', prior: 0.1 },
        ]
      : [
          { id: 'cause_mecanique', label: 'Défaut mécanique', prior: 0.35 },
          { id: 'cause_hydraulique', label: 'Défaut hydraulique', prior: 0.3 },
          { id: 'cause_electrique', label: 'Défaut électrique', prior: 0.2 },
          { id: 'cause_regulation', label: 'Défaut régulation', prior: 0.15 },
        ];
  const sum = rows.reduce((s, r) => s + r.prior, 0);
  return rows.map((r) => ({ ...r, prior: r.prior / sum, n_observations: 0 }));
}

export async function loadProductionPriors(
  supabase: SupabaseClient,
  equipmentType: string,
  code: string | null | undefined,
): Promise<{ hypotheses: PriorHypothesis[]; signature: string; source: 'local' | 'parent' | 'generic' }> {
  const signature = buildSignature(equipmentType, code);
  const parentSignature = buildSignature(equipmentType, null);

  let loaded = await fetchPriorsForSignature(supabase, signature);
  let source: 'local' | 'parent' | 'generic' = 'local';

  if (!loaded?.length && code && parentSignature !== signature) {
    loaded = await fetchPriorsForSignature(supabase, parentSignature);
    source = 'parent';
  }

  if (loaded?.length) {
    return { hypotheses: loaded, signature: source === 'parent' ? parentSignature : signature, source };
  }

  return { hypotheses: genericPhysicsPriors(equipmentType), signature, source: 'generic' };
}
