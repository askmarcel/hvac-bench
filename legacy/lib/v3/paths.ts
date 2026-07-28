import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

export const PATHS = {
  root: ROOT,
  quantities: resolve(ROOT, 'taxonomy/quantities-v3.json'),
  faultTree: resolve(ROOT, 'taxonomy/fault-tree-v3-pac_air_eau.json'),
  actionMap: resolve(ROOT, 'taxonomy/action-quantity-map-v3.json'),
  actionBlacklist: resolve(ROOT, 'taxonomy/action-blacklist-v3.json'),
  schemaV3: resolve(ROOT, 'dataset/schema-v3.json'),
  knowledgeManifest: resolve(ROOT, 'config/knowledge-v3-manifest.json'),
  pilotV2: resolve(ROOT, 'dataset/pilot/pilot-v2.jsonl'),
  pilotV3Pac: resolve(ROOT, 'dataset/pilot/pilot-v3-pac_air_eau.jsonl'),
  historicalV3: resolve(ROOT, 'dataset/public/historical-v3-pac_air_eau.jsonl'),
  actionsV2: resolve(ROOT, 'taxonomy/actions-v2.json'),
  readingsExtraction: resolve(ROOT, 'reports/readings-extraction-v3.json'),
  treeCoverage: resolve(ROOT, 'reports/tree-coverage-v3.json'),
  marcelReview: resolve(ROOT, 'workflow/marcel-review-v3.csv'),
  marcelResolved: resolve(ROOT, 'workflow/marcel-review-v3-resolved.csv'),
  marcelParserReview: resolve(ROOT, 'workflow/marcel-review-parser-v3.csv'),
  h0Assessment: resolve(ROOT, 'reports/p0-h0-assessment.md'),
  priorsSpec: resolve(ROOT, 'docs/priors-v3-merge.md'),
  likelihoodsV3Adjusted: resolve(ROOT, 'config/likelihoods-v3-adjusted.json'),
  conclusionThresholdV3: resolve(ROOT, 'config/conclusion-threshold-v3.json'),
} as const;
