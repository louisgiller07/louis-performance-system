# V2_L2_01_CONTRACT_REPORT — continuité du coaching V2 (historique pour la génération)

**Date** : 2026-10-18 · **Pour** : HPM et Louis · **Nature** : investigation et proposition de contrat.

Rien n'a été touché :
- aucun code applicatif, aucune migration, aucun push, aucune opération en production ;
- canon non modifié.

**Référence** : candidat `b5230d5` ; production `863f3fb`, SQL 75.

**Légende** : ✔ vérifié dans le code · ⚠ non établi (demanderait une requête de données ou la configuration de production).

---

## 1. Cause racine et flux de données

**Flux actuel de la génération** ✔

1. `generate-training-plan` reçoit `today = productToday()` (Europe/Zurich).
2. `buildPlanInputSnapshotV2` appelle `buildPlanInputSnapshot`, le même que pour V1 (`buildPlanInputSnapshotV2.ts:58`).
3. `getRecentSessions(today)` lit **`completed_sessions` seulement**, sur `[today−7, today]` : 8 jours calendaires, bornes incluses. La fenêtre de 7 jours vient de `PROVISIONAL_THRESHOLDS.recentLoad`.
4. `mapPlanInputRecentHistory` (`mapping/mapPlanInputRecentHistory.ts:48-61`) produit trois valeurs :
   - `trailingVolumeMinutes` : somme de `actual_duration_min` ;
   - `recentMissedOrReplacedCount` : nombre de lignes `skipped` **ou `replaced`** ;
   - `recentSessionKinds` : sans aucun consommateur.
5. `blockProgressionV2.ts:148-149` est le seul lecteur :
   - `trailingVolumeMinutes ≥ 180` (`PLAN_RECENT_TRAINING_MINUTES_V2`) → pas de semaine d'introduction ;
   - `recentMissedOrReplacedCount ≥ 2` (`PLAN_MISSED_SESSIONS_HOLD_V2`) → le premier `build_plus` du cycle 0 redescend en `build`.

**Cause racine** : aucun chemin de code ne lit les exécutions V2 pour la génération. Le contrat du type le dit (« Derived from `completed_sessions` history », `planning-engine/src/types/planInputSnapshot.ts:74-78`). La limite est notée, non décidée, dans l'ADR UX-11B.2.4 (`docs/11:4508`) et dans PARTIAL-01-L2.

Or une séance guidée n'a **jamais** de débrief V1 : NX101 si l'exécution est ouverte ou terminée, NX104 si elle a été arrêtée avec des résultats. Tout ce qu'un rider V2 réalise en séance guidée est donc invisible pour la génération.

**Ce que l'historique influence vraiment, et ce qu'il n'influence pas** ✔

| Décision de planification | Entrée d'historique | Rider entièrement V2, aujourd'hui |
|---|---|---|
| Semaine 1 : introduction ou `build` | minutes réalisées sur 8 jours ≥ 180 | **toujours une introduction**, à chaque nouveau programme |
| Retenue du premier `build_plus` | ≥ 2 « manquées ou remplacées » | jamais déclenchée par une séance guidée |
| Progression entre cycles (DH +1 passage, endurance +15 min) | aucune (cycle 0 au départ de chaque programme) | inchangé ; pas de continuité entre programmes, pour **tous** les riders |
| Rôles course, affûtage, spécifique, reprise après course | aucune | inchangés |
| Placement des intervalles, POWER, mobilité (PHYS) | indirect, par le rôle de semaine | suit la séquence d'un rider « sans historique » |
| Fatigue | aucune : la génération n'a pas d'adaptation à la fatigue | M1 la gère au quotidien (inchangé) |
| `HistoryAdjuster` (V1) | — | jamais appliqué en V2 |

**Conséquence** : V2-L2 porte en pratique sur **deux décisions**, la semaine d'introduction et la retenue après séances manquées. La continuité de progression entre deux programmes est une **fonctionnalité absente du moteur**, pour V1 comme pour V2. Ce n'est pas une conséquence de L2 (§ 5, ticket séparé).

## 2. Sources de vérité

