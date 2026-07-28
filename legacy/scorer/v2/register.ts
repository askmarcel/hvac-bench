import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type RegisterBlacklist = {
  version: string;
  flags: string;
  patterns: string[];
};

let cached: RegExp[] | null = null;

export function loadRegisterPatterns(): RegExp[] {
  if (cached) return cached;
  const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../taxonomy/register-blacklist-v2.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RegisterBlacklist;
  const flags = raw.flags ?? 'i';
  cached = raw.patterns.map((p) => new RegExp(p, flags));
  return cached;
}

export function checkRegisterViolation(text: string): { violated: boolean; pattern?: string } {
  const patterns = loadRegisterPatterns();
  for (const re of patterns) {
    if (re.test(text)) return { violated: true, pattern: re.source };
  }
  return { violated: false };
}

export function extractOutputText(output: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof output.cause === 'string') parts.push(output.cause);
  if (Array.isArray(output.steps)) {
    for (const s of output.steps) {
      if (s && typeof s === 'object' && 'text' in s) parts.push(String((s as { text: string }).text));
    }
  }
  if (output.escalation && typeof output.escalation === 'object') {
    parts.push(JSON.stringify(output.escalation));
  }
  if (typeof output.rationale === 'string') parts.push(output.rationale);
  return parts.join('\n');
}
