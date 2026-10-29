# Draft PR — SPORT-V2-CORRECTIONS-01 (préparée, NON publiée)

> Texte prêt à coller à l'ouverture de la PR, **après le GO de Louis pour le push**. Rien n'est poussé.

**Titre** : `SPORT-V2-CORRECTIONS-01 — corrections sportives V2 (retour coach du 28.10) [DRAFT — DO NOT MERGE]`

**Head** : `sport/v2-corrections-01` (`72ef231`). **Base** : `main`.

---

## Résumé

Corrections V2 issues du retour coach du 28.10.2026. **Candidates** : leur contenu attend des validations professionnelles.
- **Commotion** : toute décision de professionnel exige sa catégorie (`professional_category_required`). Migration candidate `20261028120000` : contrainte `NOT VALID`, attestation toujours déclarative.
- **Force** : une séance Force du haut du corps contient toujours une poussée (correctif candidat dans le générateur, à valider par le PHYS). La structure hors saison et les trois options de charnière du bas du corps restent des **propositions non activées**.
- **DH** : couverture effective calculée par le générateur réel (compétence × niveau × terrain, matrice des 21 couples) ; fiches débutant finalisées, **non signées**.
- **Web** : formulaire de suivi de commotion (catégorie du professionnel).
- **Sécurité** : écritures directes du client du pilote et de la clé anonyme refusées sur le signal de commotion (tests).
- **Outillage local** : dossier de l'incident local du 28.10 et garde-fou des piles jetables (scripts et procédures, hors production).

## Dépendances

- **Après PR2, puis BETA** (ordre recommandé). Après leur fusion, mettre cette branche à jour sur `main` et ajouter :
  - **S1** (`resolutions/S1.patch`) : le cas « no bypass under an open concussion » de `a5P0Hardening` génère son second programme avec le bundle signé « test » du runtime. Sans S1, le fichier ne compile plus après fusion (`TS2304`) : BETA a retiré un import que ce cas utilise ;
  - les conflits textuels : docs 00, 11, 12 (garder les deux entrées), et les imports de `a5P0Hardening` (union).
- **Migrations** : `20261028120000` après PR2 (`20261027120000`) et BETA (`20261027150000`), sans objet commun.

## Ce que cette PR ne fait pas

- **Aucune signature sportive** : les fiches DH, les décisions PHYS et la revue commotion attendent les professionnels (`DH_COACH_SIGNATURE_SHEET.md`, `PHYS_DECISION_SHEET.md`, `CONCUSSION_PROFESSIONAL_REVIEW.md`).
- Aucune nouvelle dose, aucun protocole médical inventé, aucune activation V2.
- Canon `docs/04`, `docs/05` : proposé (`P0_CORRECTIONS.md`), non appliqué.

## Preuves

Locales, sur piles jetables par le garde-fou. Détail : `docs/review/v2-integration/INTEGRATION_RESULTS.md` (branche BETA), `docs/review/sport-v2-corrections-01/REVIEW_1.md`.

| Où | Résultat |
|---|---|
| Branche SPORT, REVIEW 1 | compatibilité SQL PR2 + SPORT : 79 migrations, rollbacks croisés, suites de sécurité 42/42, 0 échec |
| Intégration PR2 + BETA + SPORT (branche jetable), unitaires | `planning-engine` 1 186 (instantanés compris), `verify:sport-approvals` OK, web 2 498 ; typage à la base après S1 |
| Suite complète V2 OFF, Linux | 4 passages sur 4 : 1 269 réussis, 0 échec. Dont `sportSafe02A5Lifecycle` 4/4, `t21` 1/1, `runDailyFor.longitudinal` 1/1, `p0SafeHealthContinuity` 13/13, `p0SafeHealthEdge` 3/3 |
| V2 ON signée « test » (Windows) | 61/61, dont `a5P0Hardening` 20/20 avec le cas S1 |
| Migrations depuis zéro | 80 appliquées ; contrôle SPORT en lecture seule conforme |

## Approbations requises avant toute fusion

1. Professionnels : signatures DH (coach), décisions PHYS, revue commotion (santé). Aucune signature automatique.
2. Architecte et Louis : canon `docs/04` et `docs/05` proposé ; GO de la migration `20261028120000`.
3. HPM : cohérence des contrats après intégration.
4. Louis : GO explicite pour le push, puis pour le merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
