#!/usr/bin/env tsx
/**
 * Génère / vérifie la parité CSV Marcel ↔ fault-tree-v3.
 * - workflow/marcel-review-v3.csv         : file d'attente (draft)
 * - workflow/marcel-review-v3-resolved.csv : arbitrages tracés
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { PATHS } from '../lib/v3/paths.js';

const MARCEL_SOURCE = 'marcel:2026-07-27';
const RESOLVED_AT = '2026-07-27';

type Effect = {
  quantity: string;
  direction?: string;
  value?: string;
  lr?: string;
  status: 'draft' | 'sourced';
  sources?: string[];
  note?: string;
};

type Cause = { cause_id: string; effects: Effect[] };
type FaultTree = { causes: Cause[] };

const EDGE_QUESTIONS: Record<string, string> = {
  'air_circuit|purgeur': 'Purgeur crache air = effet discriminant air_circuit vs débit bas mécanique ?',
  'filtre_colmate|pression_circuit_bar':
    'Pression in_range compatible filtre colmaté (perte charge locale, pas fuite) ?',
  'pompe_grippee|bruit_pompe': 'Claquement au démarrage = signature circulateur grippé ?',
  'pompe_grippee|amperage_circulateur':
    'Ampérage bas (rotor bloqué) ou haut (surcharge) — bloqué sans doc par famille pompe',
  'pression_basse|delta_t_eau': 'ΔT élevé secondaire à débit réduit par pression basse ?',
  'bypass_ferme|bypass_ouvert': 'Bypass fermé / non ouvert = cause débit insuffisant boucles ?',
  'flowswitch_hs|debit_l_min':
    'Débit in_range + code 7H = discriminant flowswitch HS vs defaut_debit (débit réel bas)',
  'sonde_hs|delta_sonde_k': 'Écart sonde vs mesure référence > seuil K ?',
  'sonde_hs|t_depart': 'Température départ incohérente avec régime (sonde décalée) ?',
  'carte_hs|led_defaut': 'Code défaut persistant sans cause hydraulique = carte ?',
  'carte_hs|hp_bar': 'HP in_range exclut cause frigo — oriente carte / logique ?',
  'compresseur_hs|delta_hp_bp': 'Convergence HP−BP basse = compresseur faible ?',
  'compresseur_hs|amperage_compresseur':
    'Seuil ampérage compresseur HS — variable inverter, conservé draft',
  'degivrage_anormal|givre': 'Givre localisé échangeur vs généralisé charge ?',
  'degivrage_anormal|hp_bar': 'HP normale en dégivrage anormal (cycle, pas charge) ?',
  'charge_insuffisante|hp_bar': 'HP basse + BP basse = charge insuffisante ?',
  'charge_insuffisante|bp_bar': 'BP basse corrélée HP basse (charge) ?',
  'charge_insuffisante|givre': 'Givre généralisé aspiration = sous-charge ?',
  'vanne_fermee|vanne_position': 'Vanne fermée / bloquée ECS = pas de chauffage ?',
  'defaut_transitoire|led_defaut': 'Code transitoire effacé au reset — LR faible ?',
  'defaut_transitoire|delta_t_eau': 'ΔT in_range en transitoire (pas défaut hydraulique) ?',
  'condensats_bouches|condensats': 'Condensats obstrués = givre / arrêt sécurité ?',
  'condensats_bouches|givre': 'Givre localisé lié condensats (pas charge) ?',
  'sous_dimension|delta_t_eau':
    'ΔT high (pas low) — P/ṁ·cp : sous-dimensionnement = débit limite, ΔT monte',
};

function edgeId(causeId: string, effect: Effect): string {
  return `${causeId}|${effect.quantity}`;
}

function directionOrValue(effect: Effect): string {
  return effect.direction ?? effect.value ?? '';
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function loadTree(): FaultTree {
  return JSON.parse(readFileSync(PATHS.faultTree, 'utf8')) as FaultTree;
}

/** Arêtes Marcel ou draft — tout ce qui passe par la revue Marcel P0. */
function collectReviewEdges(tree: FaultTree): Array<{
  edge_id: string;
  cause_id: string;
  quantity: string;
  direction_or_value: string;
  lr: string;
  effect: Effect;
}> {
  const rows: Array<{
    edge_id: string;
    cause_id: string;
    quantity: string;
    direction_or_value: string;
    lr: string;
    effect: Effect;
  }> = [];

  for (const cause of tree.causes) {
    if (cause.cause_id === 'cause_inconnue') continue;
    for (const effect of cause.effects) {
      const hasMarcel = (effect.sources ?? []).some((s) => s.startsWith('marcel:'));
      const isDraft = effect.status === 'draft';
      if (!hasMarcel && !isDraft) continue;
      rows.push({
        edge_id: edgeId(cause.cause_id, effect),
        cause_id: cause.cause_id,
        quantity: effect.quantity,
        direction_or_value: directionOrValue(effect),
        lr: effect.lr ?? '',
        effect,
      });
    }
  }

  return rows.sort((a, b) => a.edge_id.localeCompare(b.edge_id));
}

