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
- Enrichissement des domaines Technique/Mental/Nutrition et leur intégration cross-domaine (V0.3_002, voir §Scénarios V0.3_002 ci-dessous — **COMPLETE, 2026-08-30** : T11/T12/T13/T14 CLOSED LOCALLY, gate web durable + rollout remote CLOSED via V0.3_002F)
- ActiveExperiment runtime (T9, P1)
- Edge Function / API HTTP (M3)

---

## Scénarios V0.3_001 — Longitudinal Intelligence Runtime (V0.3_001A CLOSED LOCALLY, V0.3_001B CLOSED REMOTE, V0.3_001C CLOSED REMOTE — 2026-08-28 ; V0.3_001 COMPLETE)

**Statut : contrat de test verrouillé pour le runtime V0.3_001, désormais COMPLET.** Les invariants M5 sous-jacents disposent déjà de leurs propres suites de tests (maturité des outcomes, idempotence de l'evidence, retrait/réactivation par cycle de vie, agrégation, revue courante/périmée, RLS/isolation, concurrence — voir les entrées M5_004 à M5_007 de `docs/11_DECISION_LOG.md`). Les scénarios d'orchestration/opérations-serveur listés ci-dessous disposent désormais d'une preuve réelle locale (V0.3_001A, voir la sous-section ci-dessous), **d'une preuve remote de déploiement/backfill/idempotence** (V0.3_001B) et **d'une preuve réelle locale du chemin d'écriture de revue plus d'un déploiement/surface de lecture remote vérifiés** (V0.3_001C, voir les sous-sections suivantes et `docs/11_DECISION_LOG.md`, entrées de clôture 2026-08-28). L'écriture de revue réussie en production reste explicitement **non exercée** (aucun candidat naturel en production à ce jour) — voir la sous-section V0.3_001C pour la portée exacte.

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

**Preuve empirique de clôture V0.3_001A** : `longitudinal-engine` = 689/689 ; harness HTTP V0.3 = 30/30 (×2 consécutifs) ; régressions gelées reconfirmées M1/M2=226/226, daily-run Edge=9/9, M3 HTTP=26/26, completed-session unit=73/73, completed-session HTTP=70/70, web=242/242, web build=PASS, longitudinal build=PASS. Ces nombres restent le compte-rendu historique de la clôture locale V0.3_001A. **La preuve remote V0.3_001B (déploiement, premier backfill, vérification relationnelle, idempotence) est documentée dans la sous-section suivante** ; les scénarios de soumission de revue (`submit-review`) et de surface web sont documentés dans la sous-section V0.3_001C ci-dessous.

### V0.3_001B — CLOSED REMOTE (2026-08-28) — invariants prouvés

**Remote (athlète réel, via les runners guardés)** :
- premier backfill : `outcomes.attempted/writeSucceeded = 42`, `alreadyExisted = 0`, les 3 détecteurs 100% `skippedNoPrior` (14/3/3), `errors: []`
- vérification relationnelle post-backfill : 0 orphelin, 0 décision hors périmètre, 0 décision manquante, exactement 3 horizons par décision, 0 incohérence athlète
- second appel (idempotence) : `attempted/writeSucceeded = 0`, `alreadyExisted = 42`, mêmes 3 détecteurs 100% `skippedNoPrior` ; l'ensemble des métriques agrégées et relationnelles revérifiées est resté strictement identique à l'état post-premier-backfill

**Preuve empirique** : voir `docs/11_DECISION_LOG.md` (entrée de clôture V0.3_001B, 2026-08-28) pour le résultat complet. Ces preuves couvrent le backfill et l'idempotence remote — les scénarios de soumission de revue (`submit-review`) et de surface web sont documentés dans la sous-section V0.3_001C ci-dessous.

### V0.3_001C — CLOSED REMOTE (2026-08-28) — invariants prouvés

**Local (réel, jamais mocké — endpoint HTTP `submit-review` réel, Postgres/RPC locaux réels)** :
- insertion / inchangé / supersession réels via `persist_pattern_insight_review`
- égalité DB du `candidate_snapshot` **côté serveur uniquement**, jamais le corps navigateur
- soumissions concurrentes identiques (RPC-sérialisées) → exactement un `inserted` + un `unchanged`, aucune ligne dupliquée
- soumissions concurrentes divergentes → exactement un `inserted` + un `superseded`, chaîne de supersession valide, aucune écriture perdue
- isolation inter-athlète via réutilisation réelle d'un jeton de fraîcheur d'un autre athlète → `candidate_not_found`, zéro écriture croisée
- linéarisation de fraîcheur verrouillée (sémantique A) : mutation d'evidence après comparaison réussie, observée objectivement via un verrou consultatif PostgreSQL réel (`pg_locks`, jamais une pause arbitraire) — l'écriture reste valide, projection `reviewed_stale` ultérieure confirmée
- `V0.3` HTTP harness = **84/84**

**Web (réel, `web/src/features/insights/**` + `pages/InsightsPage.tsx`)** :
- surface `/insights` authentifiée, chargement `get-insights` uniquement (jamais `refresh-longitudinal` automatique)
- corps `submit-review` construit explicitement (7 dimensions de fraîcheur + `decision` + `reviewerNote`, jamais `athleteId`/`candidateSnapshot`)
- `stale_candidate`/`candidate_not_found` gérés par refetch authoritatif, aucune resoumission automatique
- `web` = **293/293**, `web build` = **PASS**

**Remote (déploiement/authentification/surface de lecture, athlète réel)** :
- cible correcte `uvolpldwwyvadlamulvr`, migrations 26 local/26 remote/0 pending
- primitives M5_007 confirmées présentes
- `submit-review` déployé `ACTIVE v1`, `verify_jwt: true`
- `get-insights`/`refresh-longitudinal` inchangés (hash identique avant/après déploiement)
- lecture authentifiée remote réelle `get-insights` → `HTTP 200`, `candidateCount = 0`
- production web déployée, `/insights` sert la SPA réelle
- delta d'écriture applicatif remote sur l'ensemble du rollout/preflight = **0**

**Écriture de revue réussie en production** : **NON APPLICABLE À L'ÉTAT NATUREL ACTUEL** — la production ne contient aucun candidat courant naturel (`pattern_evidence_identities`/`_revisions`/`pattern_evidence_current_effective` = 0/0/0 ; `pattern_insight_identities`/`_reviews`/`_review_current` = 0/0/0). Aucune donnée applicative synthétique n'a été créée pour fabriquer cette précondition. Voir `docs/06_ARCHITECTURE.md`, « Discipline de rollout `submit-review` », pour la règle de clôture verrouillée.

**Preuve empirique** : voir `docs/11_DECISION_LOG.md` (entrée de clôture V0.3_001C / V0.3_001, 2026-08-28) pour le résultat complet.

### Liste complète des scénarios (référence — statut détaillé dans les sous-sections V0.3_001A/B/C ci-dessus)

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
- Mutation effective déjà visible AVANT la comparaison serveur → `stale_candidate`, aucune écriture (divergence détectée dès la reconstruction du candidat)
- **Mutation d'evidence après comparaison de fraîcheur réussie** : suspendre le flux après reconstruction serveur + correspondance exacte des 7 dimensions, modifier l'evidence effective, puis laisser la persistance continuer. La revue du `candidate_snapshot` serveur validé est autorisée ; aucun `stale_candidate` rétroactif n'est attendu. Une reconstruction/lecture `get-insights` ultérieure doit projeter cette revue `reviewed_stale` si la mutation a effectivement modifié le fingerprint du candidat.
- **Sélecteur de candidat — `detectorRuleVersion` divergent** : même `detectorRuleId`, résolution d'exactement un candidat courant → `stale_candidate`, aucune écriture, retour du candidat frais
- **Sélecteur de candidat — `insightKind` divergent** : même `detectorRuleId`, résolution d'exactement un candidat courant → `stale_candidate`, aucune écriture, retour du candidat frais
- **Sélecteur de candidat — aucun candidat courant pour `detectorRuleId`** → `candidate_not_found`, aucune écriture
- **Sélecteur de candidat — plus d'un candidat courant pour `detectorRuleId`** (violation d'invariant) → échec `internal_error`, aucune écriture, preuve qu'aucune sélection par premier élément/`array[0]`/ordre de tri ne se produit
- Comportement historique/backfill : une première passe complète produit exactement le jeu attendu sans doublon ; une seconde passe immédiate est un no-op complet