| Fait | Source de vérité ✔ | Limites |
|---|---|---|
| Séance prescrite et acceptée | `training_plan_versions` (`'v2'`), `training_plan_generated_sessions`, `training_plan_planned_prescriptions`, transitions (`accepted` / `superseded`), `training_plan_current_version` ; projection dans `planned_sessions` (`source`, lignage) | `planned_sessions` est modifiable et sans historique ; `base_version_id` toujours NULL |
| Décision du jour | dernière ligne `decisions` du jour (`created_at desc, id desc`) : `daily_plan.decision`, `final_session` (durée effective A07), `triggered_rules`, `final_prescription_status` | plusieurs décisions par jour ; `daily_decision_currency` évalue la décision *maintenant*, ce n'est pas un instantané historique |
| Réalisée | `execution_events` `completed` + `exercise_set_results` / `session_activity_results` actifs | minimum serveur seulement (une série ou un passage ; une activité) |
| Partielle | **aucun marqueur serveur** ; déduite de la prescription figée et des résultats actifs (règle PARTIAL-01, `guidedRealisation.ts`) | Force, POWER et DH seulement ; endurance, récupération, mobilité non qualifiables |
| Arrêtée | événement `abandoned` | **aucun motif enregistré** |
| Ouverte, jamais terminée | pas d'événement terminal | aucune clôture automatique |
| Non commencée | décision `created`, aucune exécution ce jour | pas de fuseau par rider : convention Zurich ; dates fournies par le navigateur |
| Modifiée ou remplacée | `daily_plan.decision` MODIFY / REPLACE ; `active_session_origin` (`manual_override_*`) ; `planned_sessions.source='manual'` ; débrief V1 `replaced` / `partial` + `change_reason` | lignes manuelles et débriefs V1 écrasés sur place |
| Repos | **absence** de séance générée (aucun REST dans un plan V2) ; décision REST `not_required` | un repos prévu ne se voit que par absence |
| Empêchée par la santé | REST de sécurité (règle de couche A) ; `health_flags` (`flag_date` = premier jour, `resolved_at`) ; débrief V1 `skipped` motif `pain` | les refus de la garde santé des séances guidées ne sont **pas** persistés ; statut des signaux mis à jour sur place |
| Non réalisée, déclarée | débrief V1 `skipped` + `change_reason` (motifs : `coach_criterion`, `fatigue_control`, `pain`, `mechanical`, `weather_terrain`, `time_life`, `motivation`, `activity_change`, `other`) | **possible un jour V2** sans exécution, ou après un arrêt sans résultat (le web le propose) |
| Changements de programme | chaîne des versions et dates des transitions | le « aujourd'hui » de l'acceptation et le détail de la projection ne sont pas stockés |

## 3. Proposition de contrat V2-L2

**Principe** : la forme de l'entrée du planificateur (`PlanInputRecentHistory`, 3 champs), ses seuils et M1 restent inchangés. **Seul l'adaptateur V2 change** : la manière de remplir ces champs à partir des faits persistés.

### 3.1 Un jour, un fait (fenêtre `[today−7, today]`, dates telles qu'enregistrées)

