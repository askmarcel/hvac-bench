/**
 * Client HTTP vers le harnais réel (`/api/mobile/chat` de la WebApp) — §0 du plan
 * d'exécution : "ce que le bench mesure = ce que le mobile exécute", un seul point
 * d'entrée, jamais une copie du prompt/tools dans le bench.
 *
 * T8 câblé côté WebApp (`lib/chat/harnais-mode.ts`) : headers `x-bench-mode` +
 * `x-harnais-mode` (L0|LW|PROD). Le parseur SSE suit le format AI SDK v5 UI message
 * stream (aligné sur Expo `stream-parser.ts`) : lignes `data:` JSON + préfixes `0:`/`8:`.
 */

export class HarnessUnavailableError extends Error {
  constructor(cause: string) {
    super(`Harnais WebApp injoignable (${cause}). Serveur dev lancé ? T8 câblé ? Bearer token fourni ?`);
    this.name = 'HarnessUnavailableError';
  }
}

export type HarnaisMode = 'l0' | 'lw' | 'prod';

export type HarnessTurnArgs = {
  baseUrl: string;
  bearerToken: string;
  chatId: string;
  harnaisMode: HarnaisMode;
  modelId: string;
  /** Historique complet (UIMessage[] simplifié) — doit contenir au moins un message `user`
   *  (plainte initiale), comme Expo `run-mobile-chat-request.ts`. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
};

type SsePayload = {
  type?: string;
  delta?: string;
  content?: string;
  text?: string;
  textDelta?: string;
  choices?: { delta?: { content?: string } }[];
};

function extractSseChunk(data: string): string {
  try {
    const parsed = JSON.parse(data) as SsePayload;
    if (parsed.type === 'text-delta' && typeof parsed.delta === 'string') return parsed.delta;
    if (parsed.type === 'reasoning-delta' && typeof parsed.delta === 'string') return parsed.delta;
    return (
      (typeof parsed.content === 'string' && parsed.content) ||
      (typeof parsed.text === 'string' && parsed.text) ||
      (typeof parsed.textDelta === 'string' && parsed.textDelta) ||
      (typeof parsed.choices?.[0]?.delta?.content === 'string' && parsed.choices[0].delta.content) ||
      ''
    );
  } catch {
    return '';
  }
}

function extractAiDataChunk(payload: string): string {
  try {
    const token = JSON.parse(payload);
    return typeof token === 'string' && token.length > 0 ? token : '';
  } catch {
    return '';
  }
}

/** Accumule le texte assistant depuis un flux SSE AI SDK v5 (data: + préfixes 0:/8:/d:). */
function extractTextFromUiMessageStream(raw: string): string {
  let text = '';
  for (const line of raw.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;

    if (trimmed.startsWith('data:')) {
      const data = trimmed.slice(5).trimStart();
      if (!data || data === '[DONE]') continue;
      const chunk = extractSseChunk(data);
      if (chunk) text += chunk;
      continue;
    }

    const aiDataMatch = trimmed.match(/^([0-9a-z]):(.*)$/i);
    if (!aiDataMatch) continue;
    const [, partType, rawPayload = ''] = aiDataMatch;
    if (partType === '0' && rawPayload.trim()) {
      const chunk = extractAiDataChunk(rawPayload.trim());
      if (chunk) text += chunk;
    }
  }
  return text.trim();
}

export async function sendHarnessTurn(args: HarnessTurnArgs): Promise<string> {
  const body = {
    id: args.chatId,
    modelId: args.modelId,
    messages: args.messages.map((m, i) => ({
      id: `${args.chatId}-${i}`,
      role: m.role,
      parts: [{ type: 'text', text: m.content }],
    })),
  };

  let response: Response;
  try {
    response = await fetch(args.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.bearerToken}`,
        'x-bench-mode': '1',
        'x-harnais-mode': args.harnaisMode,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new HarnessUnavailableError((e as Error).message);
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new HarnessUnavailableError(`HTTP ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const raw = await response.text();
  const text = extractTextFromUiMessageStream(raw);
  if (!text) {
    throw new HarnessUnavailableError('réponse reçue mais aucun texte extrait du flux (format inattendu)');
  }
  return text;
}