---

## Scénarios V0.3_002 — Domain Coaching Enrichment (COMPLETE — 2026-08-30 ; V0.3_002A/B/C/D/E/F tous CLOSED)

**Statut : contrat de test verrouillé pour V0.3_002 — désormais COMPLET.** T11 (Technique DH), T12 (Mental), T13 (Nutrition), T14 (intégration cross-domaine) implémentés et vérifiés (002B/C/D/E CLOSED LOCALLY) ; le gate web bout-en-bout reporté par 002E est fermé durablement (`web/src/features/dailyPlan/DailyPlanView.enriched.test.tsx`) et le rollout remote de `daily-run` est complet et vérifié (V0.3_002F CLOSED — voir `docs/11_DECISION_LOG.md`).

### T11. Technique DH (V0.3_002B — CLOSED LOCALLY, 2026-08-28)

Activation : source unique = `final_session.kind` (séance déjà entièrement arbitrée — après règles de domaine, douleur non-SAFETY, soft constraints et A5). Actif exactement pour `DH_TECHNICAL`/`DH_PERFORMANCE`/`DH_LIGHT`/`PUMPTRACK` ; inactif pour tout autre kind courant (y compris `RACE_ACTIVITY`) — aucun gating direct sur jour de semaine/weekend, aucun gating sur `active_mode`.

- Séance finale hors des 4 kinds actifs → `dh_or_technical.active = false`
- Séance finale dans les 4 kinds actifs → `active = true`, `focus` = une seule chaîne de cue technique actionnable ("Fixe ta ligne, dose le freinage, laisse rouler."), `spot_hint` catégoriel peuplé
- Fatigue AMBER (`systemic` OU `legs` OU `arms_grip` == AMBER, RED seul exclu) → `spot_hint` reflète une préférence de proximité ; `focus` inchangé par ce signal ; décision Training inchangée
- Proximité course : une course réelle dans `RawContext.upcoming_races` avec `event_start` J+1 à J+14 inclusif (C1.5, `TECHNIQUE_POLICY.raceProximityWindowDays`) → `spot_hint` reflète une préférence terrain-représentatif ; `focus` n'est **pas** écrasé. `EventContext`/`PRE_EVENT` reste un mécanisme séparé à 7 jours (`PROVISIONAL_THRESHOLDS.event.preEventWindowDays`) et n'est **jamais** le sélecteur de C1.5.
- Course + fatigue AMBER simultanées → `spot_hint` combine les deux (chaîne dédiée, aucune contrainte ignorée)
- Plan Safety REST → `dh_or_technical = {active:false}` inchangé, Technique jamais invoqué sur ce chemin

