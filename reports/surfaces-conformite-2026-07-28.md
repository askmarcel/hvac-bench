# Surfaces conformité — 2026-07-28

Référence: PLAN-TEST-Surfaces-Chat-AskMarcel.md

## Statique (C1–C6)

Exécuté localement : **7/7 verts** (`pnpm check:surfaces`).

## Comportement sans LLM (D/F/G)

Exécuté localement : **15/15 verts** (`pnpm am:surface-tests --group all` — E SKIP sans clés).

## H4 — parité inter-surfaces

**Infrastructure prête** :

- Cœur partagé `lib/chat/run-harnais.ts`
- Bench in-process D3 (`bench-harnais-turn.ts`)
- `run-arm.ts --surface S1|S2|S3`

**H4 complet** (scores `cause_ok` identiques) : exécuter en CI avec clés LLM :

```bash
pnpm am:run-arm --arm PROD --split dev --cases ham-0001,ham-0002 --surface S1
pnpm am:run-arm --arm PROD --split dev --cases ham-0001,ham-0002 --surface S2
pnpm am:run-arm --arm PROD --split dev --cases ham-0001,ham-0002 --surface S3
pnpm am:score && pnpm am:surfaces-report
```

Avec D3 (même code), les trois surfaces invoquent `runHarnaisTurn` — variance attendue = modèle uniquement.

## Livrables

- [x] `reports/baseline-surfaces-2026-07-28.md`
- [x] C1–C6 script + CI job `am-harness` mechanical
- [x] D/F/G scripts
- [ ] E1–E6 live (clés LLM CI)
- [ ] H4 scores archivés (après run-arm tri-surface)
