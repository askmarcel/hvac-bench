import { createHash } from 'node:crypto';

/** @deprecated Conservé pour audit ; n'entre plus dans la signature. */
export function symptomCluster(symptom: string): string {
  const words = symptom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .sort();
  return words.join('_') || 'generic';
}

/** Signature priors v2 : hash(equipment_type, code) — sans symptom_cluster. */
export function buildSignature(
  equipmentType: string,
  code: string | null | undefined,
): string {
  return createHash('sha256')
    .update(`${equipmentType}|${code ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}
