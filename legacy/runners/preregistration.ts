import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PREREG_PATH = resolve(import.meta.dirname, '../preregistration.md');

export function loadPreregistrationHash(): string {
  const content = readFileSync(PREREG_PATH, 'utf8');
  return createHash('sha256').update(content).digest('hex');
}
