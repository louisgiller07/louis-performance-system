# V2_PHYS_READINESS_01_REPORT — État réel de V2 et PHYS, stratégie d'intégration

**Date** : 2026-10-18 · **Pour** : HPM et Louis · **Nature** : lecture et analyse uniquement.

Rien n'a été touché :
- aucun code, aucune migration, aucun déploiement, aucun cherry-pick ;
- aucune requête en production.

Conflits Git simulés par `git merge-tree`, sans toucher ni worktree ni branche.

**Référence** : production web `863f3fb`, SQL 75 migrations, V2 et PHYS OFF (confirmé par Louis le 2026-10-18).

**Légende** : ✔ vérifié dans le code, les docs ou Git · ⚠ **non établi**.

---

## 1. État vérifié de chaque chantier

### 1.1 V2 (planification, prescription finale, séances guidées)

| Élément | État |
|---|---|
| Code | ✔ Entièrement dans `main` et en production. INT-01 (`2f3567a`), C (`59202dc`), D (`649a0a2`), D′ (`a188a1f`) sont tous ancêtres de `863f3fb`. Les fonctions Edge de production ont les graphes de D′, revérifiés à la release PARTIAL-01. |
| Catalogue | ✔ `session-model-v2.6` (ADR INT-01 R2). Cible de retour arrière documentée : C, compatible avec le catalogue (`INT_01_COMPAT_RELEASE_PLAN.md:33-54`). |
| Interrupteur | ✔ Secret `NALYNT_V2_PLAN_GENERATION_ENABLED`, lu uniquement par `generate-training-plan`. Seule la valeur exacte `"true"` l'active (`planningModelRollout.ts:22,32-34`). Le contrôle « empreinte ≠ `b5bea41b…` » vaut donc « pas exactement `true` », car `b5bea41b…` est le sha256 de `true`. |
| Affectation | ✔ Table `training_plan_model_assignments`, réservée à `service_role`. Règle A09 : interrupteur OFF et rider affecté V2 → refus 503 `v2_generation_disabled`, jamais de repli V1. |
| Chemin quotidien | ✔ `daily-run` ignore l'interrupteur : il suit `prescription_schema_version` du programme courant (`dailyPrescriptionModel.ts`). **Un programme V2 déjà courant continue en V2 même interrupteur OFF.** |
| Production aujourd'hui | ⚠ Affectations V2 et programmes V2 courants non connus. Selon `docs/00`, au 2026-10-05, le compte de simulation était affecté V2 avec le programme V2 `cd5cde79` courant. La requête d'inventaire du § 6 lève ce doute. |
| Tests | ✔ Unitaires (head-coach, planning, web) ; intégrations sur pile locale (`v2RolloutFlag`, `v2DailyIntegration`, `sessionExecution`, `ux11r9*`, `p0_3*`, `guidedSession*`, `partial01Realisation`…) ; orchestration HTTP OFF→ON→OFF 26/26. |
| Blocages documentés | Voir la liste ci-dessous. |

**Blocages documentés**
- Validation du contenu de coaching : 275 entrées `pending` ou PROVISIONAL (`COACHING_CONTENT_SIGNOFF.md:4-8`). L'inventaire est encore généré en v2.5.
- R3 : l'activation est une décision HPM, A12 exclu. Les textes P0-2 sont des brouillons PROVISIONAL.
- PARTIAL-01-L1 et -L2.
- Critère de bêta payante « aucune nouvelle génération client en V1 » (`12_BACKLOG.md:708`).
- Points ouverts INT-01 :
  - débriefs existants non inventoriés ;
  - `persist_daily_run_v2` sans verrou ;
  - textes web à relire.
- Règle de catalogue 7, proposée mais non implémentée : un contenu inconnu sous un label connu donne une erreur 500 au lieu d'un statut bloqué (`11_DECISION_LOG.md:6038`).

