/**
 * Charge et indexe la connaissance P0 (quantities, fault-tree, action map).
 */
import { readFileSync } from 'node:fs';

import { LR_VALUES, type LrTier } from './constants.js';
import { PATHS } from './paths.js';
import type {
  ActionQuantityMap,
  Band,
  CaseContext,
  CauseDef,
  FaultTree,
  QuantitiesFile,
  QuantityDef,
} from './types.js';

let _quantities: Map<string, QuantityDef> | null = null;
let _faultTree: FaultTree | null = null;
let _actionMap: ActionQuantityMap | null = null;
let _quantityToActions: Map<string, string[]> | null = null;
let _lrValuesOverride: Record<LrTier, number> | null = null;

export function setLrValuesOverride(values: Record<LrTier, number> | null): void {
  _lrValuesOverride = values;
}

export function getActiveLrValues(): Record<LrTier, number> {
  return _lrValuesOverride ?? LR_VALUES;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function loadQuantitiesFile(): QuantitiesFile {
  return loadJson<QuantitiesFile>(PATHS.quantities);
}

export function loadFaultTreeFile(): FaultTree {
  return loadJson<FaultTree>(PATHS.faultTree);
}

export function loadActionMapFile(): ActionQuantityMap {
  return loadJson<ActionQuantityMap>(PATHS.actionMap);
}

function ensureLoaded(): void {
  if (_quantities && _faultTree && _actionMap) return;

  const qFile = loadQuantitiesFile();
  _quantities = new Map(qFile.quantities.map((q) => [q.quantity_id, q]));

  _faultTree = loadFaultTreeFile();

  _actionMap = loadActionMapFile();
  _quantityToActions = new Map();
  for (const [actionId, entry] of Object.entries(_actionMap.mes)) {
    for (const qid of entry.quantities) {
      const list = _quantityToActions.get(qid) ?? [];
      list.push(actionId);
      _quantityToActions.set(qid, list);
    }
  }
  for (const [actionId, entry] of Object.entries(_actionMap.obs)) {
    const list = _quantityToActions.get(entry.quantity) ?? [];
    list.push(actionId);
    _quantityToActions.set(entry.quantity, list);
  }
}

export function resetKnowledgeCache(): void {
  _quantities = null;
  _faultTree = null;
  _actionMap = null;
  _quantityToActions = null;
  _lrValuesOverride = null;
}

export function getQuantity(quantityId: string): QuantityDef | undefined {
  ensureLoaded();
  return _quantities!.get(quantityId);
}

export function getAllQuantities(): QuantityDef[] {
  ensureLoaded();
  return [..._quantities!.values()];
}

export function getFaultTree(): FaultTree {
  ensureLoaded();
  return _faultTree!;
}

export function getCause(causeId: string): CauseDef | undefined {
  return getFaultTree().causes.find((c) => c.cause_id === causeId);
}

export function getAllCauses(): CauseDef[] {
  return getFaultTree().causes;
}

export function getActionMap(): ActionQuantityMap {
  ensureLoaded();
  return _actionMap!;
}

export function getActionsForQuantity(quantityId: string): string[] {
  ensureLoaded();
  return _quantityToActions!.get(quantityId) ?? [];
}

export function getPrimaryQuantityForAction(actionId: string): string | null {
  const map = getActionMap();
  const mes = map.mes[actionId];
  if (mes) return mes.quantities[0] ?? null;
  const obs = map.obs[actionId];
  if (obs) return obs.quantity;
  return null;
}

export function getQuantitiesForAction(actionId: string): string[] {
  const map = getActionMap();
  const mes = map.mes[actionId];
  if (mes) return mes.quantities;
  const obs = map.obs[actionId];
  if (obs) return [obs.quantity];
  return [];
}

function normalizeBrandKey(context: CaseContext): string | null {
  const raw = context.brand;
  if (raw == null || typeof raw !== 'string' || !raw.length) return null;
  const b = raw.toLowerCase().replace(/\s+/g, '_');
  if (b.includes('daikin')) return 'daikin';
  if (b.includes('atlantic') || b.includes('alfea')) return 'atlantic';
  if (b.includes('mitsubishi')) return 'mitsubishi';
  if (b.includes('panasonic')) return 'panasonic';
  if (b.includes('viessmann')) return 'viessmann';
  return b;
}

/** Résout la clé de contexte pour une grandeur (emitter, regime_eau, brand, etc.). */
function resolveConditionKey(
  quantity: QuantityDef,
  context: CaseContext,
): string | null {
  const varName = quantity.condition_var;
  if (!varName) return null;
  if (varName === 'brand') return normalizeBrandKey(context);
  const val = context[varName as keyof CaseContext];
  if (val != null && typeof val === 'string' && val.length > 0) return val;
  if (val != null && typeof val === 'number') return String(val);
  return null;
}

/**
 * Plage nominale contextualisée.
 * Repli : clé contexte → default → enveloppe min/max de toutes les plages.
 */
export function getNominalRange(
  quantityId: string,
  context: CaseContext,
): [number, number] | null {
  const q = getQuantity(quantityId);
  if (!q?.nominal) return null;

  const key = resolveConditionKey(q, context);
  if (key && q.nominal[key]) return q.nominal[key]!;

  if (q.nominal.default) return q.nominal.default;

  const ranges = Object.values(q.nominal);
  if (ranges.length === 0) return null;
  const lo = Math.min(...ranges.map((r) => r[0]));
  const hi = Math.max(...ranges.map((r) => r[1]));
  return [lo, hi];
}

export function valueToBand(value: number, range: [number, number]): Band {
  const [lo, hi] = range;
  if (value < lo) return 'below';
  if (value > hi) return 'above';
  return 'in';
}

export function getLrTier(tier: LrTier, effectStatus?: 'sourced' | 'draft'): number {
  const values = getActiveLrValues();
  let effective: LrTier = tier;
  if (effectStatus === 'draft') {
    const degrade: Record<LrTier, LrTier> = { fort: 'moyen', moyen: 'faible', faible: 'faible' };
    effective = degrade[tier];
  }
  return values[effective];
}

export function getPostRepairLr(kind: 'confirmatory' | 'counterfactual'): number {
  const tree = getFaultTree();
  const values = getActiveLrValues();
  const tier = tree.post_repair_rules[kind].lr;
  return values[tier];
}
