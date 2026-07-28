/**
 * Enrichit pilot-v2.jsonl avec manual_context depuis Supabase RAG.
 * Tente brand + code, puis brand + equipment_type — y compris hors_corpus (bras E 20/20).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

type PilotCase = {
  id: string;
  symptom: { narrative: string; code_present: string | null };
  context: { brand: string | null; equipment_type?: string; in_corpus: boolean };
  manual_context?: { document_id: string; page: number; excerpt: string; title: string } | null;
  [key: string]: unknown;
};

async function findManualExcerpt(
  supabase: ReturnType<typeof createClient>,
  brand: string | null,
  code: string | null,
  equipmentType?: string,
): Promise<PilotCase['manual_context']> {
  if (!brand && !equipmentType) return null;

  const queries: Array<() => Promise<PilotCase['manual_context']>> = [];

  if (code) {
    queries.push(async () => {
      const { data: chunks } = await supabase
        .from('rag_technical_chunks')
        .select('id, document_id, content, page_start, error_code, status')
        .ilike('error_code', `%${code.replace(/\./g, '')}%`)
        .eq('status', 'published')
        .limit(20);
      return pickChunk(supabase, chunks);
    });
  }

  if (brand) {
    queries.push(async () => {
      const { data: chunks } = await supabase
        .from('rag_technical_chunks')
        .select('id, document_id, content, page_start, error_code, status')
        .ilike('content', `%${brand}%`)
        .eq('status', 'published')
        .limit(15);
      return pickChunk(supabase, chunks);
    });
  }

  if (equipmentType) {
    const hint = equipmentType.replace(/_/g, ' ');
    queries.push(async () => {
      const { data: chunks } = await supabase
        .from('rag_technical_chunks')
        .select('id, document_id, content, page_start, error_code, status')
        .ilike('content', `%${hint}%`)
        .eq('status', 'published')
        .limit(10);
      return pickChunk(supabase, chunks);
    });
  }

  for (const q of queries) {
    const manual = await q();
    if (manual) return manual;
  }

  return null;
}

async function pickChunk(
  supabase: ReturnType<typeof createClient>,
  chunks: Array<{ document_id: string; content: string; page_start: number | null }> | null,
): Promise<PilotCase['manual_context']> {
  if (!chunks?.length) return null;
  const chunk = chunks[0]!;
  const { data: doc } = await supabase
    .from('rag_documents')
    .select('id, title')
    .eq('id', chunk.document_id)
    .maybeSingle();
  return {
    document_id: chunk.document_id,
    page: chunk.page_start ?? 1,
    excerpt: (chunk.content as string).slice(0, 4000),
    title: doc?.title ?? 'Manuel technique',
  };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const pilotPath = resolve(dirname(fileURLToPath(import.meta.url)), '../dataset/pilot/pilot-v2.jsonl');
  const cases: PilotCase[] = readFileSync(pilotPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PilotCase);

  let enriched = 0;
  for (const c of cases) {
    const manual = await findManualExcerpt(
      supabase,
      c.context.brand,
      c.symptom.code_present,
      c.context.equipment_type,
    );
    c.manual_context = manual;
    if (manual) {
      enriched++;
      console.log(`${c.id}: manual p.${manual.page} — ${manual.title.slice(0, 50)}`);
    } else {
      console.warn(`${c.id}: no manual excerpt found`);
    }
  }

  writeFileSync(pilotPath, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.log(`Enriched ${enriched}/${cases.length} cases`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
