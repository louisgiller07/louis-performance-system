# POWER-GUARD-01 — garde serveur de complétion d'une séance de puissance (proposition)

**Date** : 2026-10-18 · **Pour** : HPM et Louis · **Statut** : PROPOSITION. Aucune migration n'est installée ; le schéma ne change pas sans accord HPM.

## 1. Constat (vérifié)

La dernière définition de `record_session_execution` (`20261013160000_p0_3_health_suspension_execution_guard.sql`, l. 640-710) contrôle la complétion selon la famille de la prescription finale de l'exécution :

| Famille | Garde à la complétion | Refus |
|---|---|---|
| `activitySelection` présente (endurance) | une activité enregistrée | `activity_result_required` |
| `dh_technical` | un passage actif réalisé | `dh_pass_required` |
| `strength` (F-6C) | une série active réalisée sur un exercice de travail (`main` / `complementary`) de **sa** prescription | `strength_set_required` |
| **`power`** (PHYS-03) | **aucune** | — |

**Conséquence** : une séance de puissance peut être terminée par l'API avec zéro série. Seul le web l'empêche (`canComplete: recorded > 0`). M1 compterait alors une séance POWER MODERATE réalisée, et l'Historique la montrerait partiellement réalisée (PARTIAL-01).

## 2. Contrat proposé

**Règle** : une exécution dont la prescription finale est de famille `power` n'est terminée (`completed`) que s'il existe pour elle au moins une série :
- **active** : aucune correction ne la remplace (`supersedes_id`) ;
- **réalisée** : `done = true` ;
- portant sur un exercice que **sa** prescription place dans un bloc de travail (`main` ou `complementary`) ;
- enregistrée avant le `completed` ou dans le même lot.

C'est exactement F-6C, appliquée aussi à la famille `power`, dont les exercices explosifs sont en blocs `main`.

**Refus** : `NX001` `strength_set_required`.
- Il est déjà traduit en 422 par `session-execution` (`validation.ts:356`), avec un message côté web (« Enregistre au moins une série de travail pour pouvoir terminer la séance. »).
- **Aucune fonction Edge ni aucun web à modifier.**
- Option : un code dédié `power_set_required` rendrait le refus plus explicite, au prix d'un changement Edge (code et statut) et web (message). Ce n'est pas recommandé.

**Inchangés** :
- la garde santé (`execution_health_block` au démarrage, à la reprise, à la fin, aux séries, aux activités) ;
- F-6A (DH), F-6C (Force), la garde d'activité (endurance) ;
- l'unicité de la séance principale du jour (`session_already_completed`) ;
- l'idempotence d'un `completed` déjà enregistré ;
- mobilité et récupération : aucun résultat exigé, par conception.

**Données existantes** :
- aucune réécriture : la garde ne joue qu'à une nouvelle complétion ;
- une séance POWER déjà terminée le reste ;
- en production, aucune séance de puissance ne peut exister aujourd'hui (PHYS non déployé). À confirmer par la requête de précondition du § 4, qui doit renvoyer 0.

## 3. Diff exact (une condition)

La migration additive redéfinirait `public.record_session_execution(uuid, jsonb)` en reprenant **mot pour mot** la définition de `20261013160000`, avec un seul changement :

```diff
-      if found and v_act_structure ->> 'family' = 'strength'
+      -- POWER-GUARD-01 — the same rule for a power session (PHYS-03: explosive exercises in `main` work blocks).
+      if found and v_act_structure ->> 'family' in ('strength', 'power')
```

Le reste est identique :
- signature, `security definer`, `search_path`, propriétaire ;
- droits (`revoke` / `grant`) ;
- tous les autres blocs.

Un test d'empreinte comparerait le corps de la fonction à celui de `20261013160000` et n'admettrait que cette différence.

## 4. Requête de précondition (lecture seule, à lancer avant l'installation)

```sql
select count(*) as power_executions
  from public.session_executions e
  join public.decision_final_prescriptions fp on fp.id = e.final_prescription_id
 where fp.structure ->> 'family' = 'power';
```

Résultat attendu en production : `0`.

## 5. Tests prévus (pile locale, schéma de production + migration candidate)

**Puissance**
- zéro série + `completed` → 422 `strength_set_required` ; aucune ligne écrite (le lot est annulé) ;
- une série réalisée sur un exercice explosif, dans le même lot que `completed` → `ok` ;
- une série `done = false` seulement → refus ;
- une série réalisée puis remplacée par une correction `done = false` → refus ;
- une série sur un exercice d'échauffement seulement → refus ;
- renvoi idempotent d'un `completed` déjà accepté → `unchanged`, sans nouveau contrôle.

**Santé**
- signal de santé ouvert → `health_suspended` avant la garde, comme aujourd'hui.

**Non-régression**
- suites F-6A, F-6C, activité, UX-11R.9, P0-3, INT-01 inchangées ;
- une mobilité et une récupération se terminent sans résultat.

**Contre-preuve**
- avec la définition de `20261013160000` restaurée par le script de retour arrière, la puissance à zéro série est acceptée (200) ;
- avec la migration, elle est refusée.

**Empreinte**
- seule différence de corps de fonction : la ligne ci-dessus.

## 6. Retour arrière

Script `supabase/rollbacks/power-guard-01/` : il réinstalle le corps de `20261013160000` à l'identique, sans toucher aux données.

Aucune donnée n'est créée ni modifiée par la garde : le retour arrière est toujours possible.

## 7. Ordre de livraison proposé

1. Migration POWER-GUARD-01, inoffensive tant qu'aucune séance de puissance n'existe.
2. `daily-run` et `generate-training-plan` PHYS, flags OFF.
3. Web.
4. `NALYNT_V2_POWER_ENABLED` **seulement après** la garde, et sur décision HPM.

## 8. Décision attendue

- Validation du contrat : règle F-6C étendue à `power`, réutilisation de `strength_set_required`.
- GO pour écrire la migration et ses tests, en local seulement.
