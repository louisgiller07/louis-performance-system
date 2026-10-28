# PR2-DH-REVOCATION — diffs canoniques proposés (NON appliqués)

CLAUDE.md impose deux règles :
- une évolution du schéma est documentée dans `docs/05_DATA_MODEL.md` et `docs/11_DECISION_LOG.md` ;
- les documents `04`, `05` et `07` ne changent qu'après accord de l'architecte et de Louis.

Leur approbation définitive est **un prérequis au merge de la PR2**, pas au premier push (HPM 2026-10-28). Seul le diff 4 modifie un texte existant ; les autres sont des ajouts.

## Décision demandée (architecte et Louis)

| # | Diff | Nature |
|---|---|---|
| 1 | `docs/05` : table `dh_drill_revocations` | Documente un ajout de schéma, exigé par CLAUDE.md. Position produit : une révocation ne se lève jamais. |
| 2 | `docs/05` : garde de `record_session_execution` | Contrat : nouveau refus sur une RPC existante, sur le modèle de la suspension santé |
| 3 | `docs/05` : `persist_daily_run_v2` | Contrat : nouveau refus, hors des statuts `created` / `not_required` / `blocked`, qui annule tout le daily-run |
| 4 | `docs/05`, ligne « Tout ou rien » : renvoi | Modifie un texte existant, sinon « la validation sportive reste en TypeScript » devient incomplet |
| 5 | `docs/04` : daily-run refusé | Règle du moteur : refus sans REST ni nouvelle décision, répété tant que l'exercice reste prescrit |
| 6 | `docs/07` : « Révocation de sécurité » | Nouveau terme canonique |

**Acceptables**, décidés par le HPM (`docs/11` : SPORT-PLAN-03 01C, RELEASE-DECISION-PACK-01, revue du 2026-10-28) et implémentés par la migration :
- refus fail-closed, sans REST ni décision partielle ;
- absence de décision du jour pour une révocation de sécurité ;
- révocation définitive, et rollback refusé dès la première révocation ;
- invariant de santé vérifié : `health_flag_to_create` n'existe que dans la branche Safety de `buildDailyPlan`, dont la décision est REST et ne contient aucun exercice. Un refus ne fait donc jamais perdre un signal de santé.

Aucune contradiction avec le canon actuel.

**Réserve R1, sur la correction en avant.** Retirer l'exercice des signatures côté code ne rétablit pas le service : en production, les tables sont vides et les programmes déjà enregistrés gardent l'exercice. Démonstration et mécanismes : `PR2_FORWARD_FIX_ANALYSIS.md`. Les diffs 1, 5 et 6 ont été corrigés pour ne rien promettre de plus. R1 demande :
- **avant la première révocation réelle** : un plan de rétablissement prêt. Aujourd'hui, c'est le remplacement du programme du rider affecté (affectation passée à `v1`, puis programme V1 accepté). Il faut un accord distinct pour l'écriture en production et une décision produit sur la sortie de la bêta V2 ;
- **avant l'activation de V2** : un mécanisme de neutralisation côté code, qui donne `blocked` sans réautoriser l'exercice, avec ADR et item P0 « V2-DH-WITHDRAWAL ».

R1 ne bloque pas le merge de la PR2 : le comportement livré est sûr.

**Libellés d'approbation** :
> **Architecte — APPROUVÉ** : diffs canoniques PR2 n° 1 à 6 (`docs/05` n° 1 à 4, `docs/04` n° 5, `docs/07` n° 6), tels que rédigés dans `docs/review/pr2-dh-revocation/PR2_CANON_PROPOSED_DIFFS.md` au commit `<SHA>`, avec la réserve R1.

> **Louis — APPROUVÉ** : diffs canoniques PR2 n° 1 à 6, tels que rédigés dans `docs/review/pr2-dh-revocation/PR2_CANON_PROPOSED_DIFFS.md` au commit `<SHA>`, avec la réserve R1.

Toute autre réponse (refus, approbation partielle, changement de rédaction) laisse le merge en HOLD.

## `docs/05_DATA_MODEL.md`

**1. Nouvelle sous-section, après `training_plan_model_assignments` :**

