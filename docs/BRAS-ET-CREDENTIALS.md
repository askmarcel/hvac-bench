# Bras, systèmes testés et credentials

> Dernière mise à jour : 2026-07-26 (stack modèles 2026)

## Ce que le bench mesure

| Bras | Système | LLM ? |
|---|---|---|
| **D** | API v2 `/api/v2/diagnose/session` + `/turn` | Non — moteur priors + registre |
| **A** | Closed-book OpenRouter | Oui |
| **B** | Web OpenRouter | Oui — **Mistral Large** (même modèle que E) |
| **E** | Manuel constructeur en contexte | Oui |
| **C** | MCP AskMarcel (v1) | Non (RAG serveur) |

## Modèles défaut (juillet 2026)

Source : [`config/models-v2.json`](../config/models-v2.json)

| Bras | Modèle | Slug OpenRouter | Override |
|---|---|---|---|
| A | DeepSeek V4 Flash | `deepseek/deepseek-v4-flash` | `BENCH_ARM_A_MODEL` |
| B | Mistral Large (web) | `mistralai/mistral-large-2512` | `BENCH_ARM_B_MODEL` |
| E | Mistral Large | `mistralai/mistral-large-2512` | `BENCH_ARM_E_MODEL` |

**Interdit** : `openai/gpt-4o`, `perplexity/sonar` — legacy v1.

`temperature: 0` pour tous les bras LLM (CDC §6.3 R8).

**GLM** : rotation NFR-5′ via `BENCH_ARM_A_MODEL=zhipu/glm-4.5` (alternates dans models-v2.json).

## Clés API

| Usage | Variable |
|---|---|
| Bras D | `BENCH_API_URL`, `BENCH_API_KEY` |
| Bras A/B/E | `OPENROUTER_API_KEY` ou `BENCH_ARM_*_API_KEY` |
| Minage priors | `NEON_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

## Commandes v2 pilote

```bash
cd hvac-bench
pnpm run:v2:arm-d    # API session/turn
pnpm run:v2:arm-b    # Kimi K2.5 + web
pnpm run:v2:arm-e    # Mistral Large + manuel
pnpm run:v2:compare -- --run-dir runs/<run-id>
```

`run:v2:pilot` = smoke test oracle uniquement — **pas un verdict Phase 7**.
