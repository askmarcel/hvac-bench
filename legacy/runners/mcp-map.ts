/**
 * Mappe la réponse MCP `diagnose` vers le Answer Contract (aligné map-diagnostic-to-answer).
 */
import type { BenchCase } from '../scorer/types.js';

export const BENCH_CONTRACT_VERSION = '1.2.0';

type McpDiagnostic = {
  diagnostic: string;
  steps: Array<{ order: number; text: string; safety?: string | null }>;
  part: { name: string | null; reference: string | null };
  source: {
    brand: string | null;
    model: string | null;
    doc_title: string | null;
    page_start: number | null;
    page_end: number | null;
    document_id: string | null;
    chunk_id: string | null;
    source_type?: 'manual' | 'community' | null;
  };
  confidence: { score: number; band: 'high' | 'medium' | 'low'; deterministic: boolean };
  follow_up_questions?: string[];
};

function buildIdentification(
  c: BenchCase,
  result: McpDiagnostic,
): { brand: string; code: string; model?: string; label: string } {
  const brand = c.prompt.brand_hint?.trim() || result.source.brand?.trim() || 'Inconnu';
  const code =
    c.prompt.error_code_hint?.trim() || c.prompt.user_message.trim().slice(0, 64) || 'N/A';
  const model = c.prompt.model_hint?.trim() || result.source.model?.trim() || undefined;
  const label = c.prompt.error_code_hint
    ? `${c.prompt.error_code_hint} (${brand})`
    : brand;
  return { brand, code, model, label };
}

function unknownCodeEscalation(lang: string) {
  if (lang === 'en') {
    return [
      {
        order: 1,
        text: 'Confirm the exact model from the nameplate and re-run the search with full references.',
      },
      {
        order: 2,
        text: 'Check water pressure, flow and any recent hydraulic work before replacing parts.',
      },
    ];
  }
  return [
    {
      order: 1,
      text: 'Confirme le modèle exact sur la plaque signalétique et relance la recherche avec la référence complète.',
    },
    {
      order: 2,
      text: 'Contrôle pression eau, débit et travaux hydrauliques récents avant tout remplacement de pièce.',
    },
  ];
}

export function mapMcpDiagnoseToAnswer(c: BenchCase, result: McpDiagnostic): Record<string, unknown> {
  const lang = c.locale === 'en' ? 'en' : 'fr';
  const metaBase = { lang, latency_ms: 0, quota: null };

  const hasChunk = Boolean(result.source.chunk_id);
  const isLow = result.confidence.band === 'low';
  const errorCode = c.prompt.error_code_hint?.trim();

  if (!hasChunk) {
    if (errorCode) {
      return {
        contract_version: BENCH_CONTRACT_VERSION,
        state: 'unknown_code',
        searched_code: errorCode,
        escalation: unknownCodeEscalation(lang),
        meta: metaBase,
      };
    }
    return {
      contract_version: BENCH_CONTRACT_VERSION,
      state: 'off_topic',
      meta: metaBase,
    };
  }

  if (isLow && result.follow_up_questions && result.follow_up_questions.length > 0) {
    return {
      contract_version: BENCH_CONTRACT_VERSION,
      state: 'ambiguous',
      candidates: [
        buildIdentification(c, result),
        {
          brand: result.source.brand ?? c.prompt.brand_hint ?? 'Inconnu',
          code: errorCode || 'N/A',
          model: result.source.model ?? c.prompt.model_hint,
          label: result.source.doc_title ?? c.prompt.brand_hint ?? 'Autre',
        },
      ],
      meta: metaBase,
    };
  }

  if (isLow) {
    if (errorCode) {
      return {
        contract_version: BENCH_CONTRACT_VERSION,
        state: 'unknown_code',
        searched_code: errorCode,
        escalation: unknownCodeEscalation(lang),
        meta: metaBase,
      };
    }
    return { contract_version: BENCH_CONTRACT_VERSION, state: 'off_topic', meta: metaBase };
  }

  const steps =
    result.steps.length > 0
      ? result.steps.map((s) => ({ order: s.order, text: s.text }))
      : [{ order: 1, text: result.diagnostic }];

  const page = result.source.page_start ?? 1;
  const sourceType = result.source.source_type ?? (result.source.document_id ? 'manual' : 'community');

  return {
    contract_version: BENCH_CONTRACT_VERSION,
    state: 'answer',
    identification: buildIdentification(c, result),
    cause: result.diagnostic,
    steps,
    citation: {
      manual_title:
        result.source.doc_title ??
        (sourceType === 'community' ? 'Retour terrain' : 'Manuel technique'),
      page,
      source_type: sourceType,
      lang,
    },
    escalation: [],
    meta: metaBase,
  };
}

export function parseMcpDiagnoseResult(body: unknown): McpDiagnostic | null {
  const json = body as {
    result?: {
      structuredContent?: McpDiagnostic;
      content?: Array<{ text?: string }>;
    };
    error?: { message?: string };
  };
  if (json.error) return null;
  if (json.result?.structuredContent) return json.result.structuredContent;
  const text = json.result?.content?.[0]?.text;
  if (text) return JSON.parse(text) as McpDiagnostic;
  return null;
}
