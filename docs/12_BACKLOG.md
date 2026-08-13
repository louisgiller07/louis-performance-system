# 12 — Backlog

## Statut actuel

**Phase** : Bootstrap repository + export des documents canoniques
**Prochain milestone** : M1 — Vertical Slice locale du Head Coach Engine

---

## P0 — Requis pour Vertical Slice locale

### Bootstrap repository

- [x] Repository GitHub créé (`louisgiller07/louis-performance-system`)
- [ ] Push CLAUDE.md et 12 docs canoniques (les 13 fichiers listés)

### Head Coach Engine vertical slice

- [ ] Initialiser `head-coach-engine/` avec Node LTS 24 + TypeScript strict + Vitest
- [ ] `tsconfig.json` (base) + `tsconfig.build.json` (build src uniquement)
- [ ] Structure de dossiers : `src/{types,engine,rules,domains,mapping,cli}`, `tests/`, `fixtures/`
- [ ] Types de base : `EngineContext`, `AthleteDimensions`, `ContextState`, `DailyPlan`, `TrainingIntervention` (avec `kind` + `load_profile`), `DbSessionType`
- [ ] Calcul des 6 dimensions individuelles
- [ ] Calcul du `global_readiness_ui` (UI seulement)
- [ ] Traçabilité des signaux consommés (implémentation libre)
- [ ] Couche A — SAFETY rules (5 règles canoniques A1-A5)
- [ ] Couche B — Modes opérationnels + Event context (pre/in-progress/post)
- [ ] Couche B — Race protocol T-X (HOT_TRAIL_2DAY + IXS_3DAY)
- [ ] Couche C — Domaine Training (KEEP/MODIFY/REPLACE)
- [ ] Couche C — Domaine Recovery
- [ ] Head Coach arbitration (KEEP/MODIFY/REPLACE/REST + cohérence)
- [ ] Mapping `TrainingIntervention` ↔ `DbSessionType` (fonction pure déterministe)
- [ ] Assembleur `buildDailyPlan()`
- [ ] Fixtures Louis réalistes (à partir de `02_ATHLETE_PROFILE.md`)
- [ ] Tests unitaires par règle et par dimension
- [ ] Tests d'intégration canoniques (T1-T8 + T10 de `10_TEST_PLAN.md`)
- [ ] CLI `npm run run:example <scenario>`
- [ ] `npm run build` sans erreur

### Validation M1

- [ ] Tous les tests T1-T8 + T10 passent (déterministes)
- [ ] Build strict sans erreur
- [ ] CLI produit un `DailyPlan` cohérent pour chaque scénario
- [ ] Review Louis
- [ ] Update `00_PROJECT_STATUS.md` avec M1 DONE
- [ ] Décision Go/No-Go pour M2

---

## P1 — Après M1

### Domaine training enrichi
- Domaine Mental (couche C basique)
- Domaine Nutrition (couche C basique)
- Domaine Contexte pro (couche C basique)
- Domaine Analyse (couche C basique, quasi-passif)

### Experiments (T9)
- Concept `ActiveExperiment` runtime
- Support de l'experiment `sleep-liquids-cutoff-2026-08`
- Tests T9.1 et T9.2 passent

### Requis avant connexion Supabase runtime (à trancher en début de M2)
- [ ] Décider et documenter dans `11_DECISION_LOG.md` : Option A (colonnes dédiées) ou Option B (JSONB / table dédiée) pour persister `pain_traumatic`, `pain_function_loss`, `pain_getting_worse`
- [ ] Appliquer la migration additive correspondante
- [ ] Adapter Supabase construit `active_health_flags: HealthFlag[]` à partir de `health_flags`, pas un simple count
- [ ] Vérifier que la sémantique M1 (fixtures) et M2 (Supabase) est identique pour ces champs

### Connexion Supabase read-only (M2)
- Adapter Supabase → EngineContext
- Lecture des tables : `athletes`, `daily_checkins`, `training_blocks`, `planned_sessions`, `race_calendar`, `completed_sessions`, `weekly_availability`, `athlete_baselines`, `health_flags`
- Client Supabase en variable d'env
- Tests d'intégration avec DB réelle (dry-run, pas d'écriture)

### Écriture des decisions (M3)
- Migration additive : ajouter `decisions.daily_plan JSONB` et `decisions.active_mode`
- Adapter DailyPlan → row `decisions`
- Mapping `TrainingIntervention` → `DbSessionType` appliqué à l'écriture
- Traçabilité complète : `triggered_rules`, `override_reason`

### API et UI (M4+)
- Edge Function Supabase exposant le moteur
- Endpoint check-in (POST daily_checkin + trigger recompute)
- Endpoint récupération DailyPlan du jour
- Première UI Today screen

---

## P2 — Enrichissements ultérieurs
- LLM couche E pour rédaction contextuelle
- Planificateur hebdomadaire (`planned_sessions` généré automatiquement)
- Debrief course post-mortem structuré
- Intégration Zwift (FTP + puissance)
- Intégration Garmin (FC + sommeil détaillé)
- Interface app mobile complète
- Table `active_experiments` en base
- Table `learned_patterns` en base (couche D)
- Premiers patterns confirmés après données longitudinales
- Domaine 7 Analyse enrichi (patterns émergents)

---

## Hors périmètre (canonique)
- Suivi setup / mécanique vélo → Louis gère en autonomie
- Sponsoring / management de carrière
- Multi-athlètes
- Business / SaaS
- Analyse vidéo automatique
- Prédictions précises de temps de course
- Coach mental "profond" avec analyse émotionnelle complexe
- Coach nutrition avec tracking exhaustif

Voir `01_PRODUCT_REQUIREMENTS.md` §Hors périmètre.
