# 10 — Test Plan

## Objectif

Ce document liste les scénarios de tests **canoniques** que la vertical slice V0.2 doit couvrir. Chaque scénario a une **sortie attendue unique et déterministe**.

Interdiction absolue : `expect(result).toContain(['A', 'B'])` sur des sorties alternatives. Si l'arbitrage entre A et B n'est pas défini par la spec, la spec doit être clarifiée **avant** l'écriture du test.

---

## Structure

Les tests suivent la structure du pipeline :

```
1. Dimensions calculées (unit tests)
2. Safety (unit + integration)
3. Race/Event context (unit + integration)
4. Modes opérationnels
5. Domain decisions (par domaine)
6. Head Coach arbitration (KEEP/MODIFY/REPLACE/REST)
7. DailyPlan structure (integration)
8. Mapping TrainingIntervention ↔ DbSessionType
```

---

## Scénarios canoniques

### T1. Dimensions individuelles séparées

#### T1.1 — Grip RED + jambes GREEN

**Contexte** : `grip_fatigue=8`, `leg_fatigue=2`, planned = `GRIP_WORK`, hors race context.

**Attendu** :
- Dimension `arms_grip.level = RED`
- Dimension `legs.level = GREEN`
- Décision REPLACE : `final_session = STRENGTH_LOWER`
- `do_not_do` contient référence au grip
- `triggered_rules` contient une règle citant `grip_fatigue_high`

#### T1.2 — Jambes RED + grip GREEN

**Contexte** : `leg_fatigue=8`, `grip_fatigue=2`, planned = `STRENGTH_LOWER`, hors race context.

**Attendu** :
- Dimension `legs.level = RED`
- Dimension `arms_grip.level = GREEN`
- Décision REPLACE : `final_session = STRENGTH_UPPER`
- `do_not_do` contient une mention protection bas du corps

#### T1.3 — Mental RED + physique GREEN

**Contexte** : `work_stress=8`, `motivation=3`, `leg_fatigue=2`, `grip_fatigue=2`, `sleep_hours=7.5`, planned = `AEROBIC_INTERVALS`.

**Attendu** :
- Dimension `mental.level = RED`
- Décision MODIFY : `final_session = AEROBIC_BASE` (moins exigeant mentalement, préserve session physique)
- `triggered_rules` cite `stress_high` ou `motivation_low`

#### T1.4 — Mauvais sommeil isolé

**Contexte** : `sleep_hours=5.5`, `sleep_quality=4`, autres dimensions GREEN, planned = `STRENGTH_LOWER`.

**Attendu** :
- Dimension `systemic.level = RED`
- Dimension `legs.level = GREEN`
- Décision MODIFY : `final_session = STRENGTH_LOWER` (nature préservée)
- `protection.do_not_do` mentionne réduction d'intensité

### T2. Prévention du double-counting

#### T2.1 — Signal `sleep_deficit` utilisé une seule fois

**Contexte** : `sleep_hours=5.5`, autres dimensions GREEN, planned = `STRENGTH_LOWER`.

**Attendu** :
- Le signal `sleep_deficit` apparaît dans les `signals_used` d'exactement une règle
- Aucune règle en aval ne cite `sleep_deficit` comme cause additionnelle

### T3. SAFETY strictement limitée

#### T3.1 — Vraie SAFETY (suspicion commotion)

**Contexte** : `suspected_concussion=true`.

**Attendu** :
- `final_session = REST`
- `health_flag_to_create.type = concussion_suspect`
- `confidence = HIGH`
- `reasoning` oriente vers professionnel de santé

#### T3.2 — Douleur légère non-SAFETY reste actionnable

**Contexte** : `pain=true`, `pain_intensity=3`, `pain_location_code='wrist_R'`, pas de critère de gravité, planned = `STRENGTH_UPPER`.

**Attendu** :
- Aucune SAFETY déclenchée
- `final_session ≠ REST` (l'entraînement n'est pas annulé)
- `monitoring.observe` mentionne l'évolution de la douleur
- `protection.do_not_do` évite la charge sur la zone concernée
- Si la séance sollicite la zone, adaptation appliquée

#### T3.3 — Douleur avec critère traumatique déclenche SAFETY

