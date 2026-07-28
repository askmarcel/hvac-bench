# Comparatif bras C vs D — gate 52

> 2026-07-26 · MCP `tools/call diagnose` vs REST `/assist/diagnose`

| Run | ID | Endpoint |
|---|---|---|
| C | `c-2026-07-26T09-58-43-159Z-1465299e` | `POST /api/mcp` · diagnose |
| D | `d-2026-07-26T09-17-13-163Z-1572e52e` | `POST /api/v1/assist/diagnose` |

## Résultat gate 52

| Métrique | C | D | Δ |
|---|---:|---:|---:|
| Attribution | 87,5 % | 87,5 % | 0 |
| Réponse utile | 89,5 % | 89,5 % | 0 |
| Citation | 89,5 % | 89,5 % | 0 |
| Hallucination | 7,7 % | 7,7 % | 0 |
| Citations fantômes | 0 | 0 | — |

## Interprétation

**Parité parfaite** sur le gate 52 : les deux entrées appellent le même `apiRunDiagnostic` côté serveur. La différence est le **transport** (MCP JSON-RPC vs REST Answer Contract natif) et le **mapping** côté bench pour C.

**Implication CDC :** la valeur « MCP vs widget » sur ce slice est **nulle** pour le diagnostic one-shot. Un comparatif C significatif nécessitera **bras C v2** (boucle multi-outils : search → procedure → snapshot) ou des cas où l’agent choisit les outils.

## Commandes

```bash
pnpm run:c -- --cases ../hvac-bench-heldout/dataset/gate.jsonl --out runs/gate-c-2026-07-26
pnpm score --cases ../hvac-bench-heldout/dataset/gate.jsonl --run runs/gate-c-2026-07-26/raw.jsonl ...
pnpm compare:arms --c runs/gate-c-2026-07-26/score.json --d runs/.../score-gate52.json
```

Artefacts : `runs/gate-c-2026-07-26/`, `runs/gate-c-vs-d-gate52.txt`
