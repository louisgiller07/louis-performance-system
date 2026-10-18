# V2_L2_01A_REPORT — adaptateur de génération V2 : historique V2

**Date** : 2026-10-18 · **Pour** : HPM et Louis · **Statut** : local uniquement.

Rien n'a été touché hors du poste local :
- aucun push, aucune migration, aucun déploiement ;
- aucun flag activé ailleurs que sur la pile locale de test (`NALYNT_V2_L2_HISTORY_ENABLED` absent par défaut).

**Verdict : READY LOCAL.** Branche `int/v2-phys-integration-01`, au-dessus du rapport de contrat `05fe664` et du canon `d91dbaf`. SHA final au § 9.

## 1. Résolution des trois ambiguïtés (preuves de code)

Aucune n'empêchait une implémentation sûre : pas de STOP.

### 1.1 Santé historique : ce qui est réellement prouvé

| Source | Ce qu'elle prouve | Limite |
|---|---|---|
| `daily_checkins` (un par jour, `unique (athlete_id, checkin_date)`) | `pain`, `fever_or_illness`, `suspected_concussion` déclarés explicitement | modifiable : c'est la valeur au moment de la génération qui est lue |
| `decisions` (ajout seul) | la décision du jour, la séance due (`final_session.kind`) et les règles de sécurité déclenchées (`triggered_rules[].layer = "A"`) de **chaque** décision du jour | une décision antérieure à M2 n'a pas de `daily_plan` : rien n'est vérifiable |
| `health_flags` | `flag_date` = date de la décision qui l'a créé (RPC de persistance) ; `resolved_at` = `zurichToday()` du serveur à la clôture (`health-flag-resolution`), **impossible à antidater** ; un seul signal ouvert par type ; `monitoring` jamais écrit | pas d'historique des statuts : la couverture est approchée par `[flag_date, resolved_at]` |
| `completed_sessions` | `change_reason` (motif déclaré) et `new_pain` du débrief | le motif est déclaratif |

Règle retenue : une séance n'est **manquée** que si toutes ces preuves existent. Une donnée absente, inconnue ou non vérifiable ne vaut jamais « pas de problème de santé » : le jour n'est simplement pas compté.

### 1.2 Priorité des données (un fait par jour)

Elle repose sur des invariants serveur existants, vérifiés dans le code :

| Invariant | Effet |
|---|---|
| `unique_completed_per_day` | au plus un débrief V1 par jour |
| F-6B (`record_session_execution`) | une séance guidée ne démarre pas si un débrief V1 non `skipped` existe (`session_already_completed`) ; une séance principale par jour |
| NX101 / NX104 (`persist_completed_session`, `20261013190000`) | un débrief V1 est refusé si une exécution V2 est ouverte ou terminée, ou si une exécution arrêtée a des résultats |
| `skipped` V1 | il permet encore un démarrage guidé ensuite |

D'où l'ordre : débrief V1 réalisé, sinon exécution guidée terminée, sinon débrief V1 `skipped`, sinon rien. Une séance terminée n'est donc jamais classée manquée, et un jour n'est jamais compté deux fois.

Durée créditée : celle de **la décision de l'exécution** (`session_executions.decision_id`), jamais la dernière décision du jour par défaut. `planned_sessions`, modifiable, n'est pas lu. Les décisions et les prescriptions finales sont figées : un changement de programme ne réécrit rien.

### 1.3 Fenêtre de 8 jours

- `[today − 7, today]`, bornes incluses : la même que `getRecentSessions` (`recentLoadWindowStart`, `PROVISIONAL_THRESHOLDS.recentLoad.windowDays = 7`).
- `today` = `productToday()` du serveur (Europe/Zurich), jamais une date du client.
- Un jour n'est manqué que si `D < today` : le jour courant n'est pas terminé.
- Toute date postérieure à `today` est ignorée, y compris les dates futures d'une simulation.

## 2. Contrat retenu

Le canon `docs/05_DATA_MODEL.md` (« Historique de la génération V2 », commit `d91dbaf`, écrit **avant** le code) est appliqué tel quel. Trois points d'interprétation, tous dans le sens de la prudence :

