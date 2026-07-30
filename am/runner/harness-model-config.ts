/** Configuration modèle harness — alignée sur AskMarcel-WebApp-NextJS/ai/models.ts fast-marcel */
export const HARNESS_MODEL_CONFIG = {
  harness_model_id: 'fast-marcel',
  api_identifier: 'deepseek/deepseek-v4-flash',
  fallback_identifiers: [
    'google/gemini-2.5-flash',
    'meta-llama/llama-4-maverick',
  ] as string[],
  temperature: 0,
  max_output_tokens: 2400,
  step_budget: 6,
  t_max: 12,
  allow_fallbacks: false,
};

export function resolveHarnessModelId(): string {
  return process.env.AM_HARNESS_MODEL_ID ?? HARNESS_MODEL_CONFIG.harness_model_id;
}