**Preuve finale (2026-08-28)** : `head-coach-engine/tests/t11_technique.test.ts` — 4 kinds actifs / 12 inactifs exhaustifs contre l'union `TrainingInterventionKind` réelle, focus unique déterministe, allowlist `spot_hint` à 4 chaînes exactes, C1.5 sur J+1..J+14 réel (adaptateur `raceCalendarRepo.ts` élargi, `EventContext`/`PRE_EVENT` à J+7 inchangé — inertie prouvée par 6 cas d'intégration Supabase réels dans `buildRawContext.integration.test.ts`), config profil `id`+`focus` directement testés. `npm test` 275/275, `npm run test:edge` 9/9.

### T12. Mental (V0.3_002C — CLOSED LOCALLY, 2026-08-29)

Activation : `focus` et `action_hint` sont orthogonaux. `focus` uniquement depuis `event_context.phase === "PRE_EVENT"` (toute priorité de course). `action_hint` uniquement depuis `dimensions.mental` AMBER (précédence `stress_high` puis `motivation_low`, exactement un signal consommé) ou RED (lecture de support non consommante du signal déjà propriété de `MENTAL_RED`).

- PRE_EVENT, priorité A, B ou C → `focus` identique dans les trois cas (aucun filtre)
- AMBER stress seul → `action_hint` régulation, `MENTAL_AMBER_STRESS` consomme `stress_high`
- AMBER motivation seul → `action_hint` régulation, `MENTAL_AMBER_MOTIVATION` consomme `motivation_low`
- AMBER stress + motivation simultanés → `stress_high` gagne, `motivation_low` reste non consommé, une seule règle
- RED (stress, motivation, ou les deux) → Training reste seul propriétaire de décision (`MENTAL_RED`, précédence `stress_high` puis `motivation_low` inchangée) ; Mental n'appelle jamais `consume()`, vérifie la propriété via `consumedByRule()` et émet un texte de support unique ; aucune règle `MENTAL_AMBER_*` n'est jamais émise en cas RED, y compris dans le cas mixte stress AMBER + motivation RED (Training sélectionne `stress_high` malgré tout par sa précédence existante — comportement enregistré, non modifié par 002C)
- `consume()` AMBER en échec inattendu → aucun `action_hint`, aucun repli sur le second signal ; `focus` PRE_EVENT indépendamment présent reste actif
- POST_EVENT / RACE_DAY_GENERIC → n'inhibent jamais globalement Mental (seul `focus` reste absent) ; aucun texte de debrief ni de coaching de course en direct
- Plan Safety REST → `mental = {active:false}` inchangé, Mental jamais invoqué

**Preuve finale (2026-08-29)** : `head-coach-engine/tests/t12_mental.test.ts` — couverture unitaire complète des cas ci-dessus, preuve intégrée réelle (`RawContext → DailyPlan`) des cas both-RED, stress RED + motivation AMBER et stress AMBER + motivation RED, comparaison appariée GREEN/AMBER prouvant l'isolation `training`/`reasoning`/`override_reason` vis-à-vis du late-push `triggered_rules`, config profil `id`+`cue` directement testés, `ENGINE_VERSION` directement testé. `npm test` 310/310, `npm run test:edge` 9/9.

### T13. Nutrition (V0.3_002D — CLOSED LOCALLY, 2026-08-30)

Activation : `focus` (race-week) et la branche primaire `notes`/`hydration_target_l` (précédence RACE DAY > JOUR DH > SÉANCE DE FORCE PLANIFIÉE > aucune) sont orthogonaux et indépendamment dérivés.

