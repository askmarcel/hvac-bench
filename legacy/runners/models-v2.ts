import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type V2ArmId = 'A' | 'B' | 'E';

export type ModelsV2Config = {
  version: string;
  temperature: number;
  knowledge_cutoff?: string;
  forbidden_defaults: string[];
  arms: Record<
    string,
    {
      role: string;
      label: string;
      openrouter_slug?: string;
      knowledge_cutoff?: string;
      env_override?: string;
      web_search?: boolean;
      endpoint?: string;
    }
  >;
};

let cached: ModelsV2Config | null = null;

export function loadModelsV2Config(): ModelsV2Config {
  if (cached) return cached;
  const path = resolve(import.meta.dirname, '../config/models-v2.json');
  cached = JSON.parse(readFileSync(path, 'utf8')) as ModelsV2Config;
  return cached;
}

export function resolveV2ArmModel(arm: V2ArmId): {
  model: string;
  temperature: number;
  webSearch: boolean;
  label: string;
} {
  const cfg = loadModelsV2Config();
  const armCfg = cfg.arms[arm];
  if (!armCfg?.openrouter_slug) {
    throw new Error(`Arm ${arm} has no OpenRouter slug in models-v2.json`);
  }
  const envKey = armCfg.env_override ?? `BENCH_ARM_${arm}_MODEL`;
  const model = process.env[envKey] ?? armCfg.openrouter_slug;
  if (cfg.forbidden_defaults.some((f) => model.toLowerCase().includes(f.toLowerCase()))) {
    throw new Error(`Model ${model} is forbidden (legacy default). Use models-v2.json stack.`);
  }
  return {
    model,
    temperature: cfg.temperature,
    webSearch: armCfg.web_search ?? false,
    label: armCfg.label,
  };
}
