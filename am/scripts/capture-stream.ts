#!/usr/bin/env tsx
/**
 * Capture le flux HTTP brut d'un tour harnais (0 simulateur, 0 juge).
 * À exécuter AVANT de fabriquer des fixtures parseur — le raw.jsonl reconstruit
 * depuis score.json ne contient pas le flux SSE.
 *
 * Usage:
 *   AM_HARNESS_TRANSPORT=http AM_HARNESS_URL=… AM_HARNESS_BEARER_TOKEN=… \
 *     pnpm am:capture-stream --arm PROD --case ham-0016 --out fixtures/streams/ham-0016-prod.txt
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { loadCaseById } from '../runner/manifest.js';
import { resolveHarnessBaseUrl } from '../runner/harness-client.js';
import { getHarnessBearerToken } from '../runner/bench-auth.js';

const ARM_TO_MODE = { L0: 'l0', LW: 'lw', PROD: 'prod' } as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const arm = (arg('arm') ?? 'PROD') as keyof typeof ARM_TO_MODE;
  const caseId = arg('case') ?? 'ham-0016';
  const out = resolve(arg('out') ?? `am/runner/fixtures/streams/${caseId}-${arm.toLowerCase()}.txt`);
  const baseUrl = resolveHarnessBaseUrl('S2', process.env.AM_HARNESS_URL);
  const bearerToken = process.env.AM_HARNESS_BEARER_TOKEN ?? (await getHarnessBearerToken());

  const amCase = loadCaseById(caseId);
  const plainte = amCase.plainte_initiale.trim();
  if (!plainte) throw new Error(`plainte_initiale vide sur ${caseId}`);

  const chatId = randomUUID();
  const body = {
    id: chatId,
    modelId: process.env.AM_HARNESS_MODEL_ID ?? 'fast-marcel',
    messages: [
      {
        id: `${chatId}-0`,
        role: 'user',
        parts: [{ type: 'text', text: plainte }],
      },
    ],
    diagnosticContext: amCase.equipement?.marque
      ? { brandName: amCase.equipement.marque, modelName: amCase.equipement.modele }
      : undefined,
  };

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
      'x-bench-mode': '1',
      'x-harnais-mode': ARM_TO_MODE[arm],
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    [
      `# capture-stream ${new Date().toISOString()}`,
      `# arm=${arm} case=${caseId} url=${baseUrl} status=${response.status}`,
      '',
      raw,
    ].join('\n'),
  );

  console.log(`✅ Flux capturé (${raw.length} octets) → ${out}`);
  if (!response.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