**Hors `main`**
- **A12** (`feat/a12-1` … `a12-w`) inclut la migration `20261008090000_a12_1_v2_default_assignment.sql`, qui affecte V2 par défaut aux nouveaux riders.
- La pile PHYS.
- **Incohérence documentaire** : `UX-11R_RELEASE_CANDIDATE.md:150` et `11_DECISION_LOG.md:4794` décrivent l'ancienne règle d'affectation. Le code suit A09.

### 1.2 Pile PHYS (7 commits, linéaire, base `649a0a2` = D)

Points communs ✔ :
- aucune migration ;
- dossiers gelés de M1 non touchés ;
- prescription-engine et longitudinal-engine non touchés ;
- `session-execution` et `record_session_execution` non touchés ;
- 123 fichiers au total ;
- seul fichier modifié aussi par `main` depuis la base : `docs/11` ;
- canon seulement proposé (`PHYS_01_PROPOSED_CANON_DIFFS.md`, « non appliquées ») ;
- paramètres sportifs **PROVISIONAL**, validation par un préparateur physique qualifié requise ;
- tout est NOT DEPLOYED.

| Commit (branche) | Ce que le rider obtient | Contrat | Flag | Edge à redéployer | Tests | Blocages ouverts |
|---|---|---|---|---|---|---|
| `5ec0976` + **`5466df3`** PHYS-01 / 01.1 (`feat/phys-01-physical-coaching`) | Force : retour au calme, guidage de charge (double progression à partir des séries du rider, jamais de 1RM), maintien en cas de douleur ou de fatigue (`todayLoadHold`) | v2.6 inchangé (la v2.7 de PHYS-01 est annulée) ; `loadGuidance` optionnel ; `strength-daily-v1` hors manifeste | **aucun** : actif sur tout programme V2 dès le déploiement | `daily-run` | unitaires planning et head-coach ; intégrations `phys01*`, `phys011PreviousRuntimeCompat` ; web | ADR 01.1 acceptée comme base locale (HPM 2026-10-15). **Le guidage de charge contredit le canon actuel** : `docs/03` §10 dit « Pas de progression fondée sur la performance réelle ». La levée est proposée (`PHYS_01_PROPOSED_CANON_DIFFS.md:115-130`), non appliquée. Décisions produit ouvertes (`PHYS_01_1_…REPORT.md:166`). « Rollback-safe » prouvé contre D seulement |
| `869d3c6`, `71007c7`, **`433a5fe`** PHYS-02 / 02.1 (`feat/phys-02-endurance`) | séance d'intervalles 6×3 min à RPE 8 en semaines de surcharge (flag) ; guidage d'endurance (sans flag) ; repli vers l'endurance de base LIGHT, avec garde douleur | v2.6 ; `enduranceGuidance` ; clés additives `dose_summary.progression` | `NALYNT_V2_ENDURANCE_INTERVALS_ENABLED` | `daily-run`, `generate-training-plan` | `phys02*` unitaires et intégrations, compatibilité, SQL de retour arrière | **Conflit de canon** avec l'ADR UX-11A.5a.3 §5 (exception proposée). Résultats par répétition non stockés. « Retour vers D impossible tant qu'un programme courant contient un fractionné » |
| **`1bf0295`** PHYS-03 (`feat/phys-03-power`) | séance POWER en semaines de construction (flag), jamais pour un débutant ; maintien si M1 signale une fatigue des jambes ou de la préhension | famille `power`, `power-session-v1`, `power-plan-v1` | `NALYNT_V2_POWER_ENABLED` | les deux | `phys03*`, `powerFatigueGate` ; web | **Aucune garde serveur de complétion** (§ 3.3). Branche POWER de M1 : décision HPM requise (F.4.3) |
| **`91bb721`** PHYS-04 (`feat/phys-04-mobility-bodyweight`) | séance de mobilité de 30 min en semaines de consolidation (flag) ; indication de répétitions au poids du corps | `mobility-plan-v1`, `bodyweight-reps-guidance-v1` | `NALYNT_V2_MOBILITY_ENABLED` | les deux | `phys04*` ; web `MobilitySessionModule` | voir la liste ci-dessous |

