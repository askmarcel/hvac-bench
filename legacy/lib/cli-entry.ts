import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when the module is the process entrypoint (not imported). */
export function isExecutedDirectly(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(fileURLToPath(metaUrl)) === resolve(entry);
}
