# INT-01 — V2 INTEGRATED RELEASE CANDIDATE REPORT

**Date** : 2026-10-13 · **Pour** : HPM (via Louis) · **Statut** : local uniquement — aucun push, merge, déploiement, activation V2 ni écriture en production.

## 1. Branche et HEAD
- Branche `int/int-01-v2-candidate` (worktree isolé `C:\nx\int01`), base production P0-SAFE `92937a9`.
- HEAD vérifié : `2cb5ecb` (+ ce commit de documentation). 30 commits au-dessus de la production.
- Stack locale isolée `nalynt-int01` (ports 548xx), schéma production + 3 migrations P0-3, Edge servies localement.

## 2. Assemblage et conflits
| Lot | Source | Commits INT-01 | Notes |
|---|---|---|---|
| P0 première génération + P0-2 | `7208671` | `ec987f3` → `d9baea6` (10) + `57edde9` | **Écart assumé** : `7208671` repose sur le train A12 (12 migrations A12, dont V2 par défaut pour tout nouveau compte). A12 est exclu : seuls les 10 commits P0 / P0-2 sont repris. Conflits : garde d'accès A12 retirée (`generateTrainingPlanErrors.ts`, `generate-training-plan/index.ts`) ; `compatibleTerrains` conservé ; docs 00/10/11/12 réappliquées sans A12 (`57edde9`). Hors A12, code identique à `7208671`. La première génération P0 (T54, non déployée) est donc incluse. |
| P0-3 | `8be87d6` | `ffe6a08` → `6115e2a` (11) | Commit WIP `fab261f` fusionné avec son suite `fed16e5` (`5a4184b`, message explicatif). 50 fichiers identiques à `8be87d6`. |
| P0-4 | `8b07b2e` | `5d00f96` → `325e2c1` (4) | Docs en union P0-3 puis P0-4 ; T58 après T57. 20 fichiers identiques à `8b07b2e`. |
| Tests INT-01 | — | `aa810be`, `3dbceb5`, `36dd663`, `2cb5ecb` | Harnais uniquement, aucune assertion métier modifiée (voir §4). |

P0-SAFE préservé (aucun fichier P0-SAFE modifié hors unions documentaires). P1-TXT-01 non intégré. 0 marqueur de conflit. Aucun ADR, test ni migration perdu. Moteur M1 (`src/{types,engine,rules,domains,mapping}`) : aucun diff vs production.

## 3. Migrations et empreintes
Base locale propre équivalente prod (66 migrations, dernière `20261007090000`) + `20261013120000`, `20261013140000`, `20261013160000` → 69.

| Fonction | Production | Candidat |
|---|---|---|
| `persist_daily_run_v2` | `81e6e690…` | `8ea80f33…` |
| `project_training_plan` | `82649dd9…` | `0e5079f4…` |
| `record_session_execution` | `21e8302a…` | `dd3c0a68…` |
| `purge_athlete_account` | `4d2f302a…` | inchangée |
| `enforce_planned_session_day_lock` / `planned_session_day_has_execution` / `execution_health_block` | — | `4161cfe4…` / `3bbe93b0…` / `8c7972c7…` |

`SECURITY DEFINER`, `search_path` et droits des fonctions existantes inchangés ; nouvelles fonctions exécutables par `postgres` seul ; 2 triggers ajoutés sur `planned_sessions`.

Edge (inventaire sha256, `build:release:all` puis `--verify-only`) : 3 fonctions changent — `daily-run` (graphe `e00f0011…` vs `6c26c286…`), `generate-training-plan` (`dbccafa4…` vs `85339242…`), `session-execution` (`aebd17b1…` vs `0702b514…`). Les 7 autres sont identiques à la production.

