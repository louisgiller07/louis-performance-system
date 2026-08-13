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

## Ce qui n'est PAS testé en V0.2

- Persistance Supabase (V0.3)
- LLM couche E (V0.3+)
- UI (V0.3+)
- Intégrations externes (V1.0+)
- Domaine 7 avancé (patterns émergents)
- Planificateur hebdomadaire (V0.3+)
- ActiveExperiment runtime (T9, P1)
