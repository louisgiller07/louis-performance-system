# PR2-DH-REVOCATION — diffs canoniques (approbation formelle requise)

CLAUDE.md impose deux règles :
- une évolution du schéma est documentée dans `docs/05_DATA_MODEL.md` et `docs/11_DECISION_LOG.md` ;
- les documents `04`, `05` et `07` ne changent qu'après accord de l'architecte et de Louis.

Le HPM a accepté les six diffs **sur le principe**, avec la réserve R1 (2026-10-28). Ils sont **appliqués localement dans un commit dédié**, non poussé. Si l'approbation n'est pas donnée, ce commit est retiré avant tout push. L'approbation formelle de l'architecte et de Louis est un prérequis au push de ce commit et au merge. Seul le diff 4 modifie un texte existant ; les autres sont des ajouts.

## Décision demandée (architecte et Louis)

| # | Diff | Nature |
|---|---|---|
| 1 | `docs/05` : table `dh_drill_revocations` | Documente un ajout de schéma, exigé par CLAUDE.md. Positions produit : une révocation est définitive ; elle ne couvre que V2. |
| 2 | `docs/05` : garde de `record_session_execution` | Contrat : nouveau refus sur une RPC existante, sur le modèle de la suspension santé |
| 3 | `docs/05` : `persist_daily_run_v2` | Contrat : nouveau refus, hors des statuts `created` / `not_required` / `blocked`, qui annule tout le daily-run |
| 4 | `docs/05`, ligne « Tout ou rien » : renvoi | Modifie un texte existant, sinon « la validation sportive reste en TypeScript » devient incomplet |
| 5 | `docs/04` : daily-run refusé | Règle du moteur : refus sans REST ni nouvelle décision, répété tant que l'exercice reste prescrit ; aucun rétablissement promis |
| 6 | `docs/07` : « Révocation de sécurité » | Nouveau terme canonique |

**Acceptables**, décidés par le HPM (`docs/11` : SPORT-PLAN-03 01C, RELEASE-DECISION-PACK-01, revue du 2026-10-28) et implémentés par la migration :
- refus fail-closed, sans REST ni décision partielle ;
- absence de décision du jour pour une révocation de sécurité ;
- révocation définitive, et rollback refusé dès la première révocation ;
- invariant de santé vérifié : `health_flag_to_create` n'existe que dans la branche Safety de `buildDailyPlan`, dont la décision est REST et ne contient aucun exercice. Un refus ne fait donc jamais perdre un signal de santé.

Aucune contradiction avec le canon actuel.

**Réserve R1 (HPM 2026-10-28)** — démonstration : `PR2_FORWARD_FIX_ANALYSIS.md`.
1. Retirer l'exercice des signatures côté code ne le retire pas des programmes V2 enregistrés, et ne rétablit pas le service. En production, les tables de signatures sont vides.
2. **Le basculement V2 → V1 n'est pas une procédure sûre.**
   - Le catalogue V1 partage les identifiants d'exercices de V2, la sélection V1 est déterministe, et le chemin V1 ne lit pas la révocation. Un programme V1 peut donc réintroduire l'exercice révoqué.
   - Ce basculement ne pourra être qualifié de sûr qu'après démonstration du contraire.
   - D'ici là, la procédure est la **suspension contrôlée** des entraînements concernés (le refus livré par la PR2), avec information du rider.