Pour chaque jour, on retient **un seul** fait, dans cet ordre de priorité (celui de `dayCompletion` et du verrou d'une séance principale par jour) :

1. débrief V1 `done`, `partial` ou `replaced` → **réalisée (déclarée)** ;
2. exécution V2 `completed` → **réalisée (guidée)**, qualifiée « complète », « partielle » ou « non qualifiable » ;
3. débrief V1 `skipped` → **non réalisée, déclarée** (motif) ;
4. exécution `abandoned`, sans `completed` ce jour → **arrêtée** ;
5. séance due sans aucun fait (§ 3.3) → **non enregistrée** ;
6. sinon → **aucune séance due** : repos, rien de prévu, ou jour hors de tout programme.

Une exécution ouverte compte comme « aucun fait ». Les dates postérieures à `today` sont ignorées.

### 3.2 Volume réalisé (`trailingVolumeMinutes`) — rien d'inventé

| Fait du jour | Minutes comptées |
|---|---|
| Débrief V1 réalisé | `actual_duration_min` déclarée (comme aujourd'hui) |
| Endurance guidée terminée | `duration_seconds` réelle de l'activité active, arrondie à la minute inférieure |
| Force, POWER ou DH guidée **complète** (toutes les séries de travail ou tous les passages prévus) | la durée effective décidée (`final_session.duration_min` de sa décision). Toute la séance prescrite a été faite |
| Force, POWER ou DH guidée **partielle** | **0** (option recommandée, voir les options ci-dessous) |
| Récupération ou mobilité terminée ; réalisation non qualifiable ; arrêtée ; non enregistrée ; non réalisée | 0 |

Options pour la séance partielle (**décision HPM**) :
- **P0, recommandée** : 0 minute. On ne compte que ce qui est prouvé. Effet prudent : moins de minutes, donc plus souvent une introduction.
- **P1** : part réalisée × durée décidée. C'est une estimation, qui exige une validation sportive.

### 3.3 Séance due

Un jour `D < today` a une séance due si sa dernière décision a une `final_session` d'entraînement (ni REST, ni RACE). Un jour **sans décision n'a jamais de séance due** : sans check-in ni analyse ce jour-là, rien ne prouve ce qui était attendu.

### 3.4 Définition canonique proposée de la « séance V2 manquée »

> Un jour `D` de la fenêtre, **strictement avant le jour de génération**, est une **séance V2 manquée** si et seulement si :
> - (a) une séance d'entraînement était due (§ 3.3) ;
> - (b) le fait du jour est un **débrief V1 `skipped`** ;
> - (c) son motif n'est **ni santé ni prudence** (`pain`, `fatigue_control`), **ni décision du coach** (`coach_criterion`) ;
> - (d) aucun signal de santé n'était ouvert ce jour-là (`flag_date ≤ D` et `resolved_at` absent ou postérieur à `D`, types `injury_suspect`, `illness`, `pain_persistent`, `concussion_suspect`) ;
> - (e) la décision du jour n'était pas un REST de sécurité.

Ce qui en découle :
- **Jamais manquées** : une séance non enregistrée (l'absence de résultat ne vaut pas manque), une séance arrêtée, une séance partielle, un jour de repos, un jour sans décision, un REST décidé, un remplacement volontaire (`replaced`, comptée comme réalisée), un jour empêché par la santé.
- **`recentMissedOrReplacedCount` (V2)** = nombre de séances V2 manquées. Le nom du champ reste celui du moteur ; son sens V2 est documenté. Un remplacement n'y entre plus.
- **Santé** : jamais assimilée à un manque de motivation. Les jours empêchés par la santé ne comptent ni comme manque ni comme volume. Après une interruption, un volume faible mène donc naturellement à une introduction, ce qui est prudent.

### 3.5 Informations insuffisantes : comportement prudent

| Cas | Comportement |
|---|---|
| Aucun fait dans la fenêtre | identique à aujourd'hui : introduction, aucune retenue |
| Réalisation non qualifiable (prescription non décodable, résultats ambigus) | 0 minute, pas de manque |
| Durée décidée absente | 0 minute |
| Exécution ouverte depuis des jours | aucun fait |
| Dates futures (horloge de simulation) | ignorées |
| Lecture des exécutions en échec | **génération refusée** (comme pour les débriefs V1 aujourd'hui), jamais un historique silencieusement vide qui donnerait une autre progression |

### 3.6 Non modifiés

- Résultats persistés (lecture seule) ; M1 ; seuils PROVISIONAL ; rôles liés aux courses.
- **V1** : le snapshot V1 garde exactement sa règle actuelle, `replaced` compris. Le contrat ne s'applique qu'à la génération V2.

## 4. Exemples avant / après (rider V2, génération le lundi 2026-11-02)

| Historique des 8 jours | Avant | Après (P0) |
|---|---|---|
| Rien | introduction | introduction (inchangé) |
| Force 60 complète, DH 90 complète, endurance 52 min réelle | 0 min → **introduction** (Force LIGHT 45, DH 5 passages) | 202 min → **`build`**, motif `recent_training_history` (Force MODERATE 60, DH 6 passages) |
| Les mêmes, Force et DH partielles | 0 min → introduction | 52 min → introduction ; pas de retenue (une séance partielle n'est pas manquée) |
| 202 min, plus 2 « Non réalisée » (`time_life`, `motivation`) un jour dû | `build`… `build_plus` libre | `build`, puis `build_plus` **retenu** en `build` (`recent_missed_sessions_hold`) |
| 2 « Non réalisée » (`pain`), ou pendant un signal ouvert, ou un jour de REST de sécurité | 2 → retenue (santé assimilée à un manque) | 0 manquée ; volume faible → introduction (prudence, sans étiquette de manque) |
| 1 débrief `replaced` (40 min déclarées) + 150 min guidées complètes | 1 « manquée » ; volume 40 | 190 min → `build` ; 0 manquée |
| 3 jours décidés sans exécution ni débrief | 0 / 0 | 0 / 0 (non enregistrées, jamais manquées) |

## 5. Changements techniques nécessaires (premier ticket, sans planning-engine, sans M1, sans migration)

1. **Lecture groupée** (`head-coach-engine/src/supabase/repositories/`, adaptateur non gelé), une requête par table et sans N+1, sur la fenêtre :
   - exécutions de la fenêtre avec leurs événements, `decision_id`, `final_prescription_id` ;
   - `decisions.daily_plan` (décision, `final_session`, `triggered_rules`) de la dernière décision de chaque jour ;
   - prescriptions finales (structure) ;
   - séries actives ;
   - activités actives ;
   - signaux de santé.
   La logique de complétion reprend celle de `strengthSetHistoryRepo` / `enduranceActivityHistoryRepo` (PHYS).
2. **Règle de réalisation côté serveur** : portage pur de la règle PARTIAL-01 (`strengthProgress` / `dhProgress`) pour Force, POWER et DH.
3. **Mappeur pur** `mapPlanInputRecentHistoryV2(v1Rows, v2Facts, health)`, qui applique le § 3. Le mappeur V1 n'est pas touché.
4. **`buildPlanInputSnapshotV2`** : il utilise le mappeur V2. Le snapshot V1 reste inchangé.
5. **Livraison** : `generate-training-plan` seule. `daily-run` et le web ne changent pas.
6. **Canon** (sur accord HPM, avant le code) :
   - `docs/05` : contrat de l'historique V2 de la génération et définition de la séance manquée ;
   - `docs/04` / doc planification : sens V2 de `recentMissedOrReplacedCount` ;
   - `docs/10` : scénarios du § 8 ;
   - `docs/11` : ADR.

**Hors de ce ticket**
- **Continuité de cycle entre deux programmes**, absente pour tous : c'est une fonctionnalité du planificateur, avec validation sportive. Après les 5 pilotes.
- **Pondération M1 des séances partielles** (V2-L1).
- Longitudinal et Insights (V2-L2b).
- Motif d'arrêt d'une séance guidée : absent du produit ; nouvelle donnée, à décider.

## 6. Conséquences sportives

- **Un rider V2 actif ne repart plus à la semaine d'introduction à chaque programme.** Sa première semaine passe en `build` : Force MODERATE 60 min au lieu de LIGHT 45, DH 6 passages au lieu de 5, endurance MODERATE.
  - C'est une **hausse de dose initiale**. Le seuil de 180 min sur 8 jours est PROVISIONAL et calibré sur des débriefs V1 ; il doit être validé pour la fréquence V2 (3 à 5 séances par semaine).
- **La retenue après séances manquées fonctionne** sur des non-réalisations déclarées sans motif de santé. Un remplacement volontaire ne la déclenche plus.
- **Santé** : jamais comptée comme un manque. La prudence passe par le volume (moins de minutes, introduction), et M1 garde ses protections quotidiennes (A6, A7, REST de sécurité).
- **Séances partielles (P0)** : un rider qui ne termine jamais ses séances reste en introduction. C'est prudent, mais peut-être trop. L'option P1 est à arbitrer avec le préparateur.
- **Inchangé** : la progression de cycle repart à 0 à chaque programme. La continuité reste limitée à « semaine d'introduction ou non ».

## 7. Risques et ambiguïtés

1. **Durée des séances guidées de Force et de DH** : elle n'est pas mesurée (aucune colonne de durée d'exécution). On compte la durée décidée d'une séance complète, une estimation du plan. Les horodatages des événements, fournis par le client, ne sont pas fiables : rejetés.
2. **Dates** : elles viennent de l'horloge du navigateur (simulation possible), sans fuseau par rider. La convention reste Zurich.
3. **Séances faites hors de l'application** : non enregistrées, donc ni volume ni manque. Sous-estimation prudente.
4. **Historique des signaux de santé** : il est approximé par `flag_date` et `resolved_at`, faute d'historique des statuts.
5. **Plusieurs décisions par jour** : la dernière fait foi, comme le reste du produit. Un REST de sécurité suivi d'une autre décision le même jour est un cas limite à trancher (proposition : un REST de sécurité dans la journée empêche le manque).
6. **Hausse de dose** au premier programme suivant : risque sportif à valider (§ 6).
7. **Replays** : le snapshot persisté change pour les riders V2. Une requête de génération rejouée renvoie le plan déjà persisté, ce qui est inchangé.
8. **Débriefs V1 d'un jour V2** : ils restent une source légitime (règle de priorité du § 3.1).

## 8. Tests d'acceptation proposés (base locale, chemin réel de génération)

Chaque test vérifie les **rôles et les doses** du plan généré, et pas seulement un statut. Chacun a sa contre-preuve sur le code actuel.

| # | Scénario | Attendu après | Contre-preuve avant |
|---|---|---|---|
| 1 | Rider V2 sans historique | semaine 1 introduction, aucune retenue ; plan identique à avant | identique |
| 2 | Quatre semaines V2 complètes (8 derniers jours ≥ 180 min) | semaine 1 `build` (`recent_training_history`), Force MODERATE 60 | introduction |
| 3 | Plusieurs séances partielles | minutes selon P0 (ou P1) ; aucune manquée ; rôle selon le seuil | introduction |
| 4 | Deux « Non réalisée » sans motif de santé, des jours dus | premier `build_plus` retenu en `build` | pas de retenue (ou compté via V1) |
| 5 | Santé : « Non réalisée » pour douleur ; jours sous signal ouvert ; REST de sécurité ; séance arrêtée | 0 manquée ; pas de volume ; pas de retenue étiquetée « manquées » | santé comptée comme manque |
| 6 | Changement de programme dans la fenêtre (séances de l'ancienne version) | comptées une fois chacune, par jour ; séance manuelle réalisée comptée | ignorées |
| 7 | Semaine avec compétition | rôles `race`, `taper`, `race_specific` inchangés ; le jour de course n'est ni dû ni manqué | identique |
| 8 | Données insuffisantes (jours décidés sans fait ; exécutions ouvertes ; dates futures) | comme « sans historique » | identique |
| 9 | Continuité entre deux générations V2 (plan A, 8 jours guidés, plan B) | B commence en `build` | B commence en introduction |
| 10 | Rider V1 | snapshot V1 **identique** octet pour octet (non-régression) | — |
| 11 | Déterminisme | même état de base → même snapshot et même empreinte | — |
| 12 | Lecture des exécutions en échec | génération refusée, jamais un plan « sans historique » | — |

Les tests unitaires du mappeur pur couvrent toutes les lignes du § 3.

## 9. Première correction recommandée

**V2-L2-01a — « volume réalisé V2 » et « séance V2 manquée » dans l'adaptateur de génération V2**
- Contenu : § 5, points 1 à 4, avec l'option **P0** pour les séances partielles.
- Conditions :
  1. décision HPM sur la définition canonique (§ 3.4) et sur P0 / P1 ;
  2. canon `docs/05` mis à jour **avant** le code ;
  3. tests du § 8, avec leurs contre-preuves ;
  4. validation sportive du seuil de 180 min pour V2.
- Livraison : `generate-training-plan` seule, aucune migration.

Si le HPM préfère un ticket plus petit : **le volume seul d'abord** (§ 3.2). C'est l'effet principal et la règle la moins ambiguë. La définition de la séance manquée suivrait.

**STOP. Arbitrage HPM attendu.**