```markdown
### `dh_drill_revocations` (V2-DH-REVOCATION, migration `20261027120000` — PR2, non déployée)

Révocation de sécurité d'un exercice DH : effective immédiatement, dans la même transaction que chaque écriture d'exécution et chaque écriture du daily-run, indépendamment de tout déploiement. Distincte de la péremption normale d'une validation sportive (signature côté code, `dhSportGateV2`).
- Colonnes : `id` (uuid), `drill_id` (texte, `^[a-z][a-z0-9_]*$`), `revoked_at` (défaut `now()`), `reason` (1 à 500 caractères), `decided_by` (1 à 200 caractères).
- Accès : RLS activée sans policy ; aucun droit pour `anon` / `authenticated` ; `service_role` = `SELECT`, `INSERT`. Ajout seul, propriétaire compris (triggers `reject_append_only_mutation`). Une révocation ne peut qu'interdire ; elle est définitive (aucune levée).
- Lue par `record_session_execution` et `persist_daily_run_v2` sous verrou `SHARE` (verrou de table) : une révocation en cours d'écriture et une écriture d'exécution ou de daily-run sont strictement ordonnées, table vide comprise. Les deux RPC refusent toute isolation autre que READ COMMITTED (`NX301`).
- Fonction de lecture `execution_dh_revocation_block(final_prescription_id)` : `dh_validation_not_current` si la prescription du jour contient un exercice révoqué, sinon NULL ; aucun rôle de l'API (comme `execution_health_block`) : seule `record_session_execution` l'appelle.
- Effet durable : la révocation ne modifie aucune ligne ; les prescriptions prévues déjà enregistrées gardent l'exercice et restent refusées à chaque écriture (voir `docs/04`). Seul un remplacement ou une neutralisation de ces prescriptions rétablit le service, jamais un retrait de signature seul.
- Rollback : `supabase/rollbacks/v2_dh_revocation/` — refusé dès qu'une révocation existe, donc définitivement après la première ; conserve la table (historique) et la ferme aux nouvelles révocations.
```

**2. Liste des gardes de `record_session_execution`, après « Suspension santé d'une séance guidée » :**

```markdown
- **Révocation de sécurité d'un exercice DH (V2-DH-REVOCATION, migration `20261027120000`)** : sur toute prescription du jour v2 contenant un exercice révoqué (prescriptions figées comprises, quelle que soit leur mesure), `record_session_execution` refuse toute action d'entraînement — nouvelle exécution, événement `resumed` ou `completed`, résultat de série / passage / activité (correction comprise) — avec `dh_validation_not_current`. Toujours acceptés : `paused`, `abandoned`, les rejeux identiques, la lecture. Le refus annule tout le lot. L'Edge `session-execution` relaie le code (409), comme son garde de validation côté code.
```

**3. Paragraphe `persist_daily_run_v2`, ajout :**

```markdown
- **Révocation de sécurité (migration `20261027120000`)** : une prescription du jour contenant un exercice révoqué (keep, modify, replace ; générée ou manuelle) n'est jamais écrite : tout le daily-run est refusé (SQLSTATE `NX302`, détail : les exercices révoqués), rien n'est écrit (ni décision, ni prescription, ni signal de santé), jamais un REST à la place. Le chemin V1 ne l'appelle jamais.
```

**4. Ligne « Tout ou rien » du même paragraphe, modification :**

```diff
-- Tout ou rien : health flag éventuel, décision, statut et prescription du jour. Le document est stocké tel quel (identifiants de l'appelant, aucun recalcul) ; la validation sportive reste en TypeScript avant l'appel.
+- Tout ou rien : health flag éventuel, décision, statut et prescription du jour. Le document est stocké tel quel (identifiants de l'appelant, aucun recalcul) ; la validation sportive reste en TypeScript avant l'appel. Seule exception côté serveur : la révocation de sécurité d'un exercice DH (ci-dessous), qui refuse l'écriture sans modifier le document.
```

## `docs/04_DAILY_DECISION_ENGINE.md`

**5. À la fin de la section « Prescription du jour V2 et MODIFY vers le haut » :**

```markdown
**Exercice DH révoqué pour sécurité (V2-DH-REVOCATION, PR2)** : si la prescription du jour contiendrait un exercice révoqué en base (`dh_drill_revocations`), le daily-run est refusé en entier (`daily-run` : 409 `dh_validation_not_current`), sans décision ni prescription écrites, et jamais remplacé par un REST. La décision déjà enregistrée ce jour-là reste la décision courante ; son exécution est refusée par `record_session_execution`. S'applique au chemin quotidien V2, génération V2 active ou non ; le chemin V1 n'est pas concerné.
- **Persistance du refus** : il se répète chaque jour où la prescription du jour contiendrait l'exercice. C'est le cas d'une prescription prévue déjà enregistrée (le KEEP la copie telle quelle), d'un MODIFY qui en reprend les exercices, et d'un REPLACE ou d'une séance manuelle DH, dont la sélection d'exercice est déterministe. Les autres jours sont servis normalement.
- **Rétablissement** : retirer l'exercice des signatures sportives côté code ne lève pas le refus (les signatures ne gouvernent que l'unité DH). Seule une neutralisation explicite rétablit la décision du jour : remplacement du programme du rider, ou mécanisme de retrait à décider par ADR. Jamais une réautorisation de l'exercice.
```

## `docs/07_GLOSSARY.md`

**6.**

```markdown
- **Révocation de sécurité (exercice DH)** : retrait immédiat et définitif, en base, de l'autorisation d'exécuter un exercice DH (`dh_drill_revocations`), effectif dans la transaction de chaque écriture. À distinguer de la péremption d'une validation sportive (signature côté code), qui ne change qu'avec un déploiement. Ni l'une ni l'autre ne retire l'exercice des programmes déjà enregistrés.
```