3. **V2-DH-WITHDRAWAL** (item P0, à ne pas développer maintenant, prérequis à l'activation de V2) :
   - neutraliser les anciennes prescriptions contenant l'exercice. `blocked` est une protection, pas une restauration du service ;
   - prévoir un **remplacement ou une replanification sûre** des séances neutralisées ;
   - couvrir V1 et l'affichage.
4. **Avant la première révocation réelle**, une décision HPM sur la suspension contrôlée, l'information des riders concernés, et le traitement des programmes V1 qui prescrivent le même exercice.

R1 ne bloque pas le merge de la PR2 : le comportement livré est sûr, et le canon ne promet aucun rétablissement.

**Libellés d'approbation** (le SHA est celui du commit canonique, communiqué avec la demande) :
> **Architecte — APPROUVÉ** : diffs canoniques PR2 n° 1 à 6 (`docs/05` n° 1 à 4, `docs/04` n° 5, `docs/07` n° 6), tels qu'appliqués par le commit `<SHA>` de `release/v2-dh-revocation`, avec la réserve R1.

> **Louis — APPROUVÉ** : diffs canoniques PR2 n° 1 à 6, tels qu'appliqués par le commit `<SHA>` de `release/v2-dh-revocation`, avec la réserve R1.

Toute autre réponse (refus, approbation partielle, changement de rédaction) laisse le push du commit canonique et le merge en HOLD.

## `docs/05_DATA_MODEL.md`

**1. Nouvelle sous-section, après `training_plan_model_assignments` :**

```markdown
### `dh_drill_revocations` (V2-DH-REVOCATION, migration `20261027120000` — PR2, non déployée)

Révocation de sécurité d'un exercice DH : effective immédiatement, dans la même transaction que chaque écriture d'exécution et chaque écriture du daily-run, indépendamment de tout déploiement. Distincte de la péremption normale d'une validation sportive (signature côté code, `dhSportGateV2`).
- Colonnes : `id` (uuid), `drill_id` (texte, `^[a-z][a-z0-9_]*$`), `revoked_at` (défaut `now()`), `reason` (1 à 500 caractères), `decided_by` (1 à 200 caractères).
- Accès : RLS activée sans policy ; aucun droit pour `anon` / `authenticated` ; `service_role` = `SELECT`, `INSERT`. Ajout seul, propriétaire compris (triggers `reject_append_only_mutation`). Une révocation ne peut qu'interdire ; elle est définitive (aucune levée).
- Lue par `record_session_execution` et `persist_daily_run_v2` sous verrou `SHARE` (verrou de table) : une révocation en cours d'écriture et une écriture d'exécution ou de daily-run sont strictement ordonnées, table vide comprise. Les deux RPC refusent toute isolation autre que READ COMMITTED (`NX301`).
- Fonction de lecture `execution_dh_revocation_block(final_prescription_id)` : `dh_validation_not_current` si la prescription du jour contient un exercice révoqué, sinon NULL ; aucun rôle de l'API (comme `execution_health_block`) : seule `record_session_execution` l'appelle.
- Effet durable et périmètre : la révocation ne modifie aucune ligne ; les prescriptions prévues déjà enregistrées gardent l'exercice, restent visibles dans le programme et sont refusées à chaque écriture (voir `docs/04`). Elle ne couvre que les prescriptions V2 : le chemin V1 ne la lit pas, et le catalogue V1 partage les identifiants d'exercices. Retirer l'exercice des signatures ne rétablit pas le service (réserve R1, `docs/11`).
- Rollback : `supabase/rollbacks/v2_dh_revocation/` — refusé dès qu'une révocation existe, donc définitivement après la première ; conserve la table (historique) et la ferme aux nouvelles révocations.
```

**2. Liste des gardes de `record_session_execution`, après « Suspension santé d'une séance guidée » :**

```markdown
- **Révocation de sécurité d'un exercice DH (V2-DH-REVOCATION, migration `20261027120000`)** : sur toute prescription du jour v2 contenant un exercice révoqué (prescriptions figées comprises, quelle que soit leur mesure), `record_session_execution` refuse toute action d'entraînement — nouvelle exécution, événement `resumed` ou `completed`, résultat de série / passage / activité (correction comprise) — avec `dh_validation_not_current`. Toujours acceptés : `paused`, `abandoned`, les rejeux identiques, la lecture. Le refus annule tout le lot. L'Edge `session-execution` relaie le code (409), comme son garde de validation côté code.
```

**3. Paragraphe `persist_daily_run_v2`, ajout après la ligne « Tout ou rien » :**

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
**Exercice DH révoqué pour sécurité (V2-DH-REVOCATION, PR2)** : si la prescription du jour contiendrait un exercice révoqué en base (`dh_drill_revocations`), le daily-run est refusé en entier (`daily-run` : 409 `dh_validation_not_current`), sans décision ni prescription écrites, et jamais remplacé par un REST. La décision déjà enregistrée ce jour-là reste la décision courante ; son exécution est refusée par `record_session_execution`. S'applique au chemin quotidien V2, génération V2 active ou non.
- **Persistance du refus** : il se répète chaque jour où la prescription du jour contiendrait l'exercice. C'est le cas d'une prescription prévue déjà enregistrée (le KEEP la copie telle quelle), d'un MODIFY qui en reprend les exercices, et d'un REPLACE ou d'une séance manuelle DH, dont la sélection d'exercice est déterministe. Les autres jours sont servis normalement.
- **Aucun rétablissement automatique** : retirer l'exercice des signatures sportives côté code ne lève pas le refus (les signatures ne gouvernent que l'unité DH). Les entraînements concernés restent suspendus jusqu'à une neutralisation explicite des prescriptions concernées, suivie d'un remplacement ou d'une replanification sûre, à décider par ADR. Jamais une réautorisation de l'exercice.
- **Périmètre** : V2 seulement. Le chemin V1 ne lit pas la révocation ; un programme V1 peut prescrire le même exercice (catalogue V1, mêmes identifiants).
```

## `docs/07_GLOSSARY.md`

**6. À la fin de la section « Sessions » :**

```markdown
**Révocation de sécurité (exercice DH)** (V2-DH-REVOCATION)
Retrait immédiat et définitif, en base, de l'autorisation d'écrire et d'exécuter un exercice DH dans une prescription V2 (`dh_drill_revocations`), effectif dans la transaction de chaque écriture. À distinguer de la péremption d'une validation sportive (signature côté code), qui ne change qu'avec un déploiement. Ni l'une ni l'autre ne retire l'exercice des programmes déjà enregistrés ; la révocation ne couvre pas V1.
```