**Blocages PHYS-04** (`PHYS_04_…REPORT.md:153-160`)
1. Aucune variante au poids du corps dans le catalogue.
2. `docs/03` §7 et §10 interdisent la progression fondée sur la performance réelle. PHYS-01 propose de lever cette règle pour la charge Force, et PHYS-04 l'étend aux répétitions au poids du corps (G.5). Diffs non appliqués.
3. +30 min ajoutées à la semaine de consolidation.
4. Le web de D ne sait pas terminer une séance de mobilité.
5. Validation qualifiée.
6. Garde serveur POWER.

## 2. Dépendances

| | V2 (prod) | PHYS-01.1 | PHYS-02 | PHYS-03 | PHYS-04 |
|---|---|---|---|---|---|
| Dépend de | — | V2 (chemin quotidien V2) | 01.1 (empilé) | 02 | 03 |
| Conflit Git sur `863f3fb` | — | ✔ `docs/11` seulement (`merge-tree`, ajouts en fin de fichier) | idem | idem | idem |
| CONSISTENCY-01 / -02 | en prod | ✔ aucun fichier commun ; ⚠ suites non rejouées sur la combinaison | idem | idem | idem |
| PARTIAL-01 | en prod | ✔ aucun fichier commun | idem | ✔ POWER passe par `isGuidedStrengthPrescription` : la réalisation sera calculée comme pour la Force | ✔ mobilité neutre (« Terminée »), conforme |
| P0-SAFE | en prod | ✔ gardes santé de `record_session_execution` indépendantes de la famille ; A6 / A7 dans M1, non touché ; les ajouts PHYS s'appliquent après M1 | idem | idem ; ⚠ zones de douleur non classées : POWER inchangé, comme la Force | idem |
| Données persistées | — | aucune nouvelle table | un programme avec fractionné empêche le retour vers D | idem pour POWER | idem, et l'ancien web ne sait pas terminer une mobilité |
| Rester OFF | interrupteur ≠ `true`, aucune affectation V2 nouvelle | **pas de flag** : agit sur tout programme V2 courant → inventaire préalable | flag absent ou `false` | idem | idem |

**Ordre imposé** : la pile est empilée. On l'intègre dans l'ordre 01.1 → 02 → 03 → 04, ou en entier avec les flags OFF, mais jamais commit par commit dans le désordre.

## 3. Les trois blocages

### 3.1 V2-L1 — charge réelle

**Où** ✔
1. `buildRawContext.ts:156-157` lit `getCompletedExecutionsInWindow`.
2. `completedSessionExecutionsRepo.ts:39-42` lit l'événement `completed` et `decisions.daily_plan.final_session`, c'est-à-dire la séance **prescrite**, avec sa durée effective prescrite.
3. `recentSessionsForDailyContext.ts:92` produit `completion_status: "done"`.

Ni `exercise_set_results` ni `session_activity_results` ne sont lus.

**Ce n'est pas un défaut M1** : ce pont est dans `src/supabase/` (adaptateur), pas dans les dossiers gelés.

**Effet réel aujourd'hui** ✔
- `recentLoad` compte `done`, `partial` et `replaced` de la même façon (V0.3_007B), et seulement les séances HEAVY ou MODERATE.
- C3.7 (charge sur 7 jours) est **informatif, sans effet sur la séance** (`domains/training.ts:132`).
- Une séance V2 partielle surestime donc une charge **prudente et informative**, visible dans le suivi et le score de forme.
- **Ce n'est pas un blocage de sécurité.**

**Options, sans toucher M1**

