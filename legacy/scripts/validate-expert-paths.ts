/**
 * Valide que les expert_path du pilote sont approuvés par Marcel.
 *
 * Usage: pnpm validate:expert-paths
 * Bypass dev (non prod): BENCH_ALLOW_PENDING_EXPERT_PATHS=1
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSV_PATH = resolve(import.meta.dirname, '../workflow/pilot-v2-expert-path-review.csv');
const EXPECTED_CASES = 20;

type ReviewRow = {
  case_id: string;
  expert_path_proposed: string;
  expert_path_validated: string;
  review_status: string;
  notes_marcel: string;
};

function parseCsv(text: string): ReviewRow[] {
  const lines = text.trim().split('\n');
  const header = lines[0]!.split(',');
  const rows: ReviewRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const parts: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        parts.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    parts.push(cur);
    const row: Record<string, string> = {};
    header.forEach((h, idx) => {
      row[h.trim()] = parts[idx]?.trim() ?? '';
    });
    rows.push(row as ReviewRow);
  }
  return rows;
}

export function validateExpertPaths(options?: { allowPending?: boolean }): {
  ok: boolean;
  approved: number;
  total: number;
  pending: string[];
} {
  const allowPending =
    options?.allowPending ?? process.env.BENCH_ALLOW_PENDING_EXPERT_PATHS === '1';
  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  const pending: string[] = [];
  let approved = 0;

  for (const row of rows) {
    if (!row.expert_path_validated) {
      pending.push(`${row.case_id}: expert_path_validated vide`);
      continue;
    }
    if (row.review_status !== 'approved') {
      if (allowPending) continue;
      pending.push(`${row.case_id}: review_status=${row.review_status}`);
      continue;
    }
    approved++;
  }

  const total = rows.length;
  const ok =
    total === EXPECTED_CASES &&
    pending.length === 0 &&
    (allowPending ? rows.every((r) => r.expert_path_validated) : approved === EXPECTED_CASES);

  return { ok, approved: allowPending ? rows.filter((r) => r.expert_path_validated).length : approved, total, pending };
}

function main() {
  const result = validateExpertPaths();
  if (result.ok) {
    console.log(`OK : ${result.approved}/${result.total} expert_path validés (approved).`);
    return;
  }
  console.error(`ÉCHEC : ${result.approved}/${EXPECTED_CASES} approuvés.`);
  for (const p of result.pending) console.error(`  - ${p}`);
  console.error(
    'Marcel doit mettre review_status=approved dans workflow/pilot-v2-expert-path-review.csv',
  );
  process.exit(1);
}

main();
