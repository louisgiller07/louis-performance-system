# Draft PR — BETA-V2-TECH-01 (préparée, NON publiée)

> Texte prêt à coller à l'ouverture de la PR, **après le GO de Louis pour le push**. Rien n'est poussé.

**Titre** : `BETA-V2-TECH-01 — prérequis techniques de la bêta V2 [DRAFT — DO NOT MERGE]`

**Head** : `beta/v2-tech-01` (SHA exact : `PUBLICATION_READINESS.md`). **Base** : `main`.

---

## Résumé

Prérequis techniques de la bêta V2. Ce sont des protections seulement : aucune activation V2.
- **T2** : le `daily-run` exige toujours l'unité DH signée d'un document V2, quel que soit `NALYNT_V2_PLAN_GENERATION_ENABLED`. Un jour DH sans unité est bloqué (`dh_repetition_unit_unknown`), sans prescription finale. L'interrupteur ne commande plus que la création de programmes V2.
- **B** : l'affectation serveur (`training_plan_model_assignments`) est l'autorisation de générer :
  - sans affectation : 403 `beta_access_not_granted`, jamais V1 par défaut ;
  - `v1` : exemption explicite (comptes de test) ;
  - `v2` : V2, ou 503 si l'interrupteur est coupé ;
  - lecture impossible : 503 `beta_access_check_unavailable`.

  Le navigateur ne décide de rien.
- **Exemptions V1 tracées** : migration additive `20261027150000` (colonne `decided_by` ; motif et auteur obligatoires pour `v1`). Aucun auteur inventé pour les lignes existantes.
- **T1** : partition V2 ON des tests (génération par le bundle même du runtime, signé « test »).
- **CI** : job `integration-v2-off`, la suite d'intégration V2 OFF sous Linux avec une pile Supabase jetable. Son passage vert est requis avant le merge (HPM). En faire un contrôle obligatoire de `main` reste une décision de l'architecte.
- **Vercel** : `beta/v2-tech-01` exclue des déploiements automatiques de branche (`git.deploymentEnabled`, comme PR2).

## Dépendances

- **Après PR2** (`release/v2-dh-revocation`, Draft PR #2), ordre recommandé PR2, BETA, SPORT. Après la fusion de PR2, mettre cette branche à jour sur `main` et ajouter les résolutions d'intégration :
  - **S2** (`resolutions/S2.patch`) : affectation `v1` tracée dans la fixture `v2DhRevocationV1Http` ;
  - **S3** (`resolutions/S3.patch`) : le rider « production » de `v2DhRevocationDailyRun` devient « legacy » (lignes antérieures à T2) ; deux cas au point d'entrée de production après T2 ;
  - **S4** : canon `docs/05` fusionné (`S4_DOCS05_MERGED.patch`), **après approbation**.
  - conflits textuels : docs 00 et 11 (garder les deux entrées), `web/vercel.json` et `marketing-site/vercel.json` (garder toutes les branches exclues).
- **Migrations** : `20261027150000` se place entre PR2 (`20261027120000`) et SPORT (`20261028120000`). Si SPORT passait avant BETA, renommer la migration BETA avant publication.

## Ce que cette PR ne fait pas

- Aucune activation V2, aucun changement d'interrupteur, aucune écriture de production.
- Aucun déploiement par le push. **Le merge, lui, déploie le web automatiquement** (Vercel, `main`) : les messages 403 et 503, inertes tant que `generate-training-plan` n'est pas redéployée. Migration et fonctions Edge restent manuelles (GO distincts).
- Aucune signature sportive : les tests utilisent des signatures marquées « TEST fixture (not a sports decision) ».
- M1 inchangé.
- T4 (suspension de prescriptions) : spécifié, non développé.

## Preuves

Locales, sur piles jetables par le garde-fou. Détail : `docs/review/v2-integration/INTEGRATION_RESULTS.md`, `docs/review/beta-v2-tech-01/`.

| Où | Résultat |
|---|---|
| Branche BETA seule, Windows | partition V2 ON signée « test » 58/58 ; bundles réels 8/8 ; web 75/75 ; un passage complet V2 OFF strictement propre (1 254/1 254) |
| Intégration PR2 + BETA + SPORT (branche jetable) | unitaires de tous les paquets au vert ; typage à la base ; 80 migrations depuis zéro ; contrôles PR2, SPORT, BETA conformes |
| Suite complète V2 OFF, **Linux** (conteneur Node 24.15.0, même poste) | **4 passages sur 4 : 1 269 réussis, 0 échec, 0 mort de worker, 0 rechargement** |
| V2 ON (Windows, intégration) | signée « test » 61/61 ; bundles réels 8/8 ; web 75/75 |
| PR2 sur l'intégration | révocation 12/12, rollback refusé après révocation ; quotidien de révocation avec S3 6/6 (Linux) |
| Exemptions V1 | suite dédiée 5/5 ; ligne `v1` existante sans trace : contrainte `NOT VALID`, nouvelle ligne refusée, traçage puis `VALIDATE` |
| T2, contre-preuve | l'ancien code sert le jour DH sans unité ; le nouveau le bloque |

**La CI `ci` ne lance aucune suite d'intégration.** Le job `integration-v2-off` donne la preuve hors du poste : à l'ouverture de la PR pour BETA sur `main`, puis, après la fusion de PR2, pour la branche mise à jour avec S2 et S3. C'est ce second passage qui compte pour le merge.

## Approbations requises avant toute fusion

1. HPM (2026-10-29) : S1, S2 et S3 acceptés ; S4 favorable sur le principe.
2. Architecte et Louis :
   - ADR `docs/review/beta-v2-tech-01/ADR_BETA_V2_TECH_01.md` (T2, B, exemptions V1) ;
   - canon `docs/05` (S4).
3. Architecte et Louis : canon de PR2 (réserve R1), préalable à l'empilement.
4. CI `integration-v2-off` verte sur la branche mise à jour, rapport relu (0 rechargement, aucun worker mort).
5. HPM : cohérence des contrats après intégration (S3 en particulier).
6. Louis : GO explicite pour le push, puis pour le merge.

## Après la fusion (hors PR, GO distincts)

1. Inventaire en lecture seule (`V1_EXEMPTION_PREFLIGHT_READONLY.sql`) : lignes `v1`, athlètes sans affectation.
2. Migration `20261027150000`, puis contrôle (`V1_EXEMPTION_POSTCHECK_READONLY.sql`). Si la contrainte reste `NOT VALID`, tracer chaque ligne avec la vraie décision, puis `VALIDATE`.
3. Écritures des affectations (`v2` pour les pilotes, `v1` tracée pour les comptes de test) : GO de Louis.
4. Déploiements : `daily-run`, `generate-training-plan`, web.
5. Régénération du programme du compte de test V2 (ses jours DH sans unité seront bloqués par T2).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
