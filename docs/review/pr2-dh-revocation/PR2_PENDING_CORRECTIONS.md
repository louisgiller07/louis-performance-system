# PR2-DH-REVOCATION — corrections préparées, à intégrer avec l'approbation du canon (NON appliquées)

À appliquer en un seul lot, après les approbations formelles des diffs canoniques (`PR2_CANON_PROPOSED_DIFFS.md`), puis à pousser sur GO de Louis. Rien ici ne modifie le code exécuté. Une exception : le message d'erreur du rollback (point 3), qui demande de relancer S3.

## 1. Statuts obsolètes

**`docs/00_PROJECT_STATUS.md`, en-tête du bloc PR2** :

```diff
-**PR2-DH-REVOCATION — révocation transactionnelle DH : APPROVED WITH CONDITIONS, locale (HPM 2026-10-28)** : branche `release/v2-dh-revocation` depuis `main` `a0a8921`.
+**PR2-DH-REVOCATION — révocation transactionnelle DH : Draft PR #2 publiée, canon approuvé (HPM <date>)** : branche `release/v2-dh-revocation` depuis `main` `a0a8921`, PR #2 en draft (DO NOT MERGE avant décision HPM).
```

```diff
-- Rien n'est poussé, appliqué ni déployé. V2 OFF.
+- Poussée le 2026-10-28 (`0c9f332`, Draft PR #2) : CI `verify:sport-approvals` et `tests` SUCCESS ; aucun déploiement Vercel de la branche. Rien n'est fusionné, migré ni déployé. V2 OFF.
```

```diff
-- Restent : GO de Louis pour le push ; approbation des diffs canon avant le merge ; GO de déploiement ; smoke V1 de production après le déploiement.
+- Restent : décision HPM de merge ; GO de déploiement ; smoke V1 de production après le déploiement ; réserve R1 (plan de rétablissement prêt avant la première révocation réelle, neutralisation côté code avant l'activation de V2 : `PR2_FORWARD_FIX_ANALYSIS.md`).
```

**`docs/12_BACKLOG.md`, ligne PR2** :

```diff
-(HPM 2026-10-27) : **APPROVED WITH CONDITIONS — LOCAL** (HPM 2026-10-28, branche locale `release/v2-dh-revocation`). … Restent : GO de Louis pour le push ; approbation des diffs canon (`docs/05`, `04`, `07`) avant le merge ; GO déploiement (…) ; smoke V1 de production après le déploiement (accord distinct de Louis).
+(HPM 2026-10-27) : **Draft PR #2 publiée** (2026-10-28, `0c9f332`, CI SUCCESS, aucun déploiement Vercel) ; canon approuvé (<date>). … Restent : décision HPM de merge ; GO déploiement (…) ; smoke V1 de production après le déploiement (accord distinct de Louis) ; réserve R1.
```

**Nouvel item `docs/12` (P0, avant l'activation de V2)** :

```markdown
- [ ] **V2-DH-WITHDRAWAL — neutralisation d'un exercice DH révoqué** (réserve R1, HPM <date>) : liste d'exercices retirés lue par le chemin quotidien V2 et les builders ; prescription enregistrée qui en contient un → `blocked` (code dédié, décision du jour écrite, rien d'exécutable) ; jamais de réautorisation. ADR + `docs/04` / `docs/05` + tests. Prérequis à l'activation de V2. Analyse : `docs/review/pr2-dh-revocation/PR2_FORWARD_FIX_ANALYSIS.md`.
```

**`docs/11_DECISION_LOG.md`** : les entrées « LOCAL » du 27 et du 28 octobre restent telles quelles, car le journal est historique. Ajouter une entrée :

```markdown
## <date> — PR2-DH-REVOCATION : premier push, revue finale du canon

> **Décision HPM** : PR2 FIRST PUSH APPROVED & CLOSED ; diffs canoniques 1 à 6 approuvés par l'architecte et Louis, avec la réserve R1.

- **Publication** : `release/v2-dh-revocation` `0c9f332` poussée le 2026-10-28 ; Draft PR #2 vers `main` `a0a8921` (19 fichiers) ; CI `verify:sport-approvals` et `tests` SUCCESS ; aucun déploiement Vercel de la branche ni du SHA.
- **Correction en avant** : retirer l'exercice des signatures côté code ne rétablit pas le service. Les signatures ne gouvernent que l'unité DH, les tables sont vides en production, et les programmes enregistrés gardent l'exercice (S4, rider aux signatures vides).
- **Réserve R1** :
  - avant la première révocation réelle : plan de rétablissement prêt (remplacement du programme du rider, accord distinct) ;
  - avant l'activation de V2 : neutralisation côté code (V2-DH-WITHDRAWAL).
- **Canon** : `docs/05`, `docs/04` et `docs/07` mis à jour selon les diffs approuvés.

**Statut** : Draft PR #2 ouverte, DO NOT MERGE avant décision HPM. Aucune migration, aucun déploiement, aucune révocation. V2 OFF.
```

## 2. Formulations qui promettent un rétablissement non démontré

| Fichier | Actuel | Proposé |
|---|---|---|
| `docs/review/pr2-dh-revocation/PR2_DH_REVOCATION_PREP_REPORT.md`, dépendance 5 | « En même temps, l'exercice est retiré des signatures côté code. » | « Avant : plan de rétablissement prêt (réserve R1). Le retrait des signatures côté code ne rétablit pas le service : `PR2_FORWARD_FIX_ANALYSIS.md`. » |
| `docs/release/PR2_DH_REVOCATION_RELEASE_PLAN.md`, §6.3 | « Correction en avant seulement. » | « Correction en avant seulement : remplacement ou neutralisation des prescriptions concernées (réserve R1), jamais le rollback ni une réautorisation. » |
| `supabase/migrations/20261027120000_v2_dh_drill_revocation.sql`, en-tête (commentaire seul) | `A revocation recorded here is also removed from the code-level sign-offs.` | `Lifting the effect of a revocation on stored plans needs a replacement or a code-level neutralisation (PR2_FORWARD_FIX_ANALYSIS.md); removing the drill from the sign-offs alone does not.` |
| Description de la PR #2 (GitHub), « Known limits » | « … until the forward fix. » | « … until the stored prescriptions are replaced or neutralised; removing the drill from the code-level sign-offs alone does not restore the service (reserve R1). » |

## 3. Message du rollback (code SQL, hors migration)

`supabase/rollbacks/v2_dh_revocation/20261027120000_rollback_v2_dh_drill_revocation.sql`, en-tête et `raise exception`. Le message actuel, « revoke them in the code-level sign-offs and deploy first », laisse croire que le rollback redevient possible. C'est faux : la table est en ajout seul, donc le refus est définitif.

```diff
-    raise exception 'rollback refused: % DH drill revocation(s) recorded; revoke them in the code-level sign-offs and deploy first',
+    raise exception 'rollback refused: % DH drill revocation(s) recorded; a revocation is permanent: fix forward only',
```

Le test S3 ne vérifie que le préfixe (`rollback refused: N DH drill revocation`). Le rollback étant du SQL exécutable, S3 sera relancé sur une stack fraîche au moment de l'intégration. La migration elle-même ne change pas (commentaire d'en-tête seulement).
