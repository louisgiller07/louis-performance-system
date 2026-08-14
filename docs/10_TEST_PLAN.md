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
