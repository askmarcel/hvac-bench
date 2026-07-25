# HVAC Bench

Benchmark CVC AskMarcel — harness de mesure, dataset versionné, gate CI.

## Statut

| Élément | État |
|---|---|
| Schéma cas | `dataset/schema.json` v0.1.0 |
| Gate held-out | 52 cas, hors dépôt (`../hvac-bench-heldout/`) |
| Échantillon public | 4 cas illustratifs, `dataset/public/sample.jsonl` — **hors gate** |
| Runner | bras D (`pnpm run:d`) |
| Scorer | `pnpm score` — déterministe, sans LLM |
| Gate | `pnpm gate` — règles CDC §7 |
| Baseline verte | non figée : à établir après le correctif d'attribution (REQ-G3) |

## Métriques headline

Hallucination × utilité, avec intervalles de Wilson à 95 %. Locale cible `fr` (3 cas sur 52
sont des requêtes de production en anglais, conservées telles quelles).

La tranche headline `non_contaminated` exclut deux populations :

- `contamination_risk` — vérité probablement présente dans le pré-entraînement des modèles ;
- `corpus_leakage` — vérité issue d'un document ingéré dans le corpus AskMarcel, ce qui
  donne un avantage trivial aux bras C et D. **Les 20 cas answerable sont dans ce cas** :
  ils servent le gate, pas le claim public.

## Conventions de scoring

Deux endroits où le CDC laisse une marge d'interprétation. Les choix retenus sont
délibérés et testés.

### Attribution sur un cas answerable où le système s'abstient

Le CDC §4.1 définit PASS (marques équivalentes) et FAIL (marque différente, ou marque
affirmée sur un cas sans réponse attendue). Un cas answerable sur lequel le système
s'abstient n'affirme aucune marque : ni l'un ni l'autre.

Le traiter comme non applicable rendrait `attribution_rate` insensible à la sur-abstention —
un système qui refuse de répondre partout obtiendrait 100 %. C'est exactement la faille qui
rendait le gate v0 inopérant. **On le compte FAIL.** Un test (`s'abstenir partout ne donne
pas un bon score d'attribution`) verrouille ce comportement.

### Exactitude de code et sens

Le CDC §4.2 mentionne « sens contradictoire au manuel ». Un tel jugement n'est pas
décidable sans arbitrage humain, et le scorer s'interdit tout appel LLM (NFR-4).

La rubrique bloquante ne juge donc que **l'égalité du code**, à la casse et aux séparateurs
près. Le recouvrement lexical avec la vérité terrain est publié comme signal secondaire
(`signals.meaning_overlap`) et n'entre dans aucune métrique. Le jugement de sens relève de
la rubrique humaine `workflow` (§4.6), hors gate.

## Calibration du harnais

Trois systèmes simulés sont passés sur les 52 cas du gate pour vérifier que les métriques
se comportent comme attendu :

| Système simulé | Attribution | Abstention | Hallucination | Réponse utile | Verdict |
|---|---|---|---|---|---|
| Oracle (répond juste, s'abstient à propos) | 100 % | 100 % | 0 % | 100 % | vert |
| S'abstient toujours | 60 % | 100 % | 0 % | 0 % | **rouge** |
| Affirme toujours, confiance haute | 40 % | 0 % | 64 % | 0 % | **rouge** |

Le deuxième est le plus important : un système qui ne se trompe jamais parce qu'il ne
répond jamais doit être rouge. Il l'est, par la règle de régression d'attribution.

## Règles du gate

Trois règles du CDC §7 REQ-G2, plus une quatrième ajoutée ici et signalée comme hors CDC :

1. régression `attribution_rate` sous la baseline verte (ε configurable, défaut 0) ;
2. au moins une réponse affirmée avec confiance haute sur un cas sans réponse attendue ;
3. au moins une citation fantôme — manuel introuvable ou page hors bornes ;
4. *(hors CDC)* confiance illisible sur un cas bloquant : la règle 2 ne couvre alors pas ce
   cas, et un gate qui ne peut pas évaluer sa propre règle n'est pas déclaré vert.

La confiance ne figure pas dans le contrat de réponse ; elle est lue dans l'en-tête
`X-AM-Confidence-Band`. Si l'API ne l'expose pas, la règle 2 ne mesure rien — d'où la
règle 4.

## Limites connues

- Gate = bras D uniquement. Les bras A/B/C ne sont pas encore implémentés.
- La rubrique `safety` applique un jeu de règles v1 (fluide frigorigène, 230 V, gaz). Elle
  est reportée mais **non bloquante**, conformément au CDC. Elle déclenche sur hb-0065, dont
  la notice constructeur dit « compléter le réfrigérant manquant » : c'est voulu, la réponse
  attendue assortit l'instruction d'une mention de qualification.
- La citation n'est vérifiable que sur les documents à extraction page-level. 127 documents
  du corpus n'en ont pas ; hb-0004 est de ceux-là et porte `citation_scorable: false`.
- Cas forum : `citation_scorable = false` par construction.
- Amendements schéma : tag `dataset-schema-vX` + entrée datée au CDC §10.

## Scripts

```bash
pnpm install
pnpm validate:cases     # dataset contre le schéma
pnpm test               # harnais sur réponses simulées, sans réseau
pnpm run:d              # runner bras D
pnpm score              # scorer
pnpm gate               # verdict CI
```

Voir [REPRODUCE.md](./REPRODUCE.md).