- `active_mode === "RACE_WEEK"` → `focus` seul (aucun filtre `PRE_EVENT`, jamais utilisé par Nutrition)
- `final_session.kind` ∈ {DH_TECHNICAL, DH_PERFORMANCE, DH_LIGHT, PUMPTRACK} → `notes` = plage C5.4 texte, `hydration_target_l` **absent**
- `ctx.planned_session.kind` (brute, jamais `final_session`) ∈ famille force → `notes` = C5.2 texte, `hydration_target_l = 2` (seule branche à le peupler)
- RACE DAY (`event_context.in_progress`, jamais `phase === "RACE_DAY_GENERIC"`) > JOUR DH > SÉANCE DE FORCE : la branche gagnante contrôle `notes`+`hydration_target_l` ensemble, aucune fuite possible (structurellement, `hydration_target_l` n'est assigné que dans la branche force)
- `PRE_EVENT`/`POST_EVENT` seuls → aucune contribution Nutrition, mais ne suppriment jamais un déclencheur indépendant valide (mode/session)
- Contexte non pertinent → `nutrition.active = false` (jamais actif par défaut pour la seule baseline)
- Plan Safety REST → `nutrition = {active:false}` inchangé, y compris quand un déclencheur Nutrition aurait par ailleurs été valide (race-week/force)

**Preuve finale (2026-08-30)** : `head-coach-engine/tests/t13_nutrition.test.ts` — couverture unitaire complète des combinaisons ci-dessus, preuve d'intégration réelle course-en-cours (`upcoming_races` → `computeEventContext` → `buildDailyPlan`, jamais un `EventContext` construit à la main) combinée à la prévention de fuite `hydration_target_l`, preuve Safety dominant un déclencheur par ailleurs valide, quatre constantes `NUTRITION_POLICY` directement testées et réellement consommées par le runtime (`baselineHydrationTargetL` pilote le champ structuré `hydration_target_l`, les trois autres pilotent les textes déterministes). `npm test` 347/347, `npm run test:edge` 9/9.

### T14. Intégration/régressions cross-domaine (V0.3_002E — CLOSED LOCALLY, 2026-08-30)

Test-only : `head-coach-engine/tests/t14_crossDomainIntegration.test.ts` (NEW), aucun fichier de production modifié. Preuves via `buildDailyPlan(RawContext)` réel uniquement (aucune dimension injectée, aucune instrumentation `SignalTrace`) :

- `PRE_EVENT`/`RACE_WEEK` indépendants — chaque quadrant (l'un seul, l'autre seul, les deux) produit exactement les `focus` attendus, sans dérivation croisée
- Technique + Mental AMBER + Nutrition simultanément actifs (séance DH), exactement une `TriggeredRule` `MENTAL_AMBER_STRESS`, zéro `TECHNIQUE_*`/`NUTRITION_*`
- Late-push Mental (§V0.3_002C) étendu à une paire GREEN/AMBER appariée avec Technique+Nutrition actifs des deux côtés — tous les champs dérivés de Training strictement égaux
- Propriété `MENTAL_RED` confirmée sur une séance DH réelle : le kind DH survit (charge seule dégradée), Technique/Nutrition suivent le `final_session` stabilisé, aucune seconde règle Mental observable — preuve de composition cross-domaine uniquement (T14 n'instrumente jamais `SignalTrace`) ; la preuve directe qu'aucun second `consume()` n'a lieu reste T12
- Propagation `final_session` + asymétrie `planned_session` acceptée prouvées sur un fixture réel unique (`GRIP_WORK`+RED double → `RECOVERY_ACTIVE` ; Technique/Nutrition-DH inactifs ; Nutrition-force reste active via le `planned_session` brut)
- Composition jour de course réel (`computeEventContext`) : Nutrition race-day + Mental AMBER coexistent, `mental.focus` structurellement absent
- Safety dominant une pression maximale (concussion + RACE_WEEK + PRE_EVENT réel + DH planifiée) : `triggered_rules=[A1]`, trois sections enrichies exactement `{active:false}`
- Aucun `rule_id` `TECHNIQUE_*`/`NUTRITION_*` à travers tous les plans combinés
- Régression Recovery appariée sous charge Technique+Mental+Nutrition, à entrées Recovery-pertinentes équivalentes
- Déterminisme d'un `DailyPlan` riche multi-domaine

**Hors périmètre T14** : la preuve bout-en-bout que le renderer web accepte le `DailyPlan` enrichi n'est **pas** couverte par T14 (`web/**` hors scope approuvé de 002E) — ce gate a ensuite été fermé durablement par V0.3_002F (`DailyPlanView.enriched.test.tsx`), voir `docs/06_ARCHITECTURE.md` §V0.3_002F.

**Preuve finale (2026-08-30)** : `npm test` 359/359, `npm run test:edge` 9/9, build PASS. `ENGINE_VERSION` inchangé (`head-coach-engine@0.2.0-m1-v0.3_002d`), `tests/engineVersion.test.ts` non modifié.

### V0.3_002F. Gate web durable + rollout remote (CLOSED, 2026-08-30)

Ferme le gate reporté par T14/002E et clôt V0.3_002 dans son ensemble :

- `web/src/features/dailyPlan/DailyPlanView.enriched.test.tsx` (NEW) — real RawContext → real `buildDailyPlan` (import source direct `head-coach-engine/src/**`, aucune dépendance/alias ajouté) → real `isValidDailyPlan` → real `DailyPlanView`, aucun objet copié. `web` 294/294, build PASS
- `daily-run` (seule) redéployée sur `uvolpldwwyvadlamulvr`, ACTIVE, `verify_jwt: true`, version 2
- canary scratch (athlète temporaire, jamais l'athlète réel) : `engine_version` remote = `head-coach-engine@0.2.0-m1-v0.3_002d`, Technique/Mental/Nutrition actifs, persistance confirmée (colonne + JSONB), nettoyage complet vérifié
- migration parity : 26/26, 0 en attente, avant et après déploiement
- aucun déploiement Vercel

**V0.3_002 — contrat de test complet.**

---

## Scénarios V0.3_003 — Planning / Session Intent (V0.3_003A CLOSED / ARCHITECTURE LOCKED — 2026-08-31 ; V0.3_003B CLOSED / PASS — 2026-08-31 ; V0.3_003C CLOSED / PASS — 2026-08-31 ; V0.3_003D CLOSED / PASS — 2026-08-31 ; V0.3_003E CLOSED / PASS — 2026-09-02)

**Statut : T15 CLOSED / PASS (2026-08-31) ; T16 CLOSED / PASS (2026-08-31) ; T17 CLOSED / PASS (2026-08-31) ; T18 CLOSED / PASS (2026-09-02).** Aucun scénario `head-coach-engine` n'est requis — le moteur reste strictement inchangé, T1-T14 continuent de posséder l'intégralité des assertions de comportement moteur.

### T15. Planning data-access (V0.3_003B — CLOSED / PASS, 2026-08-31)
- Chargement/upsert/édition/suppression réels sous RLS locale (athlète propre uniquement) — `planningRepo.integration.test.ts` tests A-D, PASS
- Isolation inter-athlète réelle (jamais de lecture/écriture croisée) — tests E-G, PASS
- Remplacement par unicité `(athlete_id, planned_date)` — un upsert remplace, ne duplique jamais — test C, PASS ; unicité par-athlète (jamais globale) — test H, PASS
- `source='manual'`, `intervention` toujours renseigné, `planned_intent` toujours `NULL`, les 5 colonnes engine-inertes jamais référencées — test B + `planningRepo.test.ts` (payload de save), PASS
- **Préservation empiriquement prouvée devenue régression permanente** : un upsert planificateur omettant `primary_objective`/`notes`/`planned_duration_min`/`planned_time_of_day`/`training_block_id` préserve leur valeur préexistante sur conflit — bloc `OMIT AND PRESERVE` dédié dans `planningRepo.integration.test.ts`, PASS
- Mapping `session_type` réutilisant `trainingInterventionToSessionType.ts` — `planningMappingParity.test.ts`, import source direct de `head-coach-engine/src/mapping/trainingInterventionToDbSessionType.ts` (frontière déjà prouvée V0.3_002F), 16 kinds, PASS
- Guard de code (pas seulement UI) : `RACE_ACTIVITY` et tout couple `(kind, load_profile)` invalide rejetés avant tout appel réseau — `planningValidation.test.ts` + `planningRepo.test.ts`, PASS
- **Cible locale forte** : la suite RLS destructive est gated par opt-in explicite (`RUN_LOCAL_SUPABASE_INTEGRATION=1` + clé serveur + URL résolue explicitement loopback locale) — une URL de production ne peut jamais l'activer, prouvé sans mutation production
- **Contrat d'exécution final** : `web` par défaut **415 passed / 9 skipped** (424 total, aucune stack Supabase requise) ; fichier d'intégration Planning avec opt-in local **18/18 PASS** (9 tests RLS réels authentifiés + 9 régressions pures de la garde cible locale, sans réseau) ; `web` complet avec opt-in **424/424 PASS** ; `head-coach-engine` **359/359** ; edge **9/9**. Voir `docs/11_DECISION_LOG.md` (2026-08-31 — V0.3_003B).

### T16. Web planning workflow (V0.3_003C — CLOSED / PASS, 2026-08-31)
- Route `/plan` protégée, entrée `AppNav` "Plan" — `PlanPage.test.tsx`, `App.test.tsx`, `AppNav.test.tsx`, PASS
- Rendu 7 jours glissants (aujourd'hui→J+6), rows persistées mappées sur la bonne date — `PlanPage.test.tsx`, PASS
- États visuels distincts "Non planifié" (aucune row) vs "Repos" (REST explicite) — `PlanPage.test.tsx`, PASS
- Sélecteur limité aux 15 kinds plannables, `RACE_ACTIVITY` jamais proposé — `PlanningDayCard.test.tsx`, PASS
- Les 11 `LoadVariableKind` (paramétré sur `PLANNABLE_LOAD_VARIABLE_KINDS`) exigent un choix explicite de charge ; les 4 `FixedLoadKind` plannables (paramétré sur `PLANNABLE_FIXED_LOAD_KINDS`) n'affichent aucun sélecteur — couverture 11/11 + 4/4 réelle, catalogue jamais dupliqué dans les tests — `PlanningDayCard.test.tsx`, PASS
- Create/edit/delete via `planningRepo` (mocké, 003B reste seul propriétaire de la preuve RLS réelle) — `PlanningDayCard.test.tsx`, PASS
- Suppression → "Non planifié", jamais "Repos" ; sauvegarde REST → "Repos" explicite via le chemin de sauvegarde normal — `PlanningDayCard.test.tsx`, PASS
- Invariant charge périmée : changement de kind efface toujours la charge en brouillon ; édition sans changement de kind préremplit la charge persistée — `PlanningDayCard.test.tsx`, PASS
- Row legacy `intervention=NULL` : label coarse français affiché (jamais l'enum brut), aucune intention riche fabriquée à l'ouverture, remplacement exige une sélection explicite, suppression toujours disponible — `PlanningDayCard.test.tsx`, PASS
- Ownership canonique : `PlanPage` détient les rows persistées, `PlanningDayCard` ne porte que le brouillon ; sauvegarde/suppression réussie met à jour l'état canonique et referme l'éditeur ; échec laisse l'éditeur ouvert, le brouillon intact, l'affichage persisté inchangé, avec un message sûr — `PlanPage.test.tsx` + `PlanningDayCard.test.tsx`, PASS
- Durcissement course contre la montre asynchrone inter-jours : une mutation résolue après changement de jour ne referme jamais l'éditeur d'un autre jour — `PlanPage.test.tsx`, PASS
- Arithmétique calendaire `addDays` : bornes mois/année/année bissextile — `date.test.ts`, PASS
- **Contrat d'exécution** : `web` par défaut 473 passed/9 skipped (482 total, 35 fichiers) ; `web` complet avec opt-in 482/482 PASS ; `head-coach-engine` 359/359 ; edge 9/9. Voir `docs/11_DECISION_LOG.md` (2026-08-31 — V0.3_003C).

### T17. Today intégration + régressions e2e (V0.3_003D — CLOSED / PASS, 2026-08-31)
- Résumé "Prévu aujourd'hui" (lecture seule, `TodayPlanningSummary.tsx`) distingue non-planifié / REST explicite / séance explicite / legacy coarse sûr / enum inconnu sûr, jamais l'inférence de fallback présentée comme intention athlète — `TodayPlanningSummary.test.tsx`, `TodayPage.test.tsx`, PASS
- Défaut de cohérence 003C corrigé en revue : `PlanningDayCard.tsx` ne retombe plus jamais sur l'enum brut `row.session_type` pour une row legacy non mappée — régression ajoutée dans `PlanningDayCard.test.tsx`, PASS
- **Chaîne réelle bout-en-bout, exécutée contre une vraie stack Supabase locale (aucun mock)** : `t17_planningE2E.integration.test.ts`, via `runDailyFor(admin, athleteId, date)` directement (même pattern que `buildRawContext.integration.test.ts`/`runDailyFor.integration.test.ts`, jamais l'Edge Function HTTP `daily-run`) : row planificateur → `RawContext.planned_session` → arbitrage réel inchangé → `DailyPlan.{planned_session_before,final_session}` riche → persistance : `decisions.daily_plan.planned_session_before` (JSONB, source de vérité riche) **et** `decisions.planned_session_before` (colonne dénormalisée coarse, projection uniquement — jamais confondue avec la source riche), chaque décision identifiée par `result.persistence.decision_id`
- Jamais planifié — `planned_session=null`, `INFERENCE_FALLBACK`, `final_session` = split hebdomadaire déterministe exact, PASS
- Planifié puis supprimé — scénario distinct du précédent, converge vers le même contrat no-intent (DELETE ≠ REST), PASS
- REST explicite — survit intact DB→RawContext→persistance, `final_session.kind="REST"` sous conditions neutres, PASS
- `STRENGTH_LOWER`/`HEAVY` planifié — charge préservée de bout en bout, branche Nutrition force existante activée (`NUTRITION_POLICY.baselineHydrationTargetL`), aucune règle Nutrition modifiée, PASS
- `DH_TECHNICAL`/`MODERATE` planifié — domaine Technique existant activé sous conditions neutres, aucune règle Technique modifiée, PASS
- **Cas protocole de course (régression critique)** : intention planifiée `DH_TECHNICAL`/`MODERATE` + course réelle du jour (`event_start=event_end=today`) → `final_session.kind="RACE_ACTIVITY"` (coarse persisté `"RACE_PREP"`) reflète l'arbitrage réel, mais `planned_session_before` (riche, mémoire et `daily_plan` persisté, et dénormalisé coarse `"DH_TECHNICAL"`) reste exactement l'intention brute originale, jamais substituée — preuve empirique directe (pas seulement auditée) que l'intention athlète brute survit même quand le protocole de course l'emporte, PASS
- **Garde cible locale forte, infrastructure de test partagée** : `head-coach-engine/tests/supabase/testDb.ts`'s `createTestClient()` refuse un client privilégié contre toute cible autre que `http://127.0.0.1:54321`/`http://localhost:54321` (hôte et port stricts), avant toute mutation — corrige une lacune pré-existante sur tous les fichiers d'intégration `head-coach-engine` — `testDbSafety.test.ts` (17 tests) + preuve négative empirique dans `t17_planningE2E.integration.test.ts` (URL de production + opt-in + clé valides ⇒ les 6 scénarios destructifs restent SKIPPED), PASS
- Aucune nouvelle assertion de contenu de coaching — T11/T12/T13/T14 restent seuls propriétaires des chaînes exactes
- Suites gelées M1-M4/T11-T14/web existantes toujours vertes
- **Contrat d'exécution final** : `web` par défaut **485 passed / 9 skipped** (494 total, 36 fichiers) ; `web` complet avec opt-in **494/494 PASS** ; `head-coach-engine` avec clé locale sans opt-in T17 **378 passed / 6 skipped** (384 total) ; avec opt-in T17 **384/384 PASS** ; edge **9/9**. Voir `docs/11_DECISION_LOG.md` (2026-08-31 — V0.3_003D).

### T18. Rollout production (V0.3_003E — CLOSED / PASS, 2026-09-02)
- Build/déploiement web réel sur `nalynt`/`louis-performance-system` : premier déploiement bloqué par un défaut de frontière de build TypeScript (`tsc -b` du build de production type-vérifiait des tests `web/src/**` important `head-coach-engine/**`, hors du contexte de build isolé Vercel), **zéro impact production** (alias resté sur le déploiement `Ready` précédent). Corrigé sans changement de code produit (`ede2776`, `build: isolate web production typecheck` — `web/tsconfig.build.json` nouveau + `web/package.json` modifié). Second déploiement réussi : `dpl_HQDuP893LoDSuqxdfzWXMbABmVzT`, alias canonique `Ready`/`production`, bundle réellement servi `/assets/index-F_rQBrBr.js` confirmé (Plan/`/plan`/`Prévu aujourd'hui`/`Modifier dans Plan`/Aujourd'hui/Historique/Insights présents, project ref `uvolpldwwyvadlamulvr` présent/`evynmzyjhobdpmxdiwsy` absent).
- Aucune migration, aucun redéploiement `daily-run`, aucune autre Edge Function touchée — `daily-run` reconfirmé `ACTIVE`/version 2/`verify_jwt: true` avant et après le canary ; migration parity 26 locales/26 remote/0 en attente avant et après.
- Canary scratch **exécuté et PASS** : écriture `planned_sessions` (`DH_TECHNICAL`/`MODERATE`) par le client authentifié scratch sous RLS réelle (`planned_sessions_own_data`, jamais `service_role`), relecture propre confirmée → `daily-run` remote réel invoqué sous JWT scratch authentifié (jamais `service_role`, runtime `_002d` déjà déployé, aucun redéploiement) → `HTTP 200`, `engine_version` confirmé directement `head-coach-engine@0.2.0-m1-v0.3_002d`, relation riche `planned_session_before`/`final_session` = `DH_TECHNICAL`/`MODERATE` → `DH_TECHNICAL` confirmée en mémoire **et** persistée (`daily_plan.planned_session_before` JSONB riche + projections dénormalisées coarse `planned_session_before`/`final_session` = `DH_TECHNICAL`, décision identifiée par son id exact retourné par l'endpoint, jamais "dernière ligne") → nettoyage complet exécuté, absence vérifiée (0 ligne restante sur `athletes`/`planned_sessions`/`daily_checkins`/`decisions`/`health_flags`/`training_blocks`, utilisateur d'authentification absent). **Écritures sur l'athlète réel : zéro.** Canary remote de précédence course délibérément SKIP (déjà prouvé localement par T17 §21 ; 003E vérifie déploiement/auth/RLS/Edge/persistance, pas une duplication du comportement moteur).
- Smoke production **exécuté** : bundle réellement servi + smoke direct `/`, `/today`, `/plan`, `/history`, `/insights` (tous HTTP 200) + canary RLS/`daily-run` authentifié bout-en-bout ci-dessus. Smoke navigateur visuel authentifié : **non automatisé** (aucune dépendance d'automatisation navigateur ajoutée — non requis pour T18, non-bloquant compte tenu des preuves directes ci-dessus).
- **Contrat d'exécution final** : `web` par défaut **485 passed / 9 skipped** (494 total) ; `web` complet avec opt-in **494/494 PASS** ; build production local PASS ; build isolé `web/`-seul (sans sibling `head-coach-engine/`) PASS avec `dist/` produit ; `head-coach-engine`/edge inchangés depuis T17. Voir `docs/06_ARCHITECTURE.md` §V0.3_003E et `docs/11_DECISION_LOG.md` (2026-09-02 — V0.3_003E).

**V0.3_003 — contrat de test complet.**

---

## Scénarios V0.3_004 — Multi-Athlete Foundation Hardening (V0.3_004A/B/C CLOSED / PASS — 2026-09-04 ; V0.3_004D CLOSED / PRODUCTION ROLLOUT COMPLETE — 2026-09-04)

**Statut : V0.3_004 dans son ensemble COMPLETE (2026-09-04).** Aucune régression moteur — T1-T18 restent seuls propriétaires de leurs assertions respectives, non dupliquées ici.

### T19. Profil de coaching athlete-scoped (V0.3_004A — CLOSED / PASS, 2026-09-04)
- Isolation RLS réelle de `athlete_coaching_profiles` contre une vraie stack Supabase locale — `athleteCoachingProfileRLS.integration.test.ts` (nouveau, 245 lignes)
- `buildRawContext.ts` peuple `coaching_profile` seulement si une ligne existe ; absence de ligne ⇒ `undefined`, jamais un objet par défaut — `buildRawContext.integration.test.ts` (étendu)
- Domaines Technique/Mental reçoivent le focus/cue en paramètre pur ; absence de profil ou champ `NULL` individuel ⇒ section correspondante absente, jamais un texte par défaut ni le contenu d'un autre athlète — `t11_technique.test.ts`/`t12_mental.test.ts` (étendus)
- Fallback générique, identique sur les 7 jours de la semaine, quel que soit l'athlète (plus de split personnel à Louis) — `t6_fallback.test.ts` (étendu)
- `ENGINE_VERSION` = `head-coach-engine@0.2.0-m1-v0.3_004a` — `engineVersion.test.ts` (valeur intermédiaire, remplacée par 004C)
- **Contrat d'exécution** : `head-coach-engine` unitaire (hors suite d'intégration Supabase) **233/233** ; edge **8/8** ; build PASS. Voir `docs/11_DECISION_LOG.md` (2026-09-04 — V0.3_004A).

### T20. Bootstrap athlète authentifié (V0.3_004B — CLOSED / PASS, 2026-09-04)
- `RequireAuth` rend `AthleteBootstrap` sur `no_athlete` — `RequireAuth.test.tsx` (étendu)
- Écriture réelle sous RLS `athletes_own_data` (jamais `service_role`), toujours suivie d'une re-résolution même après un insert échoué (course avec `UNIQUE(user_id)` légitimement gagnée par une autre tentative) — `AthleteBootstrap.test.tsx` (nouveau, 129 lignes), `athleteBootstrapRepo.integration.test.ts` (nouveau, 206 lignes, RLS réelle contre stack locale)
- Validation du nom avant tout appel réseau — `athleteBootstrapValidation` (couvert par `AthleteBootstrap.test.tsx`)
- Moteur `head-coach-engine` strictement inchangé — aucune régression T1-T19
- **Contrat d'exécution** : `web` **499 passed / 15 skipped** (514 total) ; build PASS. Voir `docs/11_DECISION_LOG.md` (2026-09-04 — V0.3_004B).

### T21. Contexte d'entraînement non configuré — UNSPECIFIED (V0.3_004C — CLOSED / PASS, 2026-09-04)
- `getModeSoftConstraints("UNSPECIFIED")` = `[]`, regroupé avec les modes neutres, jamais confondu avec un mode protecteur (`RACE_WEEK`/`INJURY_RECOVERY`) — `modesConstraints.test.ts` (étendu)
- E — `UNSPECIFIED` + checkin neutre + pas de plan + pas de course ⇒ plan valide, `RECOVERY_ACTIVE` — `t6_fallback.test.ts`
- F — `UNSPECIFIED` + `suspected_concussion` ⇒ `REST`, Safety reste seule autorité — `t6_fallback.test.ts`
- G — `UNSPECIFIED` + course en cours ⇒ le protocole de course garde le contrôle (`RACE_ACTIVITY`, jamais `RECOVERY_ACTIVE`, jamais une contrainte de mode) — `t6_fallback.test.ts`
- `NoCurrentTrainingBlockError` retirée ; mapping HTTP `no_current_training_block` retiré côté Edge et web — `errorMapping.test.ts`/`dailyRunErrors.test.ts` (allégés)
- `ENGINE_VERSION` = `head-coach-engine@0.2.0-m1-v0.3_004c` (valeur finale de V0.3_004) — `engineVersion.test.ts`
- **Contrat d'exécution** : `head-coach-engine` unitaire **233/233** ; edge **8/8** (un cas retiré avec `no_current_training_block`, contre 9/9 avant) ; `web` **499 passed / 15 skipped** ; builds PASS. Voir `docs/11_DECISION_LOG.md` (2026-09-04 — V0.3_004C).

### T22. Rollout production + preuve empirique à deux athlètes (V0.3_004D — CLOSED / PASS, 2026-09-04)
- Migrations 004A/004C déployées (`db push`), parité 28/28 avant/après/post-canary ; `athlete_coaching_profiles` (RLS + grants exacts) et `training_mode.UNSPECIFIED` vérifiés par SQL direct post-déploiement
- Profil réel de Louis peuplé et vérifié (identité résolue sans ambiguïté, upsert idempotent, exactement 1 ligne, deux chaînes exactes)
- `daily-run` redéployée (`ACTIVE`, version 3, `verify_jwt: true`), web redéployé (bundle réellement servi confirmé, 5 routes `HTTP 200`)
- **Canary production à deux utilisateurs authentifiés scratch, jamais `service_role` pour les chemins athlète** : bootstrap réel de chacun + preuve négative de bootstrap (forgerie cross-user rejetée, doublon rejeté) ; intentions Planning délibérément différentes (A=`AEROBIC_BASE`/`LIGHT`, B=`DH_TECHNICAL`/`MODERATE`) ; isolation Planning complète dans les deux sens (8 assertions) ; `daily-run` réel sous JWT de chacun — A confirme le chemin nominal, **B fournit la preuve zéro-bloc critique** (`training_blocks=0` avant/après, `active_mode="UNSPECIFIED"` en mémoire et persisté) ; **preuve anti-fuite** : chaînes exactes de Louis absentes des réponses d'A et de B, Technique actif chez B sans `focus` ; isolation historique dans les deux sens ; matrice négative additionnelle (profil de coaching, `training_blocks`, injection `athlete_id` HTTP → `400`) ; nettoyage complet + résidu zéro prouvé par comptage explicite, utilisateurs Auth confirmés absents
- Régression Louis : 7 comptages avant/après le canary, identiques bit à bit — seule mutation intentionnelle : `athlete_coaching_profiles` de Louis ; aucun `daily-run` exécuté pour Louis dans ce jalon
- Session complétée délibérément **SKIP** (aucune preuve supplémentaire pertinente ; suites locales déjà vertes)
- **Contrat d'exécution final** : chaque assertion du canary production PASS (aucune reprise nécessaire) ; migration parity 28/28 et `daily-run ACTIVE`/version 3 reconfirmés stables après le canary. Voir `docs/06_ARCHITECTURE.md` §V0.3_004D et `docs/11_DECISION_LOG.md` (2026-09-04 — V0.3_004D).

**V0.3_004 — contrat de test complet.**