1. **Décision antérieure à M2 le même jour** (sans `daily_plan`) : ses règles ne sont pas vérifiables, donc le jour n'est pas compté comme manqué.
2. **Réalisation complète** : mêmes règles que PARTIAL-01 côté web.
   - Force : `family = strength` et `sessionKind` `STRENGTH_LOWER` ou `STRENGTH_UPPER` ; chaque série de travail prévue (`main` / `complementary`) a un résultat actif réalisé.
   - DH : exactement un drill principal, de mesure `pass`, chaque passage enregistré.
   - Deux résultats actifs pour un même créneau : non qualifiable, 0 minute.
3. **Signaux de santé** : tous les signaux jusqu'à `today` sont lus, sans filtre d'âge. Un signal clos sans `resolved_at`, ou aux dates incohérentes, couvre toute la fenêtre ; aucun filtre de date ne peut le savoir d'avance.

Seuils inchangés : 180 min sur 8 jours et 2 séances manquées, **PROVISIONAL**. Ils sont **non validés pour une activation commerciale**.

## 3. Fichiers et flags

| Fichier | Rôle |
|---|---|
| `head-coach-engine/src/supabase/repositories/planHistoryV2Repo.ts` (nouveau) | lectures groupées par table : débriefs V1, exécutions et événements, décisions (projection de `daily_plan`), prescriptions finales, séries, activités, check-ins, signaux de santé. Filtre `athlete_id` explicite, plafond 1000 lignes. Une erreur ou le plafond atteint lève une exception |
| `head-coach-engine/src/supabase/mapping/planHistoryV2.ts` (nouveau) | mappeur pur : un fait par jour, volume, preuve de séance manquée, règle de réalisation |
| `head-coach-engine/src/supabase/buildPlanInputSnapshotV2.ts` | option `v2History` : remplace `trailingVolumeMinutes` et `recentMissedOrReplacedCount`, rien d'autre (ordre des clés et `recentSessionKinds` conservés). Sans l'option, retour identique |
| `head-coach-engine/src/generation/v2/generateAndPersistTrainingPlanV2.ts` | `v2History?: boolean` ; sans l'option, l'appel du snapshot est exactement celui d'avant (4 arguments) |
| `head-coach-engine/src/generation/generateTrainingPlanForAthlete.ts` | transmet `v2History` au chemin V2 seulement |
| `head-coach-engine/src/generation/planHistoryRolloutV2.ts` (nouveau) | constante `V2_L2_HISTORY_FLAG` (module propre à la génération, hors du graphe de `daily-run`) |
| `head-coach-engine/src/edge/generateTrainingPlanEdgeEntry.ts` | exporte la constante dans le bundle |
| `supabase/functions/generate-training-plan/index.ts` | `readV2HistoryFlag` (secret Edge lu côté serveur) ; `v2History` seulement si la valeur est exactement `"true"` |

**Flag `NALYNT_V2_L2_HISTORY_ENABLED`** :
- même analyse que les autres flags : seule la valeur exacte `"true"` l'active ;
- génération V2 seulement : le snapshot V1, `daily-run` et le web ne le lisent jamais ;
- **inchangés** : M1, le planificateur et ses seuils, V2-L1, POWER, les modules PHYS, le longitudinal, les Insights. Aucune migration.

## 4. Reproductions avant / après (pile locale, chemins réels)

Chemin réel de bout en bout :
- plan A généré puis accepté ;
- `runDailyFor` (M1, réconciliation, `persist_daily_run_v2`) ;
- séances guidées via `record_session_execution` ;
- débriefs V1 via `persist_completed_session` ;
- puis plan B, 3 semaines, généré le 2026-10-17 (fenêtre du 10-10 au 10-17).

Avant = flag OFF (la production). Après = flag ON.