## 4. Tests
| Suite | Résultat |
|---|---|
| planning-engine | 883 / 883 |
| prescription-engine | 96 / 96 |
| head-coach-engine (DB + Edge locales) | 1353 / 1354 ; le seul échec (timeout 5 s sous charge, UX-11R.9) passe 3 / 3 isolé |
| head-coach Edge configs | session-execution 24 / 24, completed-session 147 / 147, edge 57 / 57 |
| longitudinal-engine | 873 / 873 |
| web (unitaires + 12 fichiers d'intégration) | 2206 / 2206 ; build OK |
| Build release | OK, inventaire stable |

Corrections de harnais (tests seulement) :
- **Intégrations web** (`aa810be`) : URL codée en dur levée → résultats combinés obtenus.
- **longitudinal** (`3dbceb5`) : le harnais visait la stack dev de Louis pour psql et l'API authentifiée (23 faux échecs). Vérifié en lecture seule : aucun résidu dans la base dev (ni trigger/fonction de test, ni ligne). Une ligne de contamination créée par ce premier run sur la stack INT-01 jetable a été retirée.
- **Edge P0 / P0-2** (`36dd663`) : sans A12, un nouveau compte est en V1 ; les riders de test reçoivent l'assignation V2, comme un rider V2 en production.
- **Contrat `REJECTION_STATUS`** (`2cb5ecb`) : P0-3 n'avait pas ajouté `health_suspended` / `daily_decision_not_current` au test de contrat. Ce test échouait déjà sur `8be87d6` seul (config dédiée, hors suite par défaut).

## 5. Parcours réels (navigateur mobile 390 px, web + Edge candidats, JWT réels)
1. **Onboarding V2 → génération → acceptation → check-in** (rider créé par l'UI, profil du rider du 9 octobre) :
   - Sans assignation V2 (chemin V1, identique à la production) : 422 `no_compatible_drill`.
   - Assigné V2 : génération 200 au premier appel, acceptation 200, check-in + daily-run 200.
   - Drills générés compatibles avec les terrains déclarés.
2. **Séance guidée → résultats → historique.** Riders r2 / r3 : plan V2 généré à J-10 par le harnais P0-4, car la date serveur ne peut être avancée. Tout le reste passe par l'UI.
   - r3 — DH : 6 / 6 passages, terminée. L'historique affiche le détail en lecture seule.
   - r2 — Force : 3 séries. L'historique affiche « Séance guidée arrêtée », 3 / 9, et « 1 séance arrêtée (partielle) » (P0-4).
3. **Force manuelle + 30 min** :
   - Récupération active, règles `v2.manual.session` / `v2.replace.recovery_active` / `v2.time.today_limit`, « Temps disponible limité » (T42-D).
   - Avec « Comme prévu » : Force 1 h `keep` manuel. DH manuelle + 30 min → récupération active (R4).
   - Date hors horizon du plan : bloqué `manual_session_outside_current_plan`, message affiché.
4. **Changement de programme pendant la séance** :
   - Modifier le jour en cours : refus serveur affiché, base inchangée. Modifier demain : accepté.
   - Relance daily-run (nouvelle décision + prescription) : la séance continue (série 3 acceptée).
   - Jour terminé : verrouillé aussi.
5. **Suspension santé après démarrage** (douleur traumatique au check-in) :
   - REST SAFETY, signal ouvert (clearance professionnelle requise, P0-SAFE intact), écran guidé « Séance suspendue ».
   - Avec le JWT : série 409 `health_suspended`, reprise 409, terminer 409, pause 200 ; arrêt par l'UI 200, résultats conservés.
6. **P0-2 / P0-4** :
   - Rider avancé sans dévers : drill v2_only `cornering_advanced_line_exit`, affiché « Trajectoire et sortie de virage ».
   - Historique des séances terminées, arrêtées ou d'une autre décision conforme à T58.

## 6. Rollback et compatibilité SQL / Edge
- **Rollback SQL** (ordre inverse 160000 → 140000 → 120000) : les 4 fonctions reviennent exactement aux empreintes production (corps, `SECURITY DEFINER`, `search_path`, ACL) ; triggers et fonctions P0-3 retirés.
- **Ré-application** (120000 → 140000 → 160000) : empreintes identiques au candidat. Contre-preuve : le `keep` manuel passe ensuite.

| Edge × SQL | Résultat | Conforme au plan P0-3 |
|---|---|---|
| `daily-run` candidat × SQL prod, jour manuel | 500 `persistence_failed`, rien écrit | oui (« daily-run jamais avant 120000 ») |
| `daily-run` candidat × SQL prod, jour généré | 200 `created` | oui |
| `session-execution` candidat × RSE prod | 200 (démarrage, pause, reprise) | oui |
| `daily-run` prod × SQL candidat (manuel / généré) | 200 (manuel : bloqué `planned_session_not_generated`) | oui |
| `session-execution` prod × RSE candidat suspendue | reprise refusée mais remontée en **500** ; pause / arrêt 200 | oui (« session-execution avant 160000 ») |
| **`daily-run` prod × plan candidat avec drill v2_only** | **500** `SessionModelV2ContractError` sur ces jours DH (jour Force du même rider : 200) | **non documenté** → R2 |

## 7. Réserves P0-2
- **Versionnement v2.6** : l'agrégat reste `session-model-v2.6`.
  - Ajouts : drill `cornering_advanced_line_exit` (v2_only), cue, critère, intent `dh_corner_line_control`, libellé web.
  - Modifications : `compatibleTerrains` (sélection seulement) ; terrain de référence de `cornering_off_camber` → `off_camber_section`.
  - Compatible en avant : les anciens plans restent lisibles et adaptables (`p0_2OldPlanCompatibility`, verts).
  - **Pas compatible en arrière** : le code production ne décode pas le nouveau drill sous le même label → R2.
- **Contenus PROVISIONAL** : tous les catalogues V2 restent `PROVISIONAL` (le seul `VALIDATED` est dans `coachingTextCatalog`). P0-2 ajoute des textes brouillons non approuvés : cue / critère / intent / libellé de `cornering_advanced_line_exit`. Les textes du dévers (« poids côté aval ») restent en revue technique. **Les tests verts ne valident aucune consigne sportive.**
- **Compatibilité historique** : vérifiée en avant (suites P0-2 + parcours). Rollback : voir R2.

## 8. Constats et risques résiduels
**Bloquants pour la release (proposition minimale, rien implémenté)** :
- **R1 — reprise affichée sous suspension santé (web, résidu P0-3).**
  - Constat : sous suspension, Aujourd'hui affiche « Séance suspendue — Consulter la séance » puis, juste dessous, le bloc « Après ta séance » (UX-11R.9 F-5b, non adapté par P0-3) : « Séance guidée en cours — **Reprendre la séance guidée** ».
  - Conséquence : contredit la règle HPM P0-3 (pas de reprise) et le smoke §4.6. Le serveur et l'écran guidé bloquent correctement.
  - Proposition : sous `healthBlock`, ce bloc dit « Séance suspendue » avec le lien « Consulter la séance » ; la boîte de confirmation d'arrêt remplace « Continuer la séance » par « Retour ». Web seulement + test.
- **R2 — rollback Edge `daily-run` après un plan contenant le drill v2_only.**
  - Constat : le `daily-run` de production renvoie 500 sur ces jours DH. Absent du plan de rollback.
  - Options :
    - (a) après la première génération de ce drill, `daily-run` ne se rollback plus en arrière ; inventaire SQL des plans concernés avant toute décision ;
    - (b) monter la version du catalogue (refusé par l'ADR P0 : bloquerait l'adaptation des anciens plans) ;
    - (c) retirer le drill du candidat.
  - Décision HPM requise.

**Décisions produit (non bloquantes pour l'assemblage)** :
- **R3 — la correction P0 ne profite qu'aux riders V2.**
  - Sans A12, un nouveau compte génère en V1. Le profil du 9 octobre reçoit 422 au premier essai, comme en production aujourd'hui.
  - Le candidat n'active rien ; l'activation (assignation V2) reste une décision HPM.
- **Concurrence santé** : limite documentée par P0-3 (suspension effective au commit).

**Mineurs** :
- 4 erreurs `tsc` dans des fichiers de test P0-3 / P0-4 (`body: unknown`). La production en a déjà 23 de ce type ; aucune n'affecte vitest ni le build.
- Bande « Cette semaine » non rafraîchie après une relance dans la même page (correcte au rechargement).
- DH manuelle sans durée → 4 h (défaut M1 existant, inchangé).

## 9. Différences vs production
108 fichiers, +8110 / −156 :
- 3 migrations + 3 rollbacks ;
- 3 Edge (`daily-run` via planning-engine embarqué, `generate-training-plan`, `session-execution`) ;
- planning-engine (catalogue DH, builders manuels / réconciliation) ;
- 2 fichiers de l'adaptateur head-coach (`supabase/dailyV2`, aucun changement M1) ;
- web (55 fichiers : séances manuelles, suspension santé, historique guidé, refus terrain précis) ;
- docs (00, 05, 10, 11, 12, release).

Aucun changement de flag, d'entitlement ni de schéma hors P0-3.

## 10. Verdict
**BLOCKED** — sur R1 (règle santé P0-3 contredite à l'écran) et R2 (rollback de `daily-run` non sûr, non documenté).

Tout le reste est vert sur le candidat combiné : suites, parcours réels, migrations, rollback SQL et compatibilités prévues.

Levée proposée : GO pour le correctif web R1, décision HPM sur R2. Ensuite, relance ciblée de la suite web et des parcours 2 et 5 avant READY INTEGRATION.