**Contexte** : `pain=true`, `pain_intensity=4`, `pain_traumatic=true`, `pain_location_code='wrist_R'`.

**Attendu** :
- SAFETY A4 déclenchée
- `final_session = REST`
- `health_flag_to_create` créé
- `reasoning` oriente vers professionnel

### T4. T-X adaptable (default framework, pas rail)

#### T4.1 — T-X respecté quand rien ne justifie override

**Contexte** : T-3 avant course A+ format HOT_TRAIL_2DAY, dimensions toutes GREEN, pas de course en cours.

**Attendu** :
- `final_session = RECOVERY_ACTIVE` (recommandation T-X)
- `overrode_race_protocol = false`

#### T4.2 — T-X respecté avec douleur légère non-SAFETY qui ajoute monitoring/protection

**Contexte** : T-3 avant course A+ HOT_TRAIL_2DAY. Douleur légère avant-bras déclarée (`pain=true`, `pain_intensity=3`, `pain_location_code='forearm_R'`, aucun critère de gravité). Recommandation T-X par défaut = `RECOVERY_ACTIVE`.

**Attendu** :
- `final_session = RECOVERY_ACTIVE`
- `overrode_race_protocol = false` (la douleur ne justifie pas à elle seule un changement de nature — `RECOVERY_ACTIVE` sollicite peu la zone concernée)
- Aucune SAFETY déclenchée
- `monitoring.observe` contient une trace explicite de l'évolution de la douleur
- `protection.do_not_do` contient une trace explicite de la protection de la zone (avant-bras / grip)
- `triggered_rules` contient à la fois la règle T-X et la règle de traitement de la douleur non-SAFETY
- Aucune substitution supplémentaire au-delà de la recommandation T-X

### T5. Courses multi-jours

#### T5.1 — Course en cours à J+1 après event_start

**Contexte** : La Berra HOT_TRAIL_2DAY, `event_start=2026-08-15`, `event_end=2026-08-16`. Today = `2026-08-16`.

**Attendu** :
- `event_context.in_progress = true`
- `event_context.event_day = 1`
- `event_context.phase` = `RACE_DAY_GENERIC` (si `race_phase` non renseigné) ou valeur précise si renseignée
- `final_session = RACE_ACTIVITY`
- T-X **n'est pas** appliqué (l'événement est commencé)

#### T5.2 — Contexte post-event utile

**Contexte** : La Berra HOT_TRAIL_2DAY, `event_start=2026-08-15`, `event_end=2026-08-16`. Today = `2026-08-17` (T+1 après event_end).

**Attendu** :
- `event_context.in_progress = false`
- `event_context.phase = POST_EVENT`
- `event_context.days_from_event = 2` (jours depuis `event_start`) — l'événement reste dans le contexte
- `final_session = RECOVERY_ACTIVE`
- `triggered_rules` contient une trace explicite `POST_EVENT`
- L'`EventContext` est conservé dans le `DailyPlan` pour permettre le futur debrief Mental/Analyse (implémenté en P1)

**Note** : les domaines Mental et Analyse sont P1, pas M1. Ce test vérifie uniquement que le contexte post-event est correctement retrouvé et que la décision training est conforme.

#### T5.3 — Priorité au programme officiel si `race_phase` renseigné

**Contexte** : IXS_3DAY en cours, `event_day=1`, `race_phase='QUALI'`.

**Attendu** :
- `final_session = RACE_ACTIVITY`
- La phase renseignée prime sur le mapping générique T-X

### T6. Absence de planned_session

#### T6.1 — Fallback d'inférence quand planned_session = null

**Contexte** : `planned_session = null`, hors race context, dimensions GREEN, `active_mode = OFF_SEASON_DEVELOPMENT`.

**Attendu** :
- Le moteur infère une séance depuis le contexte
- `triggered_rules` contient une trace explicite de fallback (ex : `INFERENCE_FALLBACK`)
- `final_session` cohérent avec le jour de la semaine et le mode

### T7. KEEP / MODIFY / REPLACE / REST

#### T7.1 — KEEP quand tout aligné

**Contexte** : dimensions GREEN, planned = `STRENGTH_UPPER`, hors race context, `active_mode = OFF_SEASON_DEVELOPMENT`.