| # | Historique des 8 jours | Avant (OFF) | Après (ON) |
|---|---|---|---|
| 1 | rien | introduction → build → build_plus | **identique**, même empreinte de snapshot |
| 2 / 9 | DH 90 complète, Force 60 complète, endurance 52 min 30 s | 0 min → **introduction** (Force LIGHT 45, DH LIGHT 75 / 5 passages) | **202 min** → **build** (`recent_training_history`) → build_plus → consolidation ; Force MODERATE 60, DH MODERATE 90 / 6 passages |
| 3 | les mêmes, Force et DH partielles | 0 min → introduction | 52 min (partielles à 0) → introduction ; 0 manquée ; même plan |
| 4 | 202 min + « Non réalisée » `time_life` et `motivation` des jours dus | 0 min, 2 → introduction, build, build **retenu** en semaine 3 | 202 min, 2 → build, build **retenu** (`recent_missed_sessions_hold`), consolidation |
| 5 | séance arrêtée ; « Non réalisée » pour douleur (`new_pain`), sous check-in douloureux, pour `fatigue_control`, un jour de REST de sécurité (fièvre, signal ouvert) | **4 manquées** → retenue en semaine 3 (santé comptée comme un manque) | **0 manquée**, 0 min → introduction, build, build_plus ; aucune retenue |
| 6 | DH 90 du plan A, puis plan A2 accepté (Force 45 du 10-15), puis une séance manuelle de Force | 0 min | chaque jour compté une fois, avec sa propre décision : 90 + 45 + Force manuelle → build |
| — | plusieurs décisions dans une journée : séance démarrée sur D1 (Force 60) puis D2 (45 min disponibles) ; le lendemain, séance faite sur D2 (45) ; un jour d'entraînement puis REST de sécurité avec « Non réalisée » | — | 60 (la décision exécutée, pas la dernière) + 45 ; le jour devenu REST n'est pas manqué (`no_training_due`) |
| 7 | 202 min + une course le 2026-11-07 | race_specific → taper → race | **identique** (rôles de course inchangés) |
| 8 | jours décidés sans fait, séance ouverte, faits datés après `today` | introduction | **identique**, même empreinte |
| 10 | rider V1 avec débriefs | snapshot V1 | **identique octet pour octet**, même empreinte, flag ON ou OFF |
| 11 | même état, ON deux fois | — | même snapshot, même empreinte, même plan |
| 12 | lecture de `session_executions` en échec | génération normale (elle ne lit pas cette table) | **génération refusée**, aucune version persistée |

Edge réel (`generate-training-plan`, JWT du rider, `productToday()` du serveur), rider V2 avec au moins 180 min guidées dans la fenêtre :
- secret absent : semaine 1 `introduction`, 0 min dans le snapshot ;
- secret `"true"` : semaine 1 `build` (`recent_training_history`), minutes exactes dans le snapshot.

## 5. Comparaison OFF / ON

- **OFF = production, prouvé** :
  - test différentiel contre le runtime réel de `863f3fb` (`PHYS011_PREVIOUS_RUNTIME_ROOT`). Sur un rider à historique riche, le snapshot (JSON identique), l'empreinte, les séances et les semaines sont identiques ;
  - test unitaire : OFF (option absente, `{}`, `false`) donne le snapshot historique octet pour octet, et l'historique V2 n'est jamais lu ;
  - test unitaire : sans flag, `buildPlanInputSnapshotV2` est appelé avec exactement les 4 arguments d'avant.
- **ON** :
  - seuls `trailingVolumeMinutes` et `recentMissedOrReplacedCount` du snapshot V2 changent ;
  - le reste du snapshot, l'ordre des clés et `recentSessionKinds` sont identiques.
- **Graphes Edge** : seul celui de `generate-training-plan` change (bundle et `index.ts`). `daily-run` et les autres fonctions sont inchangés.
  - Le premier jet plaçait la constante du flag dans `planningModelRollout.ts`, qui fait partie du graphe de `daily-run` : déplacée dans un module propre à la génération (§ 3).

## 6. Tests

| Suite | Résultat |
|---|---|
| Unitaires nouveaux (mappeur, repository, snapshot, flag) | 47/47 (mappeur 24, repository 16, snapshot 4, flag 3) |
| Intégration V2-L2-01a (pile locale, chemins réels, 12 scénarios + plusieurs décisions + OFF = production) | 13/13 |
| Edge HTTP, secret servi absent puis `"true"` | 1/1 + 1/1 |
| head-coach complet (pile locale à 76 migrations, Edge servies, flags de production) | **1648/1648** (170 fichiers). Passage complet : 1644. Les 4 échecs restants (3 fichiers sans lien : `daily-run`, `completed-session`, `accept-training-plan` en 502, un verrou temporisé) venaient d'une surcharge locale pendant le passage ; ils passent au rejeu, 19/19 |
| TypeScript head-coach | mêmes 27 erreurs préexistantes qu'en `863f3fb` (seuls les chemins absolus diffèrent) |

## 7. Risques sportifs

1. **Hausse de dose au programme suivant.** Un rider V2 actif commence en `build` : Force MODERATE 60 au lieu de LIGHT 45, DH 6 passages au lieu de 5.
   - Le seuil de 180 min sur 8 jours est PROVISIONAL, calibré sur des débriefs V1. Deux DH de 90 suffisent à l'atteindre.
   - **À valider pour la fréquence V2 avant toute activation commerciale.**
