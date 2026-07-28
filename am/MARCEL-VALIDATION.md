# Validation Marcel — 20 cas AM (T3)

**Chemin critique** : sans signature Marcel, aucun cas ne peut passer en `split: gate` ni alimenter un run gate légitime (O8/O9).

## Visio 1 — cas `ham-0001` à `ham-0010` (~1 h)

Pour chaque cas, Marcel vérifie :

- [ ] `ground_state` : valeurs réalistes et cohérentes avec l'installation
- [ ] `verite.cause` / `solution` / `verification` / `pieges`
- [ ] `chemin_expert` : séquence d'actions outillables correcte
- [ ] `evolution` : réactions du simulateur crédibles

Après validation :

```bash
pnpm am:stamp-marcel --date YYYY-MM-DD --cases ham-0001,ham-0002,...,ham-0010
```

## Visio 2 — cas `ham-0011` à `ham-0020` (~1 h)

Même checklist. Puis :

```bash
pnpm am:stamp-marcel --date YYYY-MM-DD --cases ham-0011,...,ham-0020
# ou si tout est validé :
pnpm am:stamp-marcel --date YYYY-MM-DD --all
```

## Tirage dev / gate

Une fois les **20** cas signés :

```bash
pnpm am:split-dev-gate --seed 20260728 --dry-run   # prévisualiser
pnpm am:split-dev-gate --seed 20260728 --apply     # déplacer fichiers
pnpm am:validate-cases                             # 20/20 verts
```

Mettre à jour les rosters dans `am/preregistration-am.md` et committer.

## Bras H (T11 — calibration juge HC)

Marcel joue **5 cas gate** en visio (~1 h). Transcripts archivés pour comparer juge ↔ Marcel (G5, HC).

## Ce que l'IA ne doit pas faire

- Remplir `provenance.valide_par` sans Marcel
- Lancer `am:run-gate` avant split + signatures
- Retoucher un cas gate après le premier chiffre gate
