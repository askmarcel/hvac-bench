/**
 * Génère les 20 cas pilotes v2 (4 familles × 5)
 * Usage: pnpm exec tsx scripts/generate-pilot-cases.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

type PilotCase = Record<string, unknown>;

const NOW = '2026-07-26T12:00:00Z';

function base(
  id: string,
  family: string,
  extra: Partial<PilotCase> & {
    symptom: PilotCase['symptom'];
    context: PilotCase['context'];
    hypotheses: PilotCase['hypotheses'];
    tests: PilotCase['tests'];
    expert_path: string[];
  },
): PilotCase {
  const tests = extra.tests as Array<{ resolves?: boolean; cost_eur?: number; minutes?: number }>;
  const expertCost = tests
    .filter((t) => extra.expert_path.includes((t as { action_id: string }).action_id))
    .reduce((s, t) => s + (t.cost_eur ?? 0), 0);
  const expertMinutes = tests
    .filter((t) => extra.expert_path.includes((t as { action_id: string }).action_id))
    .reduce((s, t) => s + (t.minutes ?? 0), 0);

  return {
    id,
    version: 2,
    split: 'public',
    locale: 'fr',
    symptom: extra.symptom,
    context: extra.context,
    initial_readings: extra.initial_readings ?? {},
    hypotheses: extra.hypotheses,
    tests: extra.tests,
    expert_path: extra.expert_path,
    expert_path_cost_eur: expertCost,
    expert_path_minutes: expertMinutes,
    forbidden_before: extra.forbidden_before ?? {},
    escalation_expected: extra.escalation_expected ?? null,
    harvest: extra.harvest ?? { harvest_date: '2026-07-14', source_ids: [], reformulated: true },
    flags: {
      gate_critical: true,
      safety_sensitive: false,
      no_code: extra.symptom?.code_absent_by_design === true,
      sparse_priors: (extra.hypotheses as Array<{ n_observations: number }>).some((h) => h.n_observations < 30),
    },
    meta: { created_at: NOW, author: 'agent', family, tags: extra.tags ?? [] },
  };
}

const cases: PilotCase[] = [
  // === code_multi_cause (5) ===
  base('hb2-0001', 'code_multi_cause', {
    symptom: {
      narrative:
        "PAC en sécurité tous les matins depuis 3 jours, repart l'après-midi. 7H à l'affichage. Le client dit que ça a commencé après la vidange du plancher chauffant.",
      code_present: '7H',
      code_absent_by_design: false,
    },
    context: {
      brand: 'Daikin',
      model: 'Altherma 3 EHSH',
      equipment_type: 'pac_air_eau',
      install_age_years: 2,
      season: 'hiver',
      emitter: 'plancher_chauffant',
      in_corpus: true,
    },
    initial_readings: { pression_bar: 1.2 },
    hypotheses: [
      { id: 'air_circuit', label: 'Air dans le circuit après vidange', prior: 0.41, n_observations: 3127, window: '2021-07..2026-07', source: 'resolution_corpus', true_cause: true },
      { id: 'filtre_colmate', label: 'Filtre à tamis colmaté', prior: 0.19, n_observations: 1448, true_cause: false },
      { id: 'vanne_fermee', label: "Vanne d'isolement restée fermée", prior: 0.14, n_observations: 1067, true_cause: false },
      { id: 'pompe_grippee', label: 'Circulateur grippé', prior: 0.11, n_observations: 838, true_cause: false },
      { id: 'flowswitch_hs', label: 'Contrôleur de débit défectueux', prior: 0.09, n_observations: 686, true_cause: false },
      { id: 'sous_dimension', label: 'Circuit sous-dimensionné', prior: 0.06, n_observations: 457, true_cause: false },
    ],
    tests: [
      { action_id: 'MES-DT-EAU', observation: 'ΔT = 1,8 K — très faible, cohérent avec un défaut de débit', discriminates: ['air_circuit', 'filtre_colmate', 'vanne_fermee', 'pompe_grippee'], eliminates: [] },
      { action_id: 'OBS-PURGEUR', observation: "Purgeur automatique crache de l'air en continu", discriminates: ['air_circuit'], eliminates: ['vanne_fermee'] },
      { action_id: 'MAN-PURGE', observation: 'Purge longue, beaucoup d air evacue. Debit remonte, 7H disparait.', discriminates: ['air_circuit'], eliminates: ['filtre_colmate', 'pompe_grippee', 'flowswitch_hs'], resolves: true },
      { action_id: 'DEM-FILTRE', observation: 'Tamis propre', discriminates: ['filtre_colmate'], eliminates: ['filtre_colmate'] },
      { action_id: 'REM-CIRCULATEUR', observation: 'Circulateur déposé : arbre libre, conforme. Aucun effet sur le défaut.', discriminates: [], eliminates: ['pompe_grippee'], wrong_part: true },
    ],
    expert_path: ['MES-DT-EAU', 'OBS-PURGEUR', 'MAN-PURGE'],
    forbidden_before: { 'REM-CIRCULATEUR': ['MAN-PURGE', 'DEM-FILTRE'] },
    harvest: { harvest_date: '2026-07-14', source_ids: ['sb_334da044-3290-47b5-9442-2dedbebaf1e0'], reformulated: true },
    tags: ['7H', 'plancher', 'post-vidange'],
  }),

  base('hb2-0002', 'code_multi_cause', {
    symptom: {
      narrative: "PAC Daikin Altherma en erreur 7H après 10-15 min de fonctionnement. Bruit d'air dans le circuit. Purgeur automatique encrassé au calcaire.",
      code_present: '7H',
      code_absent_by_design: false,
    },
    context: { brand: 'Daikin', equipment_type: 'pac_air_eau', in_corpus: true, season: 'hiver' },
    hypotheses: [
      { id: 'air_circuit', label: 'Air dans le circuit', prior: 0.35, n_observations: 120, true_cause: true },
      { id: 'pression_basse', label: 'Pression insuffisante', prior: 0.25, n_observations: 86, true_cause: false },
      { id: 'pompe_grippee', label: 'Circulateur HS', prior: 0.2, n_observations: 68, true_cause: false },
      { id: 'flowswitch_hs', label: 'Flowswitch HS', prior: 0.12, n_observations: 41, true_cause: false },
      { id: 'bypass_ferme', label: 'Bypass fermé', prior: 0.08, n_observations: 28, true_cause: false },
    ],
    tests: [
      { action_id: 'MES-PRESSION', observation: '1,4 bar mesure — limite basse constructeur', discriminates: ['pression_basse', 'air_circuit'], eliminates: [] },
      { action_id: 'OBS-PURGEUR', observation: 'Purgeur bouché, pas de purge auto', discriminates: ['air_circuit'], eliminates: [] },
      { action_id: 'MAN-PURGE', observation: 'Air évacué au robinet de purge, défaut disparaît', discriminates: ['air_circuit'], eliminates: ['pompe_grippee'], resolves: true },
      { action_id: 'REM-CIRCULATEUR', observation: 'Circulateur OK mécaniquement', discriminates: [], eliminates: ['pompe_grippee'], wrong_part: true },
    ],
    expert_path: ['MES-PRESSION', 'OBS-PURGEUR', 'MAN-PURGE'],
    harvest: { harvest_date: '2026-07-10', source_ids: ['sb_334da044-3290-47b5-9442-2dedbebaf1e0'], reformulated: true },
    tags: ['7H', 'purgeur'],
  }),

  base('hb2-0003', 'code_multi_cause', {
    symptom: {
      narrative: "7H sur Daikin, circulateur fait un raclement au démarrage puis silence. Redémarre après 1-2 tentatives. Chauffage intermittent.",
      code_present: '7H',
      code_absent_by_design: false,
    },
    context: { brand: 'Daikin', equipment_type: 'pac_air_eau', in_corpus: true },
    hypotheses: [
      { id: 'pompe_grippee', label: 'Circulateur grippé ou HS', prior: 0.38, n_observations: 95, true_cause: true },
      { id: 'air_circuit', label: 'Air dans le circuit', prior: 0.22, n_observations: 55, true_cause: false },
      { id: 'flowswitch_hs', label: 'Flowswitch', prior: 0.18, n_observations: 44, true_cause: false },
      { id: 'carte_hs', label: 'Carte alimentation pompe', prior: 0.12, n_observations: 30, true_cause: false },
      { id: 'filtre_colmate', label: 'Filtre colmaté', prior: 0.1, n_observations: 25, true_cause: false },
    ],
    tests: [
      { action_id: 'OBS-BRUIT-POMPE', observation: 'Raclement puis arrêt moteur — rotor bloqué', discriminates: ['pompe_grippee'], eliminates: [] },
      { action_id: 'MES-AMPERAGE', observation: '0,3 A puis 0 A — protection thermique', discriminates: ['pompe_grippee'], eliminates: ['flowswitch_hs'] },
      { action_id: 'DEM-CIRCULATEUR', observation: 'Arbre grippé, roulement fatigué', discriminates: ['pompe_grippee'], eliminates: ['air_circuit'] },
      { action_id: 'REM-CIRCULATEUR', observation: 'Défaut résolu après remplacement', discriminates: ['pompe_grippee'], eliminates: [], resolves: true },
      { action_id: 'MAN-PURGE', observation: 'Peu d air, pas d amélioration', discriminates: [], eliminates: ['air_circuit'] },
    ],
    expert_path: ['OBS-BRUIT-POMPE', 'MES-AMPERAGE', 'DEM-CIRCULATEUR', 'REM-CIRCULATEUR'],
    forbidden_before: { 'REM-CIRCULATEUR': ['DEM-CIRCULATEUR'] },
    harvest: { harvest_date: '2026-07-08', source_ids: ['sb_12e59549-20ea-4d91-82ed-59b441409a4b'], reformulated: true },
  }),

  base('hb2-0004', 'code_multi_cause', {
    symptom: {
      narrative: "7H Daikin quand moins de 2 ventilo-convecteurs ouverts et bypass fermé. Difficulté à monter au-delà de 18°C.",
      code_present: '7H',
      code_absent_by_design: false,
    },
    context: { brand: 'Daikin', equipment_type: 'pac_air_eau', emitter: 'ventilo_convecteur', in_corpus: true },
    hypotheses: [
      { id: 'bypass_ferme', label: 'Bypass mal réglé', prior: 0.4, n_observations: 72, true_cause: true },
      { id: 'sous_dimension', label: 'Débit insuffisant', prior: 0.25, n_observations: 45, true_cause: false },
      { id: 'defaut_debit', label: 'Défaut de débit global', prior: 0.2, n_observations: 38, true_cause: false },
      { id: 'filtre_colmate', label: 'Filtre colmaté', prior: 0.15, n_observations: 28, true_cause: false },
    ],
    tests: [
      { action_id: 'MES-DEBIT', observation: 'Débit 8 L/min — insuffisant pour la PAC', discriminates: ['defaut_debit', 'bypass_ferme'], eliminates: [] },
      { action_id: 'OBS-BYPASS', observation: 'Bypass reste fermé malgré faible débit', discriminates: ['bypass_ferme'], eliminates: [] },
      { action_id: 'MAN-REGLAGE-BYPASS', observation: 'Ouverture bypass, débit remonte, 7H disparaît', discriminates: ['bypass_ferme'], eliminates: ['sous_dimension'], resolves: true },
      { action_id: 'DEM-FILTRE', observation: 'Filtre propre', discriminates: ['filtre_colmate'], eliminates: ['filtre_colmate'] },
    ],
    expert_path: ['MES-DEBIT', 'OBS-BYPASS', 'MAN-REGLAGE-BYPASS'],
    harvest: { harvest_date: '2026-07-12', source_ids: ['sb_2681df6d-7385-4da9-8f49-916544f62586'], reformulated: true },
  }),

  base('hb2-0005', 'code_multi_cause', {
    symptom: {
      narrative: "7H récurrent sur Daikin, arrêt après quelques minutes. Voyant clignote. Pression eau incertaine, appoint récent.",
      code_present: '7H',
      code_absent_by_design: false,
    },
    context: { brand: 'Daikin', equipment_type: 'pac_air_eau', in_corpus: true },
    hypotheses: [
      { id: 'pression_basse', label: 'Pression hydraulique basse', prior: 0.42, n_observations: 88, true_cause: true },
      { id: 'air_circuit', label: 'Air dans le circuit', prior: 0.28, n_observations: 58, true_cause: false },
      { id: 'flowswitch_hs', label: 'Flowswitch HS', prior: 0.15, n_observations: 31, true_cause: false },
      { id: 'pompe_grippee', label: 'Circulateur HS', prior: 0.15, n_observations: 29, true_cause: false },
    ],
    tests: [
      { action_id: 'MES-PRESSION', observation: '1,1 bar — sous le seuil constructeur', discriminates: ['pression_basse'], eliminates: [] },
      { action_id: 'MAN-REMPLISSAGE', observation: 'Pression portée à 1,5 bar, 7H ne revient plus', discriminates: ['pression_basse'], eliminates: ['air_circuit'], resolves: true },
      { action_id: 'MAN-PURGE', observation: 'Légère purge d air, pression stable', discriminates: ['air_circuit'], eliminates: [] },
      { action_id: 'REM-FLOWSWITCH', observation: 'Flowswitch conforme — remplacement inutile', discriminates: [], eliminates: ['flowswitch_hs'], wrong_part: true },
    ],
    expert_path: ['MES-PRESSION', 'MAN-REMPLISSAGE'],
    harvest: { harvest_date: '2026-07-11', source_ids: ['sb_24065c8d-ba46-4805-b979-6d54f1dfd236'], reformulated: true },
  }),

  // === no_code (5) ===
  base('hb2-0006', 'no_code', {
    symptom: {
      narrative: "Chaudière Vaillant : radiateurs tièdes en haut du réseau, bruit de circulation dans le groupe de sécurité. Aucun code affiché.",
      code_present: null,
      code_absent_by_design: true,
    },
    context: { brand: 'Vaillant', equipment_type: 'chaudiere_gaz', in_corpus: true, season: 'hiver' },
    hypotheses: [
      { id: 'air_circuit', label: 'Air dans le circuit', prior: 0.45, n_observations: 520, true_cause: true },
      { id: 'pression_basse', label: 'Pression basse', prior: 0.25, n_observations: 290, true_cause: false },
      { id: 'filtre_colmate', label: 'Filtre colmaté', prior: 0.18, n_observations: 210, true_cause: false },
      { id: 'pompe_grippee', label: 'Circulateur faible', prior: 0.12, n_observations: 140, true_cause: false },
    ],
    tests: [
      { action_id: 'MES-PRESSION', observation: '1,3 bar mesure au manometre — dans la plage', discriminates: ['pression_basse'], eliminates: [] },
      { action_id: 'OBS-PURGEUR', observation: 'Purgeur radiateur crache de l air', discriminates: ['air_circuit'], eliminates: [] },
      { action_id: 'MAN-PURGE', observation: 'Purge radiateurs hauts, bruit disparaît, chauffage homogène', discriminates: ['air_circuit'], eliminates: ['pompe_grippee'], resolves: true },
    ],
    expert_path: ['MES-PRESSION', 'OBS-PURGEUR', 'MAN-PURGE'],
    tags: ['no_code', 'vaillant'],
  }),

  base('hb2-0007', 'no_code', {
    symptom: {
      narrative: "PAC Mitsubishi : production ECS OK mais chauffage absent. Pas de code. ΔT ressenti faible sur retour.",
      code_present: null,
      code_absent_by_design: true,
    },
    context: { brand: 'Mitsubishi', equipment_type: 'pac_air_eau', in_corpus: true },
    hypotheses: [
      { id: 'vanne_fermee', label: 'Vanne chauffage fermée', prior: 0.35, n_observations: 180, true_cause: true },
      { id: 'defaut_debit', label: 'Défaut de débit chauffage', prior: 0.3, n_observations: 155, true_cause: false },
      { id: 'carte_hs', label: 'Carte ou contacteur', prior: 0.2, n_observations: 102, true_cause: false },
      { id: 'sonde_hs', label: 'Sonde départ', prior: 0.15, n_observations: 78, true_cause: false },
    ],
    tests: [
      { action_id: 'OBS-VANNE', observation: 'Vanne 3 voies bloquée position ECS', discriminates: ['vanne_fermee'], eliminates: [] },
      { action_id: 'MES-DT-EAU', observation: 'ΔT quasi nul sur chauffage', discriminates: ['defaut_debit', 'vanne_fermee'], eliminates: [] },
      { action_id: 'MAN-FORCAGE-VENTILO', observation: 'Forçage vanne chauffage, débit reprend', discriminates: ['vanne_fermee'], eliminates: ['carte_hs'], resolves: true },
    ],
    expert_path: ['OBS-VANNE', 'MES-DT-EAU', 'MAN-FORCAGE-VENTILO'],
    tags: ['no_code'],
  }),

  base('hb2-0008', 'no_code', {
    symptom: {
      narrative: "Clim split : unité intérieure souffle tiède en mode froid, pas de code. Givre visible sur liaisons.",
      code_present: null,
      code_absent_by_design: true,
    },
    context: { brand: 'Daikin', equipment_type: 'clim_split', in_corpus: true, season: 'ete' },
    hypotheses: [
      { id: 'filtre_colmate', label: 'Filtres intérieurs colmatés', prior: 0.4, n_observations: 320, true_cause: true },
      { id: 'charge_insuffisante', label: 'Charge insuffisante', prior: 0.3, n_observations: 240, true_cause: false },
      { id: 'degivrage_anormal', label: 'Dégivrage bloqué', prior: 0.2, n_observations: 160, true_cause: false },
      { id: 'condensats_bouches', label: 'Condensats', prior: 0.1, n_observations: 80, true_cause: false },
    ],
    tests: [
      { action_id: 'OBS-GELEE', observation: 'Givre sur échangeur intérieur', discriminates: ['degivrage_anormal', 'charge_insuffisante'], eliminates: [] },
      { action_id: 'MAN-NETTOYAGE-FILTRE', observation: 'Filtres très encrassés, nettoyage effectué', discriminates: ['filtre_colmate'], eliminates: [] },
      { action_id: 'MES-HP-BP', observation: 'Pressions dans la plage après nettoyage filtres', discriminates: ['charge_insuffisante'], eliminates: ['charge_insuffisante'] },
      { action_id: 'MAN-RESET', observation: 'Froid rétabli après nettoyage et reset', discriminates: ['filtre_colmate'], eliminates: [], resolves: true },
    ],
    expert_path: ['OBS-GELEE', 'MAN-NETTOYAGE-FILTRE', 'MAN-RESET'],
    tags: ['no_code', 'clim'],
  }),

  base('hb2-0009', 'no_code', {
    symptom: {
      narrative: "Viessmann Vitodens : bruit de cavitation au circulateur, pas de défaut affiché. Installation ancienne non entretenue.",
      code_present: null,
      code_absent_by_design: true,
    },
    context: { brand: 'Viessmann', equipment_type: 'chaudiere_gaz', in_corpus: true },
    hypotheses: [
      { id: 'air_circuit', label: 'Air dans le circuit', prior: 0.38, n_observations: 410, true_cause: true },
      { id: 'pompe_grippee', label: 'Circulateur usé', prior: 0.32, n_observations: 345, true_cause: false },
      { id: 'pression_basse', label: 'Pression basse', prior: 0.2, n_observations: 215, true_cause: false },
      { id: 'filtre_colmate', label: 'Pot à boue colmaté', prior: 0.1, n_observations: 108, true_cause: false },
    ],
    tests: [
      { action_id: 'MES-PRESSION', observation: '1,0 bar mesure — sous le seuil minimum', discriminates: ['pression_basse'], eliminates: [] },
      { action_id: 'MAN-REMPLISSAGE', observation: '1,5 bar après appoint', discriminates: ['pression_basse'], eliminates: [] },
      { action_id: 'MAN-PURGE', observation: 'Cavitation disparaît après purge complète', discriminates: ['air_circuit'], eliminates: ['pompe_grippee'], resolves: true },
    ],
    expert_path: ['MES-PRESSION', 'MAN-REMPLISSAGE', 'MAN-PURGE'],
    tags: ['no_code'],
  }),

  base('hb2-0010', 'no_code', {
    symptom: {
      narrative: "Atlantic Alféa : température pièce instable, pas de code. Client signale des coupures ECS brèves.",
      code_present: null,
      code_absent_by_design: true,
    },
    context: { brand: 'Atlantic', equipment_type: 'pac_air_eau', in_corpus: true },
    hypotheses: [
      { id: 'sonde_hs', label: 'Sonde ambiance défaillante', prior: 0.35, n_observations: 95, true_cause: true },
      { id: 'defaut_debit', label: 'Débit insuffisant', prior: 0.3, n_observations: 82, true_cause: false },
      { id: 'carte_hs', label: 'Carte régulation', prior: 0.2, n_observations: 54, true_cause: false },
      { id: 'filtre_colmate', label: 'Filtre ECS', prior: 0.15, n_observations: 40, true_cause: false },
    ],
    tests: [
      { action_id: 'MES-SONDE', observation: 'Écart 4 K entre sonde UI et mesure locale', discriminates: ['sonde_hs'], eliminates: [] },
      { action_id: 'MES-DT-EAU', observation: 'ΔT chauffage normal', discriminates: ['defaut_debit'], eliminates: ['defaut_debit'] },
      { action_id: 'REM-SONDE', observation: 'Régulation stable après remplacement sonde', discriminates: ['sonde_hs'], eliminates: [], resolves: true },
    ],
    expert_path: ['MES-SONDE', 'MES-DT-EAU', 'REM-SONDE'],
    tags: ['no_code'],
  }),

  // === code_trompeur (5) ===
  base('hb2-0011', 'code_trompeur', {
    symptom: {
      narrative: "7H affiché, le SAV dit circulateur HS. Après remplacement chez un confrère, défaut identique. ΔT eau très faible.",
      code_present: '7H',
      code_absent_by_design: false,
    },
    context: { brand: 'Daikin', equipment_type: 'pac_air_eau', in_corpus: true },
    hypotheses: [
      { id: 'air_circuit', label: 'Air dans le circuit (vraie cause)', prior: 0.4, n_observations: 200, true_cause: true },
      { id: 'pompe_grippee', label: 'Circulateur HS (piste code)', prior: 0.35, n_observations: 175, true_cause: false },
      { id: 'flowswitch_hs', label: 'Flowswitch', prior: 0.15, n_observations: 75, true_cause: false },
      { id: 'pression_basse', label: 'Pression basse', prior: 0.1, n_observations: 50, true_cause: false },
    ],
    tests: [
      { action_id: 'MES-DT-EAU', observation: 'ΔT = 2 K malgré circulateur neuf', discriminates: ['air_circuit', 'pression_basse'], eliminates: ['pompe_grippee'] },
      { action_id: 'OBS-PURGEUR', observation: 'Air au purgeur haut', discriminates: ['air_circuit'], eliminates: [] },
      { action_id: 'MAN-PURGE', observation: 'Défaut résolu — circulateur remplacé à tort', discriminates: ['air_circuit'], eliminates: ['pompe_grippee'], resolves: true },
      { action_id: 'REM-CIRCULATEUR', observation: 'Remplacement déjà fait — inefficace', discriminates: [], eliminates: ['pompe_grippee'], wrong_part: true },
    ],
    expert_path: ['MES-DT-EAU', 'OBS-PURGEUR', 'MAN-PURGE'],
    forbidden_before: { 'REM-CIRCULATEUR': ['MAN-PURGE'] },
    tags: ['7H', 'trompeur'],
  }),

  base('hb2-0012', 'code_trompeur', {
    symptom: {
      narrative: "Code débit sur Vaillant F.75 — remplacement circulateur proposé. Filtre à tamis jamais contrôlé.",
      code_present: 'F.75',
      code_absent_by_design: false,
    },
    context: { brand: 'Vaillant', equipment_type: 'chaudiere_gaz', in_corpus: true },
    hypotheses: [
      { id: 'filtre_colmate', label: 'Filtre colmaté (vraie cause)', prior: 0.45, n_observations: 310, true_cause: true },
      { id: 'pompe_grippee', label: 'Circulateur (sens code)', prior: 0.35, n_observations: 240, true_cause: false },
      { id: 'air_circuit', label: 'Air circuit', prior: 0.12, n_observations: 82, true_cause: false },
      { id: 'flowswitch_hs', label: 'Capteur débit', prior: 0.08, n_observations: 55, true_cause: false },
    ],
    tests: [
      { action_id: 'DEM-FILTRE', observation: 'Tamis bouché de boue', discriminates: ['filtre_colmate'], eliminates: [] },
      { action_id: 'MAN-NETTOYAGE-FILTRE', observation: 'Débit rétabli, F.75 disparaît', discriminates: ['filtre_colmate'], eliminates: ['pompe_grippee'], resolves: true },
      { action_id: 'REM-CIRCULATEUR', observation: 'Circulateur sain — remplacement évité', discriminates: [], eliminates: ['pompe_grippee'], wrong_part: true },
    ],
    expert_path: ['DEM-FILTRE', 'MAN-NETTOYAGE-FILTRE'],
    tags: ['F.75', 'trompeur'],
  }),

  base('hb2-0013', 'code_trompeur', {
    symptom: {
      narrative: "E7 sur Mitsubishi — code pointe sonde liquide. Mesures HP/BP normales, givre sur aspiration.",
      code_present: 'E7',
      code_absent_by_design: false,
    },
    context: { brand: 'Mitsubishi', equipment_type: 'pac_air_eau', in_corpus: true },
    hypotheses: [
      { id: 'filtre_colmate', label: 'Filtre air UE colmaté (vraie cause)', prior: 0.4, n_observations: 165, true_cause: true },
      { id: 'sonde_hs', label: 'Sonde liquide (sens code)', prior: 0.35, n_observations: 142, true_cause: false },
      { id: 'charge_insuffisante', label: 'Charge basse', prior: 0.15, n_observations: 61, true_cause: false },
      { id: 'degivrage_anormal', label: 'Dégivrage', prior: 0.1, n_observations: 40, true_cause: false },
    ],
    tests: [
      { action_id: 'OBS-GELEE', observation: 'Givre uniforme échangeur — manque d air', discriminates: ['filtre_colmate', 'charge_insuffisante'], eliminates: [] },
      { action_id: 'MES-HP-BP', observation: 'Pressions nominales', discriminates: ['charge_insuffisante'], eliminates: ['charge_insuffisante', 'sonde_hs'] },
      { action_id: 'MAN-NETTOYAGE-FILTRE', observation: 'Filtres UE très sales, E7 disparaît', discriminates: ['filtre_colmate'], eliminates: ['sonde_hs'], resolves: true },
    ],
    expert_path: ['OBS-GELEE', 'MES-HP-BP', 'MAN-NETTOYAGE-FILTRE'],
    tags: ['E7', 'trompeur'],
  }),

  base('hb2-0014', 'code_trompeur', {
    symptom: {
      narrative: "L2 Toshiba — documentation indique ventilateur. Ventilateur tourne, condensats débordent du bac.",
      code_present: 'L2',
      code_absent_by_design: false,
    },
    context: { brand: 'Toshiba', equipment_type: 'clim_split', in_corpus: true },
    hypotheses: [
      { id: 'condensats_bouches', label: 'Condensats bouchés (vraie cause)', prior: 0.5, n_observations: 88, true_cause: true },
      { id: 'degivrage_anormal', label: 'Ventilateur (sens code)', prior: 0.25, n_observations: 44, true_cause: false },
      { id: 'carte_hs', label: 'Carte UI', prior: 0.15, n_observations: 26, true_cause: false },
      { id: 'filtre_colmate', label: 'Filtre', prior: 0.1, n_observations: 18, true_cause: false },
    ],
    tests: [
      { action_id: 'OBS-CONDENSATS', observation: 'Bac plein, évacuation obstruée', discriminates: ['condensats_bouches'], eliminates: [] },
      { action_id: 'MAN-DESENGORGEMENT', observation: 'Écoulement rétabli, L2 disparaît', discriminates: ['condensats_bouches'], eliminates: ['degivrage_anormal'], resolves: true },
      { action_id: 'REM-VENTILO', observation: 'Ventilateur conforme — remplacement inutile', discriminates: [], eliminates: ['degivrage_anormal'], wrong_part: true },
    ],
    expert_path: ['OBS-CONDENSATS', 'MAN-DESENGORGEMENT'],
    tags: ['L2', 'trompeur'],
  }),

  base('hb2-0015', 'code_trompeur', {
    symptom: {
      narrative: "A5 Panasonic — code sonde. Résistance de chauffe ECS OK, câble sonde écrasé derrière cloche.",
      code_present: 'A5',
      code_absent_by_design: false,
    },
    context: { brand: 'Panasonic', equipment_type: 'pac_air_eau', in_corpus: true },
    hypotheses: [
      { id: 'sonde_hs', label: 'Câblage sonde endommagé (vraie cause)', prior: 0.42, n_observations: 76, true_cause: true },
      { id: 'carte_hs', label: 'Carte (sens code)', prior: 0.33, n_observations: 60, true_cause: false },
      { id: 'defaut_transitoire', label: 'Défaut transitoire', prior: 0.15, n_observations: 27, true_cause: false },
      { id: 'charge_insuffisante', label: 'Charge', prior: 0.1, n_observations: 18, true_cause: false },
    ],
    tests: [
      { action_id: 'MES-CONTINUITE', observation: 'Coupure fil sonde ECS au passage cloche', discriminates: ['sonde_hs'], eliminates: ['carte_hs'] },
      { action_id: 'MES-RESISTANCE', observation: 'Résistance chauffe conforme', discriminates: [], eliminates: ['carte_hs'] },
      { action_id: 'DEM-SONDE', observation: 'Réparation câblage, A5 disparaît', discriminates: ['sonde_hs'], eliminates: [], resolves: true },
    ],
    expert_path: ['MES-CONTINUITE', 'MES-RESISTANCE', 'DEM-SONDE'],
    tags: ['A5', 'trompeur'],
  }),

  // === hors_corpus (5) ===
  base('hb2-0016', 'hors_corpus', {
    symptom: {
      narrative: "Nibe F2045 : arrêt aléatoire sans code. Pression OK. Pas de doc AskMarcel pour ce firmware.",
      code_present: null,
      code_absent_by_design: true,
    },
    context: { brand: 'Nibe', model: 'F2045', equipment_type: 'pac_air_eau', in_corpus: false, season: 'hiver' },
    hypotheses: [
      { id: 'defaut_debit', label: 'Défaut de débit', prior: 0.35, n_observations: 0, source: 'generic_physics', true_cause: true },
      { id: 'sonde_hs', label: 'Sonde défectueuse', prior: 0.3, n_observations: 0, source: 'generic_physics', true_cause: false },
      { id: 'air_circuit', label: 'Air circuit', prior: 0.2, n_observations: 0, source: 'generic_physics', true_cause: false },
      { id: 'carte_hs', label: 'Carte', prior: 0.15, n_observations: 0, source: 'generic_physics', true_cause: false },
    ],
    tests: [
      { action_id: 'MES-DT-EAU', observation: 'ΔT = 3 K — limite basse', discriminates: ['defaut_debit'], eliminates: [] },
      { action_id: 'MES-PRESSION', observation: '1,6 bar — OK', discriminates: [], eliminates: ['air_circuit'] },
      { action_id: 'MAN-PURGE', observation: 'Légère purge, ΔT monte à 6 K, arrêts cessent', discriminates: ['air_circuit', 'defaut_debit'], eliminates: [], resolves: true },
    ],
    expert_path: ['MES-PRESSION', 'MES-DT-EAU', 'MAN-PURGE'],
    tags: ['hors_corpus', 'nibe'],
  }),

  base('hb2-0017', 'hors_corpus', {
    symptom: {
      narrative: "Carrier 30RQ : alarme débit, marque absente du corpus. Groupe froid tertiaire, pas de manuel indexé.",
      code_present: 'ALM-FLOW',
      code_absent_by_design: false,
    },
    context: { brand: 'Carrier', equipment_type: 'crac_precision', in_corpus: false },
    hypotheses: [
      { id: 'filtre_colmate', label: 'Filtre colmaté', prior: 0.4, n_observations: 0, source: 'generic_physics', true_cause: true },
      { id: 'defaut_debit', label: 'Défaut débit pompe', prior: 0.35, n_observations: 0, source: 'generic_physics', true_cause: false },
      { id: 'flowswitch_hs', label: 'Capteur débit', prior: 0.15, n_observations: 0, source: 'generic_physics', true_cause: false },
      { id: 'vanne_fermee', label: 'Vanne fermée', prior: 0.1, n_observations: 0, source: 'generic_physics', true_cause: false },
    ],
    tests: [
      { action_id: 'OBS-VANNE', observation: 'Vannes ouvertes', discriminates: ['vanne_fermee'], eliminates: ['vanne_fermee'] },
      { action_id: 'DEM-FILTRE', observation: 'Filtre boue saturé', discriminates: ['filtre_colmate'], eliminates: [] },
      { action_id: 'MAN-NETTOYAGE-FILTRE', observation: 'Alarme disparaît', discriminates: ['filtre_colmate'], eliminates: ['defaut_debit'], resolves: true },
    ],
    expert_path: ['OBS-VANNE', 'DEM-FILTRE', 'MAN-NETTOYAGE-FILTRE'],
    tags: ['hors_corpus'],
  }),

  base('hb2-0018', 'hors_corpus', {
    symptom: {
      narrative: "Alpha Innotec SWC : COP effondré, pas de doc. Échangeur sale côté source.",
      code_present: null,
      code_absent_by_design: true,
    },
    context: { brand: 'Alpha Innotec', equipment_type: 'pac_geothermie', in_corpus: false },
    hypotheses: [
      { id: 'filtre_colmate', label: 'Échangeur encrassé', prior: 0.45, n_observations: 0, source: 'generic_physics', true_cause: true },
      { id: 'defaut_debit', label: 'Débit source insuffisant', prior: 0.3, n_observations: 0, source: 'generic_physics', true_cause: false },
      { id: 'charge_insuffisante', label: 'Charge frigo', prior: 0.15, n_observations: 0, source: 'generic_physics', true_cause: false },
      { id: 'sonde_hs', label: 'Sonde', prior: 0.1, n_observations: 0, source: 'generic_physics', true_cause: false },
    ],
    tests: [
      { action_id: 'MES-DT-EAU', observation: 'Delta T source faible sur echangeur geothermie', discriminates: ['defaut_debit', 'filtre_colmate'], eliminates: [] },
      { action_id: 'OBS-GELEE', observation: 'Encrassement visible sur ailettes echangeur', discriminates: ['filtre_colmate'], eliminates: [] },
      { action_id: 'MAN-NETTOYAGE-FILTRE', observation: 'Nettoyage echangeur, COP remonte nettement', discriminates: ['filtre_colmate'], eliminates: [], resolves: true },
    ],
    expert_path: ['MES-DT-EAU', 'MAN-NETTOYAGE-FILTRE'],
    tags: ['hors_corpus'],
  }),

  base('hb2-0019', 'hors_corpus', {
    symptom: {
      narrative: "Grundfos Magna3 en défaut sur réseau secondaire. Pas de fiche dans le corpus.",
      code_present: null,
      code_absent_by_design: true,
    },
    context: { brand: 'Grundfos', equipment_type: 'autre', in_corpus: false },
    hypotheses: [
      { id: 'pompe_grippee', label: 'Pompe bloquée', prior: 0.4, n_observations: 0, source: 'generic_physics', true_cause: true },
      { id: 'carte_hs', label: 'Électronique pompe', prior: 0.3, n_observations: 0, source: 'generic_physics', true_cause: false },
      { id: 'defaut_debit', label: 'Débit nul', prior: 0.2, n_observations: 0, source: 'generic_physics', true_cause: false },
      { id: 'air_circuit', label: 'Air dans circuit', prior: 0.1, n_observations: 0, source: 'generic_physics', true_cause: false },
    ],
    tests: [
      { action_id: 'OBS-BRUIT-POMPE', observation: 'Tentative demarrage puis blocage rotor pompe', discriminates: ['pompe_grippee'], eliminates: [] },
      { action_id: 'MES-AMPERAGE', observation: 'Pic ampere puis zero — protection thermique', discriminates: ['pompe_grippee'], eliminates: ['carte_hs'] },
      { action_id: 'MAN-RESET', observation: 'Deblocage manuel rotor, fonctionnement retabli', discriminates: ['pompe_grippee'], eliminates: ['carte_hs'], resolves: true },
    ],
    expert_path: ['OBS-BRUIT-POMPE', 'MAN-RESET'],
    tags: ['hors_corpus'],
  }),

  base('hb2-0020', 'hors_corpus', {
    symptom: {
      narrative: "Wolf CGB-2 : oscillation combustion, pas de manuel Wolf indexé. CO mesuré limite.",
      code_present: null,
      code_absent_by_design: true,
    },
    context: { brand: 'Wolf', equipment_type: 'chaudiere_gaz', in_corpus: false },
    hypotheses: [
      { id: 'filtre_colmate', label: 'Brûleur encrassé', prior: 0.4, n_observations: 0, source: 'generic_physics', true_cause: true },
      { id: 'defaut_debit', label: 'Débit gaz', prior: 0.25, n_observations: 0, source: 'generic_physics', true_cause: false },
      { id: 'sonde_hs', label: 'Sonde combustion', prior: 0.2, n_observations: 0, source: 'generic_physics', true_cause: false },
      { id: 'carte_hs', label: 'Carte', prior: 0.15, n_observations: 0, source: 'generic_physics', true_cause: false },
    ],
    tests: [
      { action_id: 'OBS-FUITE', observation: 'Pas de fuite gaz', discriminates: [], eliminates: ['defaut_debit'] },
      { action_id: 'DEM-FILTRE', observation: 'Brûleur et gicleur encrassés', discriminates: ['filtre_colmate'], eliminates: [] },
      { action_id: 'MAN-NETTOYAGE-FILTRE', observation: 'Combustion stable après nettoyage', discriminates: ['filtre_colmate'], eliminates: [], resolves: true },
    ],
    expert_path: ['OBS-FUITE', 'DEM-FILTRE', 'MAN-NETTOYAGE-FILTRE'],
    tags: ['hors_corpus'],
  }),
];

const outDir = join(process.cwd(), 'dataset', 'pilot');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'pilot-v2.jsonl');
writeFileSync(outPath, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');

const csv = [
  'case_id,expert_path_proposed,expert_path_validated,notes_marcel',
  ...cases.map((c) => {
    const path = (c.expert_path as string[]).join(' > ');
    return `${c.id},"${path}","${path}",""`;
  }),
];
writeFileSync(join(process.cwd(), 'workflow', 'pilot-v2-expert-path-review.csv'), csv.join('\n') + '\n');

console.log(`Wrote ${cases.length} cases to ${outPath}`);