**Attendu** :
- `final_session = STRENGTH_UPPER` (identique à planned)
- Décision = KEEP (implicite : `final_session == planned_session_before` et pas d'override)

#### T7.2 — MODIFY quand dimension force adaptation d'intensité

**Contexte** : `systemic.level = RED` (mauvais sommeil seul), planned = `STRENGTH_LOWER`.

**Attendu** :
- `final_session = STRENGTH_LOWER` (nature préservée)
- `protection.do_not_do` contient réduction d'intensité

#### T7.3 — REPLACE quand cause identifiée exige changement de nature

**Contexte** : `arms_grip.level = RED`, planned = `GRIP_WORK`.

**Attendu** :
- `final_session ≠ GRIP_WORK`
- Justification dans `reasoning`

#### T7.4 — REST déclenché par SAFETY

Voir T3.1.

### T8. Mapping TrainingIntervention ↔ DbSessionType

#### T8.1 — STRENGTH_UPPER HEAVY → STRENGTH_A

**Contexte** : décision produit `TrainingIntervention { kind: STRENGTH_UPPER, load_profile: HEAVY }`.

**Attendu** :
- Mapping vers `DbSessionType = STRENGTH_A`
- Le `DailyPlan` interne conserve la richesse `TrainingIntervention`

#### T8.2 — STRENGTH_UPPER LIGHT → STRENGTH_B

**Attendu** :
- Mapping vers `DbSessionType = STRENGTH_B`

#### T8.3 — RECOVERY_ACTIVE → RECOVERY

**Attendu** :
- Mapping vers `DbSessionType = RECOVERY`
- Le `load_profile` est ignoré pour ce `kind` (mapping identique quel que soit le profil)

#### T8.4 — Déterminisme du mapping

**Contexte** : pour toute ligne valide de la table de mapping canonique, appeler le mapping deux fois avec les mêmes entrées.

**Attendu** :
- Sortie identique aux deux appels
- Sortie conforme à la table canonique

### T9. Contexte enrichi — HORS M1

**Statut** : ces tests sont **P1**, pas M1. Ils s'implémenteront avec le concept `ActiveExperiment` runtime après validation de M1.

Le concept `ActiveExperiment` reste documenté dans `03_COACHING_MODEL.md` et `02_ATHLETE_PROFILE.md` dès maintenant, mais son implémentation runtime + les tests ci-dessous ne sont pas requis pour M1.

#### T9.1 — Experiment actif influence le coach (P1)

À implémenter avec la couche runtime des experiments.

#### T9.2 — Experiment expiré n'influence plus le coach (P1)

À implémenter avec la couche runtime des experiments.

### T10. Confidence qualitative

#### T10.1 — Confidence HIGH sur SAFETY

Voir T3.1.

#### T10.2 — Confidence LOW quand contexte contradictoire important

**Contexte** : contradictions marquées entre règles ou signaux (ex. : dimension `systemic` GREEN mais `recent_load` VERY_HIGH, ou soft constraint `no_grip_heavy` en conflit avec un `planned_session = GRIP_WORK` sans autre justification).

**Attendu** :
- `confidence = LOW`
- `triggered_rules` reflète les contradictions

Le test T10.3 par défaut (cas normal → `MEDIUM`) reste implicite dans la couverture normale.

---

## Critères d'acceptation M1

- **100% des tests T1–T8 + T10 passent** (T9 est P1, hors M1)
- **Zéro test avec sortie alternative acceptée** (`toContain([A, B])` interdit)
- **Build TypeScript strict sans erreur**
- **CLI produit un `DailyPlan` cohérent** pour chaque scénario de fixture
- **Sortie déterministe** pour chaque combinaison contexte + checkin

---

## Scénarios M2 — Adapter Supabase

Ces tests s'ajoutent à la couverture M1 sans jamais la modifier. Les 75 tests M1 doivent rester verts après l'implémentation M2.

### M2.A — Tests unitaires purs (sans Supabase)

- **M2.A.1** — Mapping `DailyPlan → decisions` row : couvre au moins SAFETY REST, KEEP, MODIFY, REPLACE, override T-X, override soft constraint, avec/sans `health_flag_to_create`. `daily_plan` JSONB source de vérité + colonnes dénormalisées cohérentes.
- **M2.A.2** — Mapping SQL row → `DailyCheckin` : les 3 nouveaux booléens douleur (`pain_traumatic`, `pain_function_loss`, `pain_getting_worse`) sont copiés tels quels. Un checkin avec un de ces champs à `NULL` **doit être rejeté** par l'adapter (pas de conversion silencieuse en `false`). Une row historique dont ces champs sont `NULL` ne peut être exposée comme checkin courant valide.
- **M2.A.3** — Mapping SQL rows → `HealthFlag[]` : filtre correct sur `status != 'resolved'`, mapping du `type`.
- **M2.A.4** — Mapping SQL row → `UpcomingRace` : dates (`event_start`, `event_end`), `priority`, `race_format`, `race_phase` optionnel.
- **M2.A.5** — Mapping SQL row → `TrainingIntervention` (via `intervention JSONB`) : lecture correcte de `kind` + `load_profile`.
- **M2.A.6** — Inversion partielle `DbSessionType → TrainingIntervention` sans `intervention JSONB` :
  - `REST` → `{ kind: "REST" }`
  - `BIKE_MAINTENANCE` → `{ kind: "BIKE_MAINTENANCE" }`
  - `RACE_PREP` → `{ kind: "RACE_ACTIVITY" }`
  - Tout autre `DbSessionType` (`STRENGTH_A`, `STRENGTH_B`, `AEROBIC_BASE`, `AEROBIC_INTERVALS`, `DH_TECHNICAL`, `DH_PERFORMANCE`, `RECOVERY`) → `planned_session = null` + warning émis
  - **Aucun test ne doit produire un `kind` ou `load_profile` inventé.**
- **M2.A.7** — Mapping SQL row → `RawContext.planned_intent` : la valeur explicite de la colonne `planned_sessions.planned_intent` est copiée telle quelle. Aucune inférence depuis `primary_objective` ou tout autre champ.

### M2.B — Tests d'intégration avec Supabase CLI local

- **M2.B.1** — `computeDailyFor` sur un scénario Louis seedé : `DailyPlan` produit strictement identique à celui du même scénario en fixture M1.
- **M2.B.2** — `runDailyFor` : la RPC `persist_daily_run` est appelée. Row `decisions` insérée avec `daily_plan` JSONB complet + `active_mode` + colonnes dénormalisées cohérentes.
- **M2.B.3** — Append-only : deux appels `runDailyFor` consécutifs le même jour → **deux rows distinctes** dans `decisions`. `SELECT ... ORDER BY created_at DESC LIMIT 1` renvoie bien la plus récente.
- **M2.B.4** — `computeDailyFor` ne fait **aucune écriture** : après appel, `decisions` et `health_flags` inchangées.
- **M2.B.5** — Rejet du checkin incomplet : `runDailyFor` sur une DB où le checkin du jour a un des trois critères douleur à `NULL` → erreur explicite, aucune écriture.

### M2.C — Cycle A1/A2/A3/A4 → A5 (critique)

- **M2.C.1** — Jour N : checkin `suspected_concussion=true` → `runDailyFor`. Vérifier atomiquement : row `health_flags` insérée (`type='concussion_suspect'`, statut non résolu) **ET** row `decisions` insérée avec `final_session=REST`. Si l'une échoue, aucune n'est persistée.
- **M2.C.2** — Jour N+1 : même DB, checkin neutre → `runDailyFor`. Vérifier : **aucun nouveau** `health_flags` inséré (idempotence PostgreSQL prouvée) + row `decisions` avec règle `A5` dans `triggered_rules` et `do_not_do` mentionnant DH.
- **M2.C.3** — Flag manuellement marqué `resolved` en SQL → `runDailyFor`. Vérifier : `A5` **n'apparaît plus** dans la nouvelle décision. Un futur checkin `suspected_concussion=true` peut créer un nouveau flag actif (idempotence sémantique respectée).
- **M2.C.4** — Idempotence sous appels concurrents ou multiples : deux `runDailyFor` consécutifs sur le même checkin A1 → **un seul** health flag actif au total (garanti par la contrainte / index unique partiel PostgreSQL, pas par le code applicatif).

### M2.D — Équivalence fixture ↔ Supabase

Pour chaque scénario du CLI M1 (`t1-*`, `t4-*`, `t5-*`, `a5-*`, `soft-constraint-*`, `t10-*`), reproduire le contexte via seed SQL, appeler `computeDailyFor`, comparer le `DailyPlan` obtenu au `DailyPlan` produit par la fixture M1 correspondante.

Toute divergence = régression bloquante de l'adapter M2 (le moteur M1 étant frozen).

### Critères d'acceptation M2

- 75/75 tests M1 toujours verts (moteur non modifié)
- Tests M2.A/B/C/D verts
- Cycle A1→A5 (M2.C.1 + M2.C.2) explicitement prouvé
- Idempotence health flag garantie côté PostgreSQL (M2.C.4)
- Équivalence M2.D démontrée sur tous les scénarios M1 canoniques
- Rejet checkin incomplet démontré (M2.B.5)
- Build TypeScript strict sans erreur
- Aucune modification de `src/{types,engine,rules,domains,mapping}`

---

## Ce qui n'est PAS testé en M1/M2

- LLM couche E (M4+)
- UI (M4+)
- Intégrations externes (M4+)
- Domaine 7 avancé (patterns émergents)
- Planificateur hebdomadaire
- ActiveExperiment runtime (T9, P1)
- Edge Function / API HTTP (M3)

---

## Scénarios V0.3_001 — Longitudinal Intelligence Runtime (V0.3_001A CLOSED LOCALLY, V0.3_001B CLOSED REMOTE — 2026-08-28 ; scénarios restant FUTURS pour V0.3_001C : API `submit-review`, surface web)

**Statut : contrat de test verrouillé pour le runtime V0.3_001.** Les invariants M5 sous-jacents disposent déjà de leurs propres suites de tests (maturité des outcomes, idempotence de l'evidence, retrait/réactivation par cycle de vie, agrégation, revue courante/périmée, RLS/isolation, concurrence — voir les entrées M5_004 à M5_007 de `docs/11_DECISION_LOG.md`). Les scénarios d'orchestration/opérations-serveur listés ci-dessous disposent désormais d'une preuve réelle locale (V0.3_001A, voir la sous-section ci-dessous) **et d'une preuve remote** (V0.3_001B, premier backfill + idempotence remote — voir la sous-section suivante et `docs/11_DECISION_LOG.md`, entrées de clôture 2026-08-28). Seuls les scénarios spécifiques à la soumission de revue (`submit-review`) et à la surface web restent **futurs**, non implémentés (V0.3_001C).

### V0.3_001A — CLOSED LOCALLY (2026-08-28) — invariants de non-régression prouvés

**Plage/timeline** :
- `INSIGHT_AGGREGATION_RANGE` (1900-01-01..9999-12-31) n'est **jamais** transmise à `buildTimeline`
- la plage de timeline réellement transmise à `buildTimeline` est compacte
- la borne supérieure de la plage de requête source = `longitudinalProcessingDate`
- la marge de lookback couvre la fenêtre de référence de 60 jours du détecteur sommeil-énergie
- la marge de lookback couvre la fenêtre de 3 jours du détecteur persistance-douleur
- athlète sans données → timeline d'un seul jour (`{processingDate, processingDate}`)
- lignes sources datées dans le futur exclues
- aucune matérialisation non bornée/de plusieurs millions de jours

**Identité recommendation** :
- `evaluationKey = decision:<decisionId>`
- `evidenceKey = decision:<decisionId>`
- même identité pour `evidence`/`no_evidence`
- actif → retiré → retrait inchangé → réactivé
- le compte d'identités reste à un

**Transport** :
- `refresh-longitudinal` retourne des résumés d'action par détecteur
- des échecs d'item partiels → `status: partial_failure`, HTTP 200
- les messages Postgres/RPC/Supabase/SQL bruts n'entrent jamais dans le JSON exposé au navigateur
- le test de non-fuite par sentinel reste obligatoire

**`get-insights`** :
- `GET` uniquement
- aucun paramètre de requête accepté
- athlète résolu côté serveur
- plage d'insight statique
- client RLS authentifié uniquement
- un projecteur non supporté échoue explicitement (jamais de repli silencieux)
- aucune persistance de candidat

**Build Edge** :
- `dist` est généré/gitignored
- suppression complète + reconstruction avant chaque test HTTP V0.3
- aucun `dist` généré n'est jamais commité

**Répétabilité runtime** :
- le harness HTTP V0.3 peut s'exécuter deux fois consécutives
- le harness M3 HTTP peut s'enchaîner immédiatement après
- le harness HTTP completed-session peut s'enchaîner immédiatement après
- aucun nettoyage manuel du runtime Edge n'est requis entre ces exécutions

**Preuve empirique de clôture V0.3_001A** : `longitudinal-engine` = 689/689 ; harness HTTP V0.3 = 30/30 (×2 consécutifs) ; régressions gelées reconfirmées M1/M2=226/226, daily-run Edge=9/9, M3 HTTP=26/26, completed-session unit=73/73, completed-session HTTP=70/70, web=242/242, web build=PASS, longitudinal build=PASS. Ces nombres restent le compte-rendu historique de la clôture locale V0.3_001A. **La preuve remote V0.3_001B (déploiement, premier backfill, vérification relationnelle, idempotence) est documentée dans la sous-section suivante** ; seuls les scénarios de soumission de revue (`submit-review`) et de surface web restent non prouvés, réservés à V0.3_001C.

### V0.3_001B — CLOSED REMOTE (2026-08-28) — invariants prouvés

**Remote (athlète réel, via les runners guardés)** :
- premier backfill : `outcomes.attempted/writeSucceeded = 42`, `alreadyExisted = 0`, les 3 détecteurs 100% `skippedNoPrior` (14/3/3), `errors: []`
- vérification relationnelle post-backfill : 0 orphelin, 0 décision hors périmètre, 0 décision manquante, exactement 3 horizons par décision, 0 incohérence athlète
- second appel (idempotence) : `attempted/writeSucceeded = 0`, `alreadyExisted = 42`, mêmes 3 détecteurs 100% `skippedNoPrior` ; l'ensemble des métriques agrégées et relationnelles revérifiées est resté strictement identique à l'état post-premier-backfill

**Preuve empirique** : voir `docs/11_DECISION_LOG.md` (entrée de clôture V0.3_001B, 2026-08-28) pour le résultat complet. Ces preuves couvrent le backfill et l'idempotence remote — les scénarios de soumission de revue (`submit-review`) et de surface web restent futurs (V0.3_001C).

### Liste complète des scénarios (référence — statut détaillé dans les sous-sections V0.3_001A/B ci-dessus ; seuls les scénarios de soumission de revue et de surface web restent FUTURS/V0.3_001C)

- Orchestration réelle de bout en bout, données source réelles → evidence (les 3 détecteurs existants)
- Rejeu idempotent de `refresh-longitudinal` (deux exécutions consécutives → zéro doublon, tout `unchanged`)
- Retrait par cycle de vie sur `no_evidence` (les 3 détecteurs, y compris la correction `recommendation_vs_actual_execution`)
- Réactivation après un retrait quand l'evidence redevient positive
- Maturité des horizons d'outcome (J+1/J+3/J+7) découverte correctement sur plusieurs passes
- Agrégation + production de candidat à partir d'evidence réellement orchestrée (pas de fixtures synthétiques)
- État de revue courant/périmé contre de l'evidence réellement orchestrée, y compris un déclencheur de péremption par révision réelle
- Isolation inter-athlètes à travers la nouvelle frontière serveur
- Frontière d'authentification navigateur : athlète authentifié mais erroné ne peut lire/écrire l'evidence/les revues d'un autre athlète ; `anon` sans accès ; aucun appel RPC direct depuis le navigateur possible
- Preuve explicite que la suite `daily-run` reste inchangée/non affectée (gate de régression)
- Aucune revue n'est jamais créée automatiquement par l'orchestration
- Matrice de course de soumission de revue : jeton identique → persistance ; `sourceEvidenceRefs`/`insightProjectorVersion`/plage/version de règle/`insightKind` divergents → `stale_candidate`, aucune écriture ; candidat absent → aucune écriture ; rejeu navigateur après revue identique déjà réussie → `unchanged`
- Comportement historique/backfill : une première passe complète produit exactement le jeu attendu sans doublon ; une seconde passe immédiate est un no-op complet