2. **Durée de Force et de DH approchée.** Elle n'est pas mesurée : c'est la durée décidée d'une séance entièrement réalisée.
3. **Endurance** : la durée enregistrée est comptée, même au-delà de la durée prescrite. Une sortie de 3 h suffit seule à atteindre le seuil, comme un débrief V1 aujourd'hui.
4. **Séances partielles à 0 minute (P0, provisoire)** : un rider qui ne termine jamais ses séances reste en introduction. C'est prudent, peut-être trop. L'option P1 est au backlog.
5. **Moins de retenues qu'avant.** La manquée V2 exige des preuves. Cas concret : un rider sans check-in qui saute des séances après 180 min réalisées n'aura pas de retenue en semaine 2.
   - Avant, ce rider V2 avait 0 min et repartait de toute façon en introduction.
   - Les jours de santé ne sont ni volume ni manque : après une maladie, le volume faible ramène à l'introduction.
6. **Inchangé** : la progression de cycle repart à 0 à chaque programme. M1 garde ses protections quotidiennes (A6, A7, REST de sécurité).

## 8. Risques de release et retour arrière

- **Livraison** :
  - Edge `generate-training-plan` seule : bundle et `index.ts` ;
  - aucune migration, aucun changement web ; `daily-run` a un graphe identique.
  - Déployée flag absent, elle se comporte comme la production (prouvé au § 5).
- **Activation** : ajouter le secret `NALYNT_V2_L2_HISTORY_ENABLED=true`, sur décision HPM après validation sportive.
- **Retour arrière** :
  - retirer le secret : effet à la requête suivante, sans redéploiement ;
  - ou redéployer l'Edge précédente.
  - Les plans déjà générés ON restent tels qu'ils ont été persistés : snapshot figé, motif `recent_training_history` visible dans les semaines.
- **Traçabilité** : le snapshot ne dit pas quelle source a produit l'historique. Le motif des semaines et la date de génération permettent de le retrouver. Ajouter un marqueur modifierait le type du planificateur ; c'est hors périmètre.
- **Rejeu** : une même `generationRequestId` rejouée après un changement du flag donne une autre empreinte de snapshot. La RPC refuse ce rejeu. Le cas est limite : un nouveau clic crée un nouvel identifiant.
- **Nouveau mode d'échec (ON seulement)** : une lecture en échec ou au plafond refuse la génération.
  - Réponse Edge 500 `internal_error`, événement pilote `plan_generation_failed`.
  - C'est voulu : jamais un historique silencieusement vide.
  - Le plafond de 1000 signaux de santé par athlète est irréaliste, mais il refuserait la génération.
- **Charge** : 5 lectures en parallèle, puis au plus 4, toutes bornées à la fenêtre (sauf les signaux de santé).

**Diffs canon proposés, non appliqués** (`docs/10` ne se modifie pas sans accord) :

```diff
+### T65. V2-L2-01a — historique V2 de la génération (HPM 2026-10-18)
+- Unitaires (`tests/supabase/mapping/planHistoryV2.test.ts`, `planHistoryV2Repo.test.ts`,
+  `buildPlanInputSnapshotV2.history.test.ts`, `tests/generation/v2HistoryFlag.test.ts`) : fenêtre, un fait par jour,
+  202 min exactes, partielles à 0, puissance / mobilité / récupération à 0, chaque preuve de séance manquée, plusieurs
+  décisions, signaux de santé, déterminisme ; lectures filtrées, refus sur erreur ou plafond ; OFF = snapshot historique.
+- Intégration locale (`tests/supabase/v2L2History.integration.test.ts`) : scénarios 1 à 12 du rapport V2-L2-01 sur
+  les chemins réels, rôles et doses du plan généré, OFF comparé au runtime de production.
+- Edge (`tests/supabase/v2L2HistoryEdge.integration.test.ts`) : secret absent → introduction ; `"true"` → build.
```

`docs/04` ne mentionne pas `recentMissedOrReplacedCount` : rien à y changer. Son sens V2 est dans `docs/05`.

## 9. Commit local

Branche `int/v2-phys-integration-01`. Commit unique au-dessus de `d91dbaf` ; SHA donné à la livraison (un commit ne peut pas contenir son propre SHA). Aucun push.

## 10. Verdict

**READY LOCAL.** L'activation reste soumise à la validation sportive du seuil de 180 min pour la fréquence V2.

**STOP. Décision HPM attendue.**
