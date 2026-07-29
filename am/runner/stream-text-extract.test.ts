import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { extractHarnessTurnText } from './stream-text-extract.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/streams');

function loadFixtureBody(name: string): string {
  const raw = readFileSync(join(FIXTURES, name), 'utf8');
  return raw
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n');
}

describe('extractHarnessTurnText', () => {
  it('extrait du texte depuis ham-0016 LW (capture CI réelle)', () => {
    const text = extractHarnessTurnText(loadFixtureBody('ham-0016-lw.txt'));
    assert.ok(text.length > 100, `texte trop court: ${text.length}`);
    assert.match(text, /Diagnostic|puissance|froid/i);
  });

  it('extrait du texte depuis ham-0016 PROD (capture CI réelle)', () => {
    const text = extractHarnessTurnText(loadFixtureBody('ham-0016-prod.txt'));
    assert.ok(text.length > 50, `texte trop court: ${text.length}`);
    assert.match(text, /symptôme|dégivrage|PAC/i);
  });

  it('sérialise presentDiagnostic sans text-delta (tour tool-only)', () => {
    const text = extractHarnessTurnText(loadFixtureBody('ham-0016-presentDiagnostic-only.txt'));
    assert.ok(text.length > 0, 'tour tool-only ne doit pas être vide (G0 blocked)');
    assert.match(text, /Verdict/i);
    assert.match(text, /Sous-dimensionnement/i);
    assert.match(text, /Mesures reçues/i);
  });
});
