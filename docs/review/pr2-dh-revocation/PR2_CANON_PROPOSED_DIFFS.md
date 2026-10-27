# PR2-DH-REVOCATION — diffs canoniques proposés (NON appliqués)

CLAUDE.md impose deux règles :
- une évolution du schéma est documentée dans `docs/05_DATA_MODEL.md` et `docs/11_DECISION_LOG.md` ;
- les documents `04`, `05` et `07` ne changent qu'après accord de l'architecte et de Louis.

Les ajouts ci-dessous décrivent la migration `20261027120000`. Ils sont **à valider avant la publication de la PR2**. Aucun texte existant n'est modifié : ce sont uniquement des ajouts.

## `docs/05_DATA_MODEL.md`

**1. Nouvelle sous-section, après `training_plan_model_assignments` :**

```markdown
### `dh_drill_revocations` (V2-DH-REVOCATION, migration `20261027120000` — PR2, non déployée)

Révocation de sécurité d'un exercice DH : effective immédiatement, dans la même transaction que chaque écriture d'exécution et chaque écriture du daily-run, indépendamment de tout déploiement. Distincte de la péremption normale d'une validation sportive (signature côté code, `dhSportGateV2`).
- Colonnes : `id` (uuid), `drill_id` (texte, `^[a-z][a-z0-9_]*$`), `revoked_at` (défaut `now()`), `reason` (1 à 500 caractères), `decided_by` (1 à 200 caractères).
- Accès : RLS activée sans policy ; aucun droit pour `anon` / `authenticated` ; `service_role` = `SELECT`, `INSERT`. Ajout seul, propriétaire compris (triggers `reject_append_only_mutation`). Une révocation ne peut qu'interdire ; sa levée est hors périmètre.
- Lue par `record_session_execution` et `persist_daily_run_v2` sous verrou `SHARE` (verrou de table) : une révocation en cours d'écriture et une écriture d'exécution ou de daily-run sont strictement ordonnées, table vide comprise. Les deux RPC refusent toute isolation autre que READ COMMITTED (`NX301`).
- Fonction de lecture `execution_dh_revocation_block(final_prescription_id)` : `dh_validation_not_current` si la prescription du jour contient un exercice révoqué, sinon NULL ; aucun rôle de l'API.
- Rollback : `supabase/rollbacks/v2_dh_revocation/` — refusé tant qu'une révocation existe ; conserve la table (historique) et la ferme aux nouvelles révocations.
```

**2. Liste des gardes de `record_session_execution`, après « Suspension santé d'une séance guidée » :**

```markdown
- **Révocation de sécurité d'un exercice DH (V2-DH-REVOCATION, migration `20261027120000`)** : sur toute prescription du jour v2 contenant un exercice révoqué (prescriptions figées comprises, quelle que soit leur mesure), `record_session_execution` refuse toute action d'entraînement — nouvelle exécution, événement `resumed` ou `completed`, résultat de série / passage / activité (correction comprise) — avec `dh_validation_not_current`. Toujours acceptés : `paused`, `abandoned`, les rejeux identiques, la lecture. Le refus annule tout le lot. L'Edge `session-execution` relaie le code (409), comme son garde de validation côté code.
```

**3. Paragraphe `persist_daily_run_v2`, ajout :**

```markdown
- **Révocation de sécurité (migration `20261027120000`)** : une prescription du jour contenant un exercice révoqué (keep, modify, replace ; générée ou manuelle) n'est jamais écrite : tout le daily-run est refusé (SQLSTATE `NX302`, détail : les exercices révoqués), rien n'est écrit (ni décision, ni prescription, ni signal de santé), jamais un REST à la place. Le chemin V1 ne l'appelle jamais.
```

## `docs/04_DAILY_DECISION_ENGINE.md`

À la fin de la section « Prescription du jour V2 et MODIFY vers le haut » :

```markdown
**Exercice DH révoqué pour sécurité (V2-DH-REVOCATION, PR2)** : si la prescription du jour contiendrait un exercice révoqué en base (`dh_drill_revocations`), le daily-run est refusé en entier (`daily-run` : 409 `dh_validation_not_current`), sans décision ni prescription écrites, et jamais remplacé par un REST. La décision déjà enregistrée ce jour-là reste la décision courante ; son exécution est refusée par `record_session_execution`. S'applique au chemin quotidien V2, génération V2 active ou non ; le chemin V1 n'est pas concerné.
```

## `docs/07_GLOSSARY.md`

```markdown
- **Révocation de sécurité (exercice DH)** : retrait immédiat, en base, de l'autorisation d'exécuter un exercice DH (`dh_drill_revocations`), effectif dans la transaction de chaque écriture. À distinguer de la péremption d'une validation sportive (signature côté code), qui ne change qu'avec un déploiement.
```
