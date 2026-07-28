/**
 * Extraction texte + tool-calls depuis un flux UI message (SSE ou préfixe AI SDK).
 * Le bench rejette aujourd'hui les tours où le modèle conclut via presentDiagnostic
 * sans text-delta — biais systématique LW/PROD.
 */

type SsePayload = {
  type?: string;
  delta?: string;
  content?: string;
  text?: string;
  textDelta?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  inputTextDelta?: string;
  choices?: { delta?: { content?: string } }[];
};

export function serializeToolTurn(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') {
    return `**${toolName}** : ${JSON.stringify(input)}`;
  }

  const payload = input as Record<string, unknown>;

  if (toolName === 'presentDiagnostic') {
    const parts: string[] = [];
    if (payload.verdict) parts.push(`**Verdict** : ${String(payload.verdict)}`);
    if (payload.cause) parts.push(`**Cause** : ${String(payload.cause)}`);
    if (payload.confiance) parts.push(`**Confiance** : ${String(payload.confiance)}`);
    if (payload.escalade && typeof payload.escalade === 'object') {
      const esc = payload.escalade as { motif?: string; detail?: string };
      parts.push(`**Escalade** (${esc.motif ?? '?'}) : ${esc.detail ?? ''}`);
    }
    if (Array.isArray(payload.steps) && payload.steps.length > 0) {
      const steps = payload.steps as Array<{ title?: string; detail?: string }>;
      parts.push(
        '**Étapes** :\n' +
          steps.map((s) => `- ${s.title ?? ''}${s.detail ? ` : ${s.detail}` : ''}`).join('\n'),
      );
    }
    if (Array.isArray(payload.mesuresRecues) && payload.mesuresRecues.length > 0) {
      parts.push(
        '**Mesures reçues** :\n' +
          (payload.mesuresRecues as Array<{ grandeur?: string; valeur?: string }>)
            .map((m) => `- ${m.grandeur ?? '?'} : ${m.valeur ?? '?'}`)
            .join('\n'),
      );
    }
    return parts.join('\n\n') || `**presentDiagnostic** : ${JSON.stringify(input)}`;
  }

  if (toolName === 'getPlages' || toolName === 'get_plages') {
    return `**Plages** (${JSON.stringify(payload.quantity ?? payload)}) :\n${JSON.stringify(payload, null, 2)}`;
  }

  if (toolName === 'getArbreMemo' || toolName === 'get_arbre_memo') {
    return `**Arbre mémo** :\n${JSON.stringify(payload, null, 2)}`;
  }

  if (toolName === 'getPriors' || toolName === 'get_priors') {
    return `**Priors** :\n${JSON.stringify(payload, null, 2)}`;
  }

  return `**${toolName}** :\n${JSON.stringify(payload, null, 2)}`;
}

function appendSsePayload(
  parsed: SsePayload,
  text: { value: string },
  toolInputs: Array<{ toolName: string; input: unknown }>,
  toolInputDeltas: Map<string, { toolName?: string; inputText: string }>,
): void {
  if (parsed.type === 'text-delta' && typeof parsed.delta === 'string') {
    text.value += parsed.delta;
    return;
  }
  if (parsed.type === 'reasoning-delta' && typeof parsed.delta === 'string') {
    text.value += parsed.delta;
    return;
  }
  if (parsed.type === 'tool-input-available' && parsed.toolName) {
    toolInputs.push({ toolName: parsed.toolName, input: parsed.input });
    return;
  }
  if (parsed.type === 'tool-call' && parsed.toolName) {
    toolInputs.push({
      toolName: parsed.toolName,
      input: (parsed as { args?: unknown }).args ?? parsed.input,
    });
    return;
  }
  if (parsed.type === 'tool-input-delta' && parsed.toolCallId && parsed.inputTextDelta) {
    const entry = toolInputDeltas.get(parsed.toolCallId) ?? { inputText: '' };
    entry.toolName = parsed.toolName ?? entry.toolName;
    entry.inputText += parsed.inputTextDelta;
    toolInputDeltas.set(parsed.toolCallId, entry);
    return;
  }

  const legacy =
    (typeof parsed.content === 'string' && parsed.content) ||
    (typeof parsed.text === 'string' && parsed.text) ||
    (typeof parsed.textDelta === 'string' && parsed.textDelta) ||
    (typeof parsed.choices?.[0]?.delta?.content === 'string' && parsed.choices[0].delta.content) ||
    '';
  if (legacy) text.value += legacy;
}

function flushToolInputDeltas(
  toolInputDeltas: Map<string, { toolName?: string; inputText: string }>,
  toolInputs: Array<{ toolName: string; input: unknown }>,
): void {
  for (const [, entry] of toolInputDeltas) {
    if (!entry.toolName || !entry.inputText.trim()) continue;
    try {
      toolInputs.push({ toolName: entry.toolName, input: JSON.parse(entry.inputText) });
    } catch {
      toolInputs.push({ toolName: entry.toolName, input: entry.inputText });
    }
  }
}

/** Extrait le texte assistant + sérialisation des tool-calls d'un flux HTTP bench. */
export function extractHarnessTurnText(raw: string): string {
  const text = { value: '' };
  const toolInputs: Array<{ toolName: string; input: unknown }> = [];
  const toolInputDeltas = new Map<string, { toolName?: string; inputText: string }>();

  for (const line of raw.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;

    if (trimmed.startsWith('data:')) {
      const data = trimmed.slice(5).trimStart();
      if (!data || data === '[DONE]') continue;
      try {
        appendSsePayload(JSON.parse(data) as SsePayload, text, toolInputs, toolInputDeltas);
      } catch {
        // ignorer lignes non-JSON
      }
      continue;
    }

    const aiDataMatch = trimmed.match(/^([0-9a-z]):(.*)$/i);
    if (!aiDataMatch) continue;
    const [, partType, rawPayload = ''] = aiDataMatch;
    const payload = rawPayload.trim();
    if (!payload) continue;

    if (partType === '0') {
      try {
        const token = JSON.parse(payload);
        if (typeof token === 'string' && token.length > 0) text.value += token;
      } catch {
        // ignore
      }
      continue;
    }

    if (partType === '9' || partType === 'a') {
      try {
        const parsed = JSON.parse(payload) as SsePayload & { toolName?: string; input?: unknown };
        if (parsed.toolName) {
          toolInputs.push({
            toolName: parsed.toolName,
            input: parsed.input ?? parsed,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  flushToolInputDeltas(toolInputDeltas, toolInputs);

  const toolText = toolInputs.map((t) => serializeToolTurn(t.toolName, t.input)).join('\n\n');
  return [text.value.trim(), toolText.trim()].filter(Boolean).join('\n\n');
}
