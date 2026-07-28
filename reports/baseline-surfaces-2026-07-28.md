# Baseline surfaces — 2026-07-28

| ID | Résultat | Détail |
|---|---|---|
| B1-streamText-api | VERT | 0 streamText dans app/api/ |
| B1-presentInline-api | VERT | 0 presentDiagnostic inline dans app/api/ |
| B4-hard-rule-refuse | VERT | refus OK: validatePresentDiagnostic refuse si mesuresRecues vide |
| B5-prompt-hash | VERT | SHA256=98be58f61126a5c429796e42… |
| B2-live-plage | ROUGE/SKIP | SKIP — voir am:surface-tests --group E (clés LLM requises) |

## Écart pré-T13 (archivé)

- S1 : streamText inline, presentDiagnostic pass-through, 0 tool DATA
- S2 : runMobileChatStream T8-complet
- Bug : prompt ordonnait get_plages sans tools sur S1