function generatePendingCsv(edges: ReturnType<typeof collectReviewEdges>): string {
  const header =
    'edge_id,cause_id,quantity,direction_or_value,lr,status_before,question,proposed_source,reviewer';
  const lines = edges.map((e) => {
    const question = EDGE_QUESTIONS[e.edge_id] ?? `Sourcer effet ${e.quantity} pour ${e.cause_id}`;
    const proposed = e.effect.status === 'draft' ? '' : MARCEL_SOURCE;
    return [
      e.edge_id,
      e.cause_id,
      e.quantity,
      e.direction_or_value,
      e.lr,
      'draft',
      csvEscape(question),
      proposed,
      'marcel',
    ].join(',');
  });
  return `${header}\n${lines.join('\n')}\n`;
}

function generateResolvedCsv(edges: ReturnType<typeof collectReviewEdges>): string {
  const header =
    'edge_id,cause_id,quantity,direction_or_value,lr,status_before,status_after,resolved_source,resolved_at,arbiter,note';
  const lines = edges.map((e) => {
    const after = e.effect.status;
    const resolvedSource =
      after === 'sourced' && (e.effect.sources ?? []).find((s) => s.startsWith('marcel:'))
        ? MARCEL_SOURCE
        : '';
    const note = e.effect.note ?? '';
    return [
      e.edge_id,
      e.cause_id,
      e.quantity,
      e.direction_or_value,
      e.lr,
      'draft',
      after,
      resolvedSource,
      RESOLVED_AT,
      'marcel',
      csvEscape(note),
    ].join(',');
  });
  return `${header}\n${lines.join('\n')}\n`;
}

function verifyParity(tree: FaultTree, resolvedCsv: string): string[] {
  const errors: string[] = [];
  const edges = collectReviewEdges(tree);

  const marcelInTree = new Set<string>();
  for (const cause of tree.causes) {
    for (const effect of cause.effects) {
      if ((effect.sources ?? []).some((s) => s.startsWith('marcel:'))) {
        marcelInTree.add(edgeId(cause.cause_id, effect));
      }
    }
  }

  const resolvedIds = new Set(
    resolvedCsv
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(',')[0]),
  );

  for (const id of marcelInTree) {
    if (!resolvedIds.has(id)) errors.push(`arbre marcel manquant dans CSV résolu: ${id}`);
  }
  for (const id of resolvedIds) {
    if (!marcelInTree.has(id) && !id.includes('amperage')) {
      const row = edges.find((e) => e.edge_id === id);
      if (row?.effect.status !== 'draft') {
        errors.push(`CSV résolu sans marcel dans arbre: ${id}`);
      }
    }
  }

  const draftInTree = edges.filter((e) => e.effect.status === 'draft');
  for (const d of draftInTree) {
    if (!resolvedIds.has(d.edge_id)) errors.push(`draft arbre manquant CSV: ${d.edge_id}`);
  }

  if (edges.length !== resolvedIds.size) {
    errors.push(`décompte: arbre review=${edges.length} csv=${resolvedIds.size}`);
  }
  if (marcelInTree.size !== 22) {
    errors.push(`attendu 22 arêtes marcel dans arbre, trouvé ${marcelInTree.size}`);
  }

  return errors;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const tree = loadTree();
  const edges = collectReviewEdges(tree);

  if (checkOnly) {
    const resolved = readFileSync(PATHS.marcelResolved, 'utf8');
    const errors = verifyParity(tree, resolved);
    const report = {
      checked_at: new Date().toISOString(),
      review_edges: edges.length,
      marcel_sourced_in_tree: edges.filter((e) =>
        (e.effect.sources ?? []).some((s) => s.startsWith('marcel:')),
      ).length,
      draft_in_tree: edges.filter((e) => e.effect.status === 'draft').length,
      errors,
      pass: errors.length === 0,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.pass) process.exit(1);
    return;
  }

  writeFileSync(PATHS.marcelReview, generatePendingCsv(edges));
  const resolvedContent = generateResolvedCsv(edges);
  writeFileSync(PATHS.marcelResolved, resolvedContent);

  const errors = verifyParity(tree, resolvedContent);
  const report = {
    generated_at: new Date().toISOString(),
    pending_csv: PATHS.marcelReview,
    resolved_csv: PATHS.marcelResolved,
    review_edges: edges.length,
    marcel_sourced: edges.filter((e) => e.effect.status === 'sourced').length,
    draft_kept: edges.filter((e) => e.effect.status === 'draft').length,
    parity_errors: errors,
    pass: errors.length === 0,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exit(1);
}

main();
