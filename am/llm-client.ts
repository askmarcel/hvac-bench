/**
 * Client LLM minimal partagé par sim/simulator.ts et judge/judge.ts.
 * Appelle OpenRouter en direct (même convention que legacy/runners/lib.ts),
 * volontairement séparé de tout SDK produit — l'instrument ne doit pas dépendre
 * du harnais qu'il mesure (voir PLAN-EXECUTION-Harnais-AskMarcel.md §0).
 */

export class MissingApiKeyError extends Error {
  constructor(varNames: string[]) {
    super(
      `Aucune clé API LLM trouvée. Définir l'une de : ${varNames.join(', ')}.`,
    );
    this.name = 'MissingApiKeyError';
  }
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type CallChatModelArgs = {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  /** Ordre de préférence des variables d'env pour la clé API. */
  apiKeyEnvVars: string[];
  maxOutputTokens?: number;
};

function resolveApiKey(envVars: string[]): string {
  for (const name of envVars) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new MissingApiKeyError(envVars);
}

/** Appelle /chat/completions (OpenRouter) et retourne le texte de la réponse. */
export async function callChatModel(args: CallChatModelArgs): Promise<string> {
  const apiKey = resolveApiKey(args.apiKeyEnvVars);
  const baseUrl = (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(
    /\/$/,
    '',
  );

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      temperature: args.temperature,
      max_tokens: args.maxOutputTokens ?? 800,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LLM call failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error(`Réponse LLM inattendue: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return text;
}
