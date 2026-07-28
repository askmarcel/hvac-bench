#!/usr/bin/env tsx
/**
 * am:validate-cases — valide les cas du bench Harnais-AskMarcel contre schema-am.json
 * + règles métier non exprimables (proprement) en JSON Schema.
 *
 * Usage:
 *   tsx am/scripts/validate-cases.ts                 # valide am/cases/dev + am/cases/gate
 *   tsx am/scripts/validate-cases.ts <fichier.json>   # valide un fichier précis (fixtures, ad hoc)
 *   tsx am/scripts/validate-cases.ts <dossier>        # valide tous les .json d'un dossier
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const AM_ROOT = resolve(import.meta.dirname, '..');
const SCHEMA_PATH = resolve(AM_ROOT, 'cases/schema-am.json');
const DEFAULT_TARGETS = [resolve(AM_ROOT, 'cases/dev'), resolve(AM_ROOT, 'cases/gate')];

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const validateSchema = ajv.compile(schema);

type AmCase = {
  id: string;
  ground_state: Record<string, unknown>;
  verite: { cause: string };
  provenance: { valide_par: string | null };
  split: 'dev' | 'gate';
};

function collectJsonFiles(target: string): string[] {
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return target.endsWith('.json') ? [target] : [];
  if (!stat.isDirectory()) return [];
  return readdirSync(target)
    .map((entry) => resolve(target, entry))
    .flatMap((entryPath) => collectJsonFiles(entryPath));
}

/** Règles métier — T2 du plan d'exécution (au-delà du schéma structurel). */
function semanticErrors(c: AmCase, file: string): string[] {
  const errors: string[] = [];

  if (!c.ground_state || Object.keys(c.ground_state).length === 0) {
    errors.push('ground_state doit être non vide');
  }

  if (!c.verite?.cause || c.verite.cause.trim().length === 0) {
    errors.push('verite.cause doit être non vide');
  }

  if (c.split !== 'dev' && c.split !== 'gate') {
    errors.push(`split doit être 'dev' ou 'gate', reçu '${c.split}'`);
  } else {
    // Le split déclaré doit correspondre au dossier qui le contient (dev/ vs gate/),
    // sauf pour les fichiers validés hors arborescence cases/ (fixtures, ad hoc).
    const parentDir = basename(dirname(file));
    const inCasesTree = dirname(file).includes(`${resolve(AM_ROOT, 'cases')}`);
    if (inCasesTree && (parentDir === 'dev' || parentDir === 'gate') && parentDir !== c.split) {
      errors.push(`split='${c.split}' incohérent avec le dossier '${parentDir}/'`);
    }
  }

  if (c.split === 'gate' && !c.provenance?.valide_par) {
    errors.push("provenance.valide_par obligatoire (format 'marcel:<date>') pour split=gate");
  }

  return errors.map((e) => `${basename(file)}: ${e}`);
}

function main() {
  const args = process.argv.slice(2);
  const targets = args.length > 0 ? args.map((a) => resolve(a)) : DEFAULT_TARGETS;
  const files = targets.flatMap(collectJsonFiles).sort();

  if (files.length === 0) {
    console.error('Aucun fichier .json trouvé pour', targets.join(', '));
    process.exit(1);
  }

  let failCount = 0;
  const seenIds = new Set<string>();

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`❌ ${basename(file)}: JSON invalide — ${(e as Error).message}`);
      failCount++;
      continue;
    }

    const structOk = validateSchema(parsed);
    const structErrors = structOk
      ? []
      : (validateSchema.errors ?? []).map(
          (err) => `${basename(file)}: ${err.instancePath || '(racine)'} ${err.message}`,
        );

    // Toujours exécutées (avec accès défensif) pour remonter tous les problèmes en un passage,
    // pas seulement le premier échec structurel.
    const semantic = semanticErrors(parsed as AmCase, file);

    const dupErrors: string[] = [];
    if (structOk) {
      const id = (parsed as AmCase).id;
      if (seenIds.has(id)) dupErrors.push(`${basename(file)}: id '${id}' dupliqué`);
      seenIds.add(id);
    }

    const allErrors = [...structErrors, ...semantic, ...dupErrors];
    if (allErrors.length > 0) {
      failCount++;
      console.error(`❌ ${basename(file)}`);
      for (const err of allErrors) console.error(`   - ${err}`);
    } else {
      console.log(`✅ ${basename(file)}`);
    }
  }

  console.log(`\n${files.length - failCount}/${files.length} cas valides.`);
  if (failCount > 0) process.exit(1);
}

main();
