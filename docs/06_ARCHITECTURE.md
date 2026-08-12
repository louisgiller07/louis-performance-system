# 06 — Architecture

## Vision technique

Une **librairie pure TypeScript** produit un `DailyPlan` à partir d'un `EngineContext`. Aucune dépendance runtime au monde extérieur (Supabase, LLM, UI, réseau) en V0.2.

Cette librairie sera ensuite exposée via une Edge Function Supabase, puis consommée par une UI.

---

## Pipeline canonique
RawContext (entrée)
MultidimensionalAthleteState (dimensions + contexte)
Safety (couche A — hard)
Mode + Race/Event Context (couche B — soft constraints)
Domain Decisions (couche C par domaine)
Head Coach Arbitration (KEEP/MODIFY/REPLACE/REST + cohérence)
DailyPlan JSON (sortie)

Chaque étape est **une fonction pure testable indépendamment**.

---

## Découpage du code

### Structure du package `head-coach-engine/`

head-coach-engine/
├── src/
│ ├── types/ # types purs, pas de logique métier
│ ├── engine/ # computeState, buildDailyPlan, causalTrace, eventContext
│ ├── rules/ # couches A (safety) et B (modes, race protocol)
│ ├── domains/ # couches C par domaine (training, recovery, mental, ...)
│ ├── mapping/ # TrainingIntervention ↔ DbSessionType
│ └── cli/ # commandes de démonstration locale
├── tests/ # tests unitaires + intégration
├── fixtures/ # données de test réalistes (Louis)
├── package.json
├── tsconfig.json
└── tsconfig.build.json


### Séparation stricte

- `types/` : types purs, aucun code exécutable métier
- `engine/` : orchestration + calculs d'état + traçabilité
- `rules/` : règles de couches A et B
- `domains/` : décisions par domaine (couche C)
- `mapping/` : mapping `TrainingIntervention` ↔ `DbSessionType`
- `cli/` : démonstration locale sans dépendance externe

---

## Principes de conception

### Fonctions pures par défaut

Chaque règle, chaque calcul de dimension, chaque décision de domaine est une **fonction pure** : `(input, state) → output`, sans effet de bord.

### Traçabilité des signaux consommés

Le moteur doit tracer quels signaux ont déjà influencé la décision, pour empêcher le double-counting.

**Implémentation libre.** Options possibles :
- Structure mutable partagée passée en argument
- Structure immuable retournée à chaque étape et propagée
- Closure encapsulée par l'orchestrateur

Le seul critère : les tests de non-double-counting doivent passer, et le code doit rester lisible.

### Pas de dépendance externe en V0.2

Aucun appel HTTP, aucun accès DB, aucun LLM, aucun fichier système au runtime en V0.2. La librairie doit fonctionner :
- en Node local
- en Edge Function
- éventuellement en navigateur plus tard

### TypeScript strict

- `strict: true`, `noImplicitAny`, `strictNullChecks`
- Pas de `any` sans justification en commentaire
- Types nommés préférés aux types anonymes

---

## Runtime cible et évolution

### V0.2 — Librairie pure locale

- Node LTS actuel (24.x en 2026)
- TypeScript strict
- Vitest pour tests
- CLI de démonstration : `npm run run:example <scenario>`
- Aucune connexion externe

### V0.3 — Connexion Supabase read-only

- Ajout d'une couche `adapter/` qui traduit :
  - lecture des tables Supabase → `EngineContext`
  - écriture du `DailyPlan` → `decisions.daily_plan` JSONB
- Encore aucune UI, aucun LLM

### v1.0 — API + UI

- Edge Function Supabase exposant le moteur en HTTP
- Première UI de check-in (Today screen)
- Toujours pas de LLM en couche E — reste optionnel

### V2.0+ — Enrichissements

- LLM comme couche E (rédaction contextuelle)
- Intégrations wearables (Zwift, Garmin, Strava)
- Planificateur hebdomadaire (V0.3+)
- Interface mobile complète

---

## Adapter Supabase (V0.3, pas maintenant)

Quand la vertical slice sera validée, un adapter fera la traduction :

Supabase read
├── daily_checkins → DailyCheckin
├── training_blocks (is_current) → active_mode + block context
├── planned_sessions → planned_session (DbSessionType)
├── race_calendar (upcoming + recent post-event) → UpcomingRace[]
├── completed_sessions (7 derniers jours) → CompletedSession[]
├── weekly_availability → availability
├── athlete_baselines (is_current) → baseline
└── active_experiments (à créer V0.3) → ActiveExperiment[]

→ EngineContext → buildDailyPlan → DailyPlan

Supabase write
└── decisions (final_session mapped to DbSessionType + daily_plan JSONB)


Le mapping `TrainingIntervention → DbSessionType` (voir `05_DATA_MODEL.md`) est appliqué à l'écriture uniquement.

---

## Stratégie de test

### Tests unitaires

- Chaque règle testée isolément
- Chaque calcul de dimension testé avec fixtures Louis
- Aucun test avec sorties alternatives (`toContain([A, B])` interdit)

### Tests d'intégration

- Pipeline complet `EngineContext → DailyPlan` avec fixtures Louis
- Scénarios canoniques du `10_TEST_PLAN.md`
- Chaque test = une sortie attendue déterministe

### Fixtures

- Fixtures Louis réalistes basées sur `02_ATHLETE_PROFILE.md`
- Aucune donnée inventée
- Fixtures partagées via `fixtures/louis.ts`

### CLI de démonstration

`npm run run:example <scenario>` doit afficher un `DailyPlan` JSON pour chaque scénario de fixture. Utile pour la review humaine.
### Mapping TrainingIntervention ↔ DbSessionType

Le mapping vit dans `src/mapping/`. Il implémente la fonction pure déterministe définie dans `05_DATA_MODEL.md`.

Contraintes canoniques :
- Fonction pure, sortie unique pour tout `(kind, load_profile)` valide
- Aucune décision de coaching dans cette couche — mapping seulement
- Testée par un test unitaire par ligne du tableau canonique


---

## Contraintes canoniques

- Aucune dépendance externe en V0.2
- Fonctions pures par défaut
- Traçabilité des signaux consommés (implémentation libre, tests obligatoires)
- Séparation `TrainingIntervention` interne ↔ `DbSessionType` persistance
- Aucun couplage avec Supabase, LLM ou UI au niveau du moteur core
- TypeScript strict
- Tests déterministes