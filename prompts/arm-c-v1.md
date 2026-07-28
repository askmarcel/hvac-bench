# Bras C — MCP AskMarcel v1

## Condition expérimentale (CDC §6)

- **Outil MCP** : `diagnose` uniquement (`POST /api/mcp`, `tools/call`).
- **Pas** de boucle agentique multi-outils (search → procedure → snapshot) dans ce runner v1.
- **Pas** de LLM génératif côté bench : la réponse est produite par `apiRunDiagnostic` côté serveur (même RAG que le route REST, entrée `caller_source=mcp`).

## Comparatif visé

| Bras | Entrée | Mesure |
|---|---|---|
| **C** | MCP `diagnose` | Valeur corpus via protocole MCP |
| **D** | REST `/assist/diagnose` | Produit widget / extension |

Si C ≈ D sur les métriques déterministes → le corpus seul suffit via MCP.  
Si D ≫ C → l’orchestration surface (mapping Answer Contract, headers confiance) ajoute de la valeur.

## Version

`arm-c-v1` — 2026-07-26