| Option | Effet M1 | Avis |
|---|---|---|
| A. Dans l'adaptateur, une exécution partielle donne `"partial"`, avec la règle PARTIAL-01 côté serveur | aucun (partial = done) | vérité des données ; petit ; à faire avec V2-L2 |
| B. Durée réelle (activité endurance) à la place de la durée prescrite | aucun sur `recentLoad` (la durée n'est pas lue) | utile pour la génération (§ 3.2) |
| C. Ignorer les complétions sans aucun travail | moins de charge comptée, donc moins prudent | inutile une fois la garde POWER posée |
| D. Abaisser `load_profile` sous un taux de réalisation | change `recentLoad` : nouveau modèle de charge | ADR M1, **après les 5 pilotes** |

### 3.2 V2-L2 — résultats réels

**Persistés** ✔
- `exercise_set_results` : `done`, `measure_value`, `load_kg`, `rpe_actual`, `success` (DH), corrections.
- `session_activity_results` : `duration_seconds` réelle, `distance_m`, `rpe_actual`.
- `execution_events` : sans motif d'arrêt.
- Prescription figée.

**Réellement manquant pour un jour V2** ✔
- Ni RPE ni durée de séance pour la Force et le DH.
- Ni fatigue des jambes ou de la préhension après la séance, ni nouvelle douleur, ni résultat technique.
- Raison : le débrief V1 est refusé un jour V2 (409 / NX101 / NX104).

| Consommateur | Source lue | V2 |
|---|---|---|
| M1, charge quotidienne | exécution terminée + séance prescrite | complétion seulement (§ 3.1) |
| M1, contexte de récupération et contexte technique, `n_total_completed_sessions` | `completed_sessions` | **ignoré** |
| Génération (`mapPlanInputRecentHistory`, `blockProgressionV2.ts:128-129`) | `completed_sessions` | **ignoré** (voir les conséquences ci-dessous) |
| Longitudinal (`refresh-longitudinal`), puis Insights | `completed_sessions`, check-ins, décisions | **ignoré**. M1 ne lit pas le longitudinal : effet limité aux Insights |
| Historique web | séries + activités | **exploité**, avec le libellé partiel |
| Branches PHYS seulement | `strengthSetHistoryRepo`, `enduranceActivityHistoryRepo` | exploité pour le guidage **quotidien**, pas pour la génération |

**Conséquences pour la génération**
- `trailingVolumeMinutes` vaut 0 pour un rider entièrement V2. Le seuil est de 180 min (`planDosePolicyV2.ts:114`). **Chaque nouveau programme V2 repart donc en semaine d'introduction.**
- La retenue après séances manquées ne se déclenche jamais en V2, puisqu'une séance V2 non faite ne laisse aucune ligne. C'est **moins prudent**.

**Classement**
- **V2-L2a (génération)** : bloquant pour la bêta payante.
  - Correction dans l'adaptateur (`src/supabase/mapping`, non gelé).
  - Elle exige d'abord une **décision de canon** sur ce qu'est une « séance V2 manquée » : un jour d'entraînement décidé et passé, sans exécution terminée, hors REST et hors suspension santé.
- **V2-L2b** (longitudinal, Insights, contextes de récupération et techniques, RPE de séance V2) : **après les 5 pilotes**.

### 3.3 PHYS-03 — POWER

**Garde serveur de complétion : absente** ✔
- La dernière définition de `record_session_execution` (`20261013160000…`, identique sur `main`, `1bf0295` et `91bb721`) contrôle trois cas seulement :
  - `strength_set_required` pour `family = 'strength'` (l. 688-709) ;
  - `dh_pass_required` pour `dh_technical` (l. 671-680) ;
  - `activity_result_required` pour une `activitySelection` (l. 664-667).
- POWER est de famille `power` (`powerPrescriptionV2.ts:115-116`). **Une séance POWER peut donc être terminée côté serveur avec zéro série.**
- Seul le web l'empêche (`canComplete: recorded > 0`). Le rapport PHYS-03 le dit lui-même (l. 14 et 120).
- Effet : M1 compte une POWER MODERATE faite. L'Historique, grâce à PARTIAL-01, dirait « partiellement réalisée ».
- Mobilité et récupération : pas de résultat exigé, par conception.

**Protections déjà présentes** ✔
- **Santé** :
  - `execution_health_block`, indépendant de la famille, s'applique au démarrage, à la reprise, à la fin, aux séries et aux activités ;
  - A6 (douleur ≥ 6/10) et A7 (signal ouvert) donnent REST dans M1.
- **Fatigue** :
  - `powerFatigueGate` bloque sur C3.6 (jambes) et C3.5 (préhension) : aucune séance prescrite (`V2_POWER_FATIGUE_HOLD`), et le serveur refuse de l'exécuter (`not_executable`) ;
  - M1 abaisse POWER en LIGHT sur C3.3, MENTAL_RED ou une douleur hors sécurité, ce qui la bloque (`power_load_not_supported`).
- **Progression** :
  - aucune augmentation automatique : séries au minimum du catalogue, sans charge ;
  - semaines de construction seulement, jamais le lendemain d'une séance de développement **prévue** ;
  - débutants exclus.

**Lacunes**
- La séance réellement faite la veille n'est pas relue.
- C3.7 ne bloque pas.
- Une douleur dans une zone non classée laisse POWER inchangé, comme pour la Force.
- ⚠ Un débrief V1 pourrait-il enregistrer POWER comme fait un jour de maintien ? À tester.

**Correction proposée**
- Une **migration additive** qui redéfinit `record_session_execution` à partir de sa dernière définition et étend F-6C à `family in ('strength','power')`.
- Elle **réutilise le code `strength_set_required`** : aucune fonction Edge ni aucun web à changer. ⚠ La couverture de ce code par le message web est à confirmer.
- Script de retour arrière, contre-preuve, et empreintes des gardes P0-3 et INT-01 inchangées.

## 4. Risques et protections

| Risque | Protection existante | Écart |
|---|---|---|
| Activation V2 accidentelle | valeur exacte `true` + affectation ; A09 refuse plutôt que de servir V1 | état réel des affectations non connu (inventaire § 6) |
| PHYS actif sans flag | flags « `true` exact », génération seulement | **01.1 et le guidage d'endurance ne dépendent d'aucun flag** : dès le déploiement de `daily-run`, ils agissent sur tout programme V2 courant |
| Impossibilité de revenir en arrière | requêtes SQL de précondition de retour arrière, par niveau | dès qu'un programme contient intervalles, POWER ou mobilité, plus de retour sous ce niveau. Garder les flags OFF jusqu'à validation |
| Compatibilité de retour arrière | prouvée contre D | ⚠ à reprouver contre la production actuelle (D′ + CONSISTENCY + PARTIAL) |
| Santé | gardes indépendantes de la famille, A6 / A7 | zones de douleur non classées (comportement M1 existant) |
| Complétion POWER vide | web seulement | garde serveur à poser (§ 3.3) |
| Progression V2 | — | introduction répétée, aucune retenue après séances manquées (§ 3.2) |
| Contenu sportif | PROVISIONAL, signalé | 275 entrées + paramètres PHYS à faire valider par un préparateur qualifié |
| Canon | propositions non appliquées | levée de `docs/03` §7 / §10 (progression sur la performance réelle), **préalable à PHYS-01.1 lui-même** ; exception aux intervalles (UX-11A.5a.3 §5) ; branche POWER de M1 (F.4.3) : décisions HPM |

## 5. Ordre d'intégration recommandé

Petits tickets, chacun avec sa condition STOP. Aucune réécriture : V2 et PHYS sont réutilisables tels quels.

| # | Ticket | Contenu | STOP si |
|---|---|---|---|
| 0 | **V2-INV-01** (lecture seule, Louis) | requête du § 6 dans le SQL Editor | un programme V2 courant ou une affectation V2 appartient à un rider réel non interne : décision HPM avant tout déploiement de `daily-run` |
| 1 | **INT-PHYS-01** (local) | branche d'intégration = `863f3fb` + pile PHYS ; résoudre le seul conflit (`docs/11`) ; suites complètes (web, head-coach, planning, intégrations à 75 migrations, graphes Edge) ; tests de compatibilité rejoués **contre la production actuelle** ; test PARTIAL-01 sur POWER | une régression, ou une compatibilité de retour arrière en échec |
| 2 | **POWER-GUARD-01** | migration additive (§ 3.3) + retour arrière + tests ; inoffensive tant qu'aucune séance POWER n'existe | une empreinte de garde P0-3 ou INT-01 change |
| 3 | **V2-L2A-01** | proposition de canon sur la « séance V2 manquée » (docs d'abord), puis adaptateur de l'historique récent pour la génération ; l'option A de V2-L1 dans la même passe (même lecture serveur) | canon non validé |
| 4 | Décisions HPM | diffs de canon : `docs/03` §7 / §10 (préalable à la release de PHYS-01.1), exception aux intervalles, branche POWER de M1 ; liste des PHYS essentiels pour la bêta | un diff de canon refusé : retirer de la release la partie concernée |
| 5 | Validation sportive | préparateur qualifié : doses PHYS-01.1, 02 et 03 ; 275 entrées du catalogue ; textes P0-2 | contenu refusé |
| 6 | **Release PHYS, flags OFF** | SQL (garde POWER) → `daily-run` → `generate-training-plan` → web, avec précontrôles et post-contrôles habituels ; générations identiques flags OFF | inventaire non conforme, graphes inattendus, 5xx |
| 7 | Essais internes | compte de simulation : affecter V2, interrupteur `true` pour une génération, contrôle, retour à `false` (procédure documentée) ; puis un flag PHYS à la fois (intervalles → POWER → mobilité), en vérifiant les préconditions de retour arrière | un échec, ou un retour arrière devenu impossible sans décision |
| 8 | **Bêta, 5 pilotes payants** | V2 + PHYS-01.1 + PHYS-02 (+ PHYS-03 si validé) ; affectation manuelle par rider, sans A12 | — |

**Peut attendre après les 5 premiers pilotes**
- V2-L2b : longitudinal et Insights, contextes de récupération et techniques.
- Pondération M1 des séances partielles (V2-L1 D).
- RPE et ressenti de séance en V2.
- PHYS-04 : mobilité et poids du corps (variantes de catalogue manquantes), sauf si le HPM la juge essentielle.
- Résultats par répétition des intervalles.
- POWER : relecture de la séance de la veille, blocage sur C3.7.
- A12 (affectation automatique).
- Mise à jour du tableau des constats produit et des incohérences documentaires.

## 6. Première action concrète proposée

**V2-INV-01**, à lancer avant tout le reste. C'est une requête en lecture seule, déjà écrite et validée sur une pile locale au schéma de production : [`V2_PHYS_READINESS_01_INVENTORY_READONLY.sql`](V2_PHYS_READINESS_01_INVENTORY_READONLY.sql).
- Une seule instruction.
- Comptages et dates seulement, aucun identifiant.
- Elle donne : affectations V1 et V2, programmes courants V1 et V2, exécutions terminées, arrêtées et ouvertes, dernières dates.

Puis **INT-PHYS-01** en local, sans déploiement. C'est le seul moyen d'établir les deux points encore non vérifiés : la compatibilité de la combinaison, et le retour arrière vers la production actuelle.

---

Documentation de statut mise à jour localement : PARTIAL-01 CLOSED en production (`docs/00`, `docs/12`). Rien n'est poussé.

**STOP. Décision HPM attendue.**
