/** Normalisations déterministes. Aucun appel LLM (CDC NFR-4). */
import type { BenchIndex } from './types.js';

// Écrit avec des échappements plutôt qu'en littéral : les marques combinantes brutes
// dans une regex sont invisibles à la relecture et se corrompent au copier-coller.
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

export function stripAccents(input: string): string {
  return input.normalize('NFD').replace(COMBINING_MARKS, '');
}

export function slugify(input: string): string {
  return stripAccents(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Normalise un code afficheur : casse, espaces et séparateurs sont ignorés.
 * « AL 05 », « al-05 » et « AL05 » désignent le même code ; « F.755 » et « F755 » aussi.
 */
export function normalizeCode(input: string | null | undefined): string {
  if (!input) return '';
  return stripAccents(input).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Résout un libellé de marque vers son slug canonique via les alias exportés du corpus. */
export function resolveBrandSlug(label: string | null | undefined, index: BenchIndex): string | null {
  if (!label) return null;
  const needle = label.toLowerCase().trim();
  const needleSlug = slugify(label);

  for (const [slug, aliases] of Object.entries(index.brand_aliases)) {
    if (slug === needleSlug) return slug;
    if (aliases.includes(needle)) return slug;
    if (aliases.some((a) => slugify(a) === needleSlug)) return slug;
  }
  return null;
}

/**
 * Deux libellés de marque sont équivalents s'ils résolvent vers le même slug canonique.
 * En dernier recours (marque absente du corpus, cas out_of_coverage) on compare les slugs :
 * sans cela toute marque inconnue paraîtrait équivalente à toute autre.
 */
export function brandsEquivalent(a: string | null, b: string | null, index: BenchIndex): boolean {
  if (!a || !b) return false;
  const sa = resolveBrandSlug(a, index);
  const sb = resolveBrandSlug(b, index);
  if (sa && sb) return sa === sb;
  return slugify(a) === slugify(b);
}

const STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'est', 'sont', 'a', 'au', 'aux',
  'en', 'dans', 'sur', 'pour', 'par', 'avec', 'sans', 'que', 'qui', 'ce', 'cette', 'ces', 'son',
  'sa', 'ses', 'il', 'elle', 'ne', 'pas', 'plus', 'si', 'the', 'and', 'of', 'to', 'is', 'in',
  'code', 'erreur', 'error', 'defaut', 'panne',
]);

export function contentTokens(text: string): Set<string> {
  return new Set(
    stripAccents(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t)),
  );
}

/**
 * Part des termes techniques de la vérité terrain présents dans la réponse.
 * Signal secondaire uniquement : une vraie évaluation du sens relève de la rubrique
 * `workflow`, qui est humaine et hors gate (CDC §4.6).
 */
export function meaningOverlap(expected: string, observed: string): number {
  const exp = contentTokens(expected);
  if (exp.size === 0) return 0;
  const obs = contentTokens(observed);
  let hits = 0;
  for (const token of exp) if (obs.has(token)) hits += 1;
  return hits / exp.size;
}

/** Rapproche un titre de manuel cité d'un document du corpus. */
export function resolveDocumentByTitle(title: string | null | undefined, index: BenchIndex) {
  if (!title) return null;
  const needle = slugify(title);
  if (!needle) return null;

  const exact = index.documents.find((d) => slugify(d.title) === needle);
  if (exact) return exact;

  // Tolérance aux titres tronqués ou suffixés par l'affichage, mais pas aux titres vagues.
  if (needle.length < 12) return null;
  const partial = index.documents.filter(
    (d) => slugify(d.title).includes(needle) || needle.includes(slugify(d.title)),
  );
  return partial.length === 1 ? partial[0] : null;
}
