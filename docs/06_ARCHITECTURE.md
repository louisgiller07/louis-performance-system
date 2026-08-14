# 06 — Architecture

## Vision technique

Une **librairie pure TypeScript** produit un `DailyPlan` à partir d'un `EngineContext`. Aucune dépendance runtime au monde extérieur (Supabase, LLM, UI, réseau) en V0.2.

Cette librairie sera ensuite exposée via une Edge Function Supabase, puis consommée par une UI.

---

## Pipeline canonique

```
1. RawContext            (entrée)
2. MultidimensionalAthleteState  (dimensions + contexte)
3. Safety                (couche A — hard)
4. Mode + Race/Event Context     (couche B — soft constraints)
5. Domain Decisions      (couche C par domaine)
6. Head Coach Arbitration        (KEEP/MODIFY/REPLACE/REST + cohérence)
7. DailyPlan JSON        (sortie)
```

Chaque étape est **une fonction pure testable indépendamment**.

---

## Découpage du code

### Structure du package `head-coach-engine/`

```
head-coach-engine/
├── src/
│   ├── types/           # types purs, pas de logique métier
│   ├── engine/          # computeState, buildDailyPlan, causalTrace, eventContext
│   ├── rules/           # couches A (safety) et B (modes, race protocol)
│   ├── domains/         # couches C par domaine (training, recovery, mental, ...)
│   ├── mapping/         # TrainingIntervention ↔ DbSessionType
│   └── cli/             # commandes de démonstration locale
├── tests/               # tests unitaires + intégration
├── fixtures/            # données de test réalistes (Louis)
├── package.json
├── tsconfig.json
└── tsconfig.build.json
```

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

### M2 — Connexion Supabase read/write locale

- Ajout d'un dossier `src/supabase/` (repositories + mapping + adapter + orchestration) qui :
  - lit les tables Supabase et construit un `RawContext` conforme au format M1
  - persiste le `DailyPlan` (source de vérité JSONB + projections dénormalisées) dans `decisions`
  - persiste de manière idempotente et atomique tout `health_flag_to_create` dans `health_flags`, dans la **même transaction PostgreSQL** que l'insertion `decisions`, via la fonction RPC `persist_daily_run`
- Migrations DB additives (`M2_001` à `M2_003`, `M2_004` conditionnel) — voir `docs/05_DATA_MODEL.md`
- Le moteur M1 (`src/{types,engine,rules,domains,mapping}`) est **frozen** et strictement inchangé
- Encore aucune UI, aucun LLM, aucune intégration externe

### M3 — API HTTP

- Edge Function Supabase exposant `runDailyFor` en HTTP
- Toujours pas d'UI, pas de LLM

### M4+ — UI et enrichissements

- Première UI de check-in (Today screen)
- LLM couche E (rédaction contextuelle) — reste optionnel
- Intégrations wearables (Zwift, Garmin, Strava)
- Planificateur hebdomadaire
- Interface mobile complète

---

## Adapter Supabase (M2 — actif)

Vit dans `src/supabase/`, strictement séparé du moteur M1 frozen.

### Découpage

- `src/supabase/client.ts` — construction du client Supabase depuis `SUPABASE_URL` + clé serveur (Secret Key Supabase actuelle préférée, fallback vers legacy `SUPABASE_SERVICE_ROLE_KEY` si le projet actuel l'utilise). Clé lue depuis l'environnement uniquement, jamais commitée. Client injecté par argument, pas de singleton global.
- `src/supabase/repositories/` — un fichier par table lue/écrite. Fonctions pures async, retournant des types domaine (jamais des types Supabase générés fuités hors du dossier). Aucune règle métier.
- `src/supabase/mapping/` — mapping `DailyPlan → decisions` row + mappings SQL row → types domaine (`DailyCheckin`, `HealthFlag`, `UpcomingRace`, `CompletedSessionSummary`, `TrainingIntervention`).
- `src/supabase/buildRawContext.ts` — construction complète de `RawContext` depuis Supabase. Aucune règle métier, uniquement de la traduction de forme. `active_experiments = []` explicite (pas de runtime en M2).
- `src/supabase/computeDailyFor.ts` — construit `RawContext`, appelle `buildDailyPlan`, retourne `{rawContext, dailyPlan}`. **Zéro écriture.**
- `src/supabase/runDailyFor.ts` — appelle `computeDailyFor`, invoque la RPC `persist_daily_run` qui exécute atomiquement l'upsert du health flag éventuel puis l'insert append-only de la décision. Retourne les identifiants.

### Traduction lecture Supabase → RawContext

```
Supabase read
  ├── daily_checkins → DailyCheckin
  │     └── rejet du checkin courant si pain_traumatic / pain_function_loss / pain_getting_worse = NULL
  ├── training_blocks (is_current) → active_mode + block context
  ├── planned_sessions
  │     ├── intervention JSONB si présent → TrainingIntervention riche
  │     ├── planned_intent TEXT si présent → RawContext.planned_intent (jamais inféré)
  │     └── intervention NULL → inversion partielle (voir §Fallback ci-dessous)
  ├── race_calendar (fenêtre pré + in-progress + post-event) → UpcomingRace[]
  ├── completed_sessions (7 derniers jours) → CompletedSessionSummary[]
  ├── weekly_availability → availability
  ├── health_flags (status IN 'active','monitoring') → active_health_flags: HealthFlag[]
  └── active_experiments = [] (pas de runtime M2)

→ RawContext → buildDailyPlan → DailyPlan

Supabase write (via RPC persist_daily_run, une seule transaction)
  ├── health_flags : upsert idempotent du health_flag_to_create éventuel
  └── decisions : insert append-only (daily_plan JSONB source de vérité +
                  active_mode + colonnes dénormalisées)
```

Le mapping `TrainingIntervention → DbSessionType` (voir `05_DATA_MODEL.md`) est appliqué à l'écriture pour remplir la colonne dénormalisée `final_session`.

### Contraintes canoniques

- L'adapter ne modifie **jamais** le moteur M1. Les dossiers `src/{types,engine,rules,domains,mapping}` sont frozen.
- Aucune règle métier dans les repositories, aucune règle métier dans `buildRawContext`, aucune règle de coaching dans la RPC PostgreSQL. Seul le moteur décide.
- `computeDailyFor` et `runDailyFor` sont deux opérations distinctes. Le "dry-run" est `computeDailyFor` — pas de flag `--dry-run` sur `runDailyFor`.

### Fallback d'intervention en lecture (règle stricte)

Une row `planned_sessions` sans `intervention JSONB` (row legacy antérieure à M2, ou saisie sans richesse) est traduite selon la table d'inversion partielle :

| `session_type` (DB) | Inversion appliquée | Raison |
|---|---|---|
| `REST` | `{ kind: "REST" }` | Fixed-load, mapping 1↔1 non ambigu |
| `BIKE_MAINTENANCE` | `{ kind: "BIKE_MAINTENANCE" }` | Fixed-load, mapping 1↔1 non ambigu |
| `RACE_PREP` | `{ kind: "RACE_ACTIVITY" }` | Fixed-load, mapping 1↔1 non ambigu |
| `STRENGTH_A` | `planned_session = null` + warning | Ambigu (`STRENGTH_LOWER` HEAVY/MODERATE, `STRENGTH_UPPER` HEAVY, `POWER` HEAVY, `GRIP_WORK` HEAVY) |
| `STRENGTH_B` | `planned_session = null` + warning | Ambigu (7+ combinaisons possibles) |
| `AEROBIC_BASE` | `planned_session = null` + warning | Kind connu mais `load_profile` inconnu |
| `AEROBIC_INTERVALS` | `planned_session = null` + warning | Idem |
| `DH_TECHNICAL` | `planned_session = null` + warning | Ambigu (`DH_TECHNICAL` ou `PUMPTRACK`) |
| `DH_PERFORMANCE` | `planned_session = null` + warning | Kind connu mais `load_profile` inconnu |
| `RECOVERY` | `planned_session = null` + warning | Ambigu (`DH_LIGHT`, `MOBILITY`, `RECOVERY_ACTIVE`) |

Comportement moteur si `planned_session = null` : fallback M1 T6.1 (inférence depuis le contexte). Déjà couvert par les tests M1. **Aucune reconstruction inventée du `kind` ou du `load_profile`.**

Symétriquement pour `completed_sessions` : sans `intervention` récupérable (ni JSONB `intervention`, ni `main_content` canonique, ni couvert par l'inversion non ambiguë), la session ne contribue pas à `recent_load` avec la granularité `load_profile`. Aucune donnée inventée.

### Persistance idempotente + atomique (RPC `persist_daily_run`)

Fonction PostgreSQL / RPC créée par migration M2. Signature indicative (nom des champs à ajuster selon DDL réel de `health_flags` audité en début de M2) :

```
persist_daily_run(
  p_athlete_id     uuid,
  p_health_flag    jsonb,          -- null si pas de health_flag_to_create
  p_decision_row   jsonb           -- row decisions à insérer (append)
) RETURNS jsonb                    -- { health_flag_id?, decision_id }
```

Comportement, dans une seule transaction :

1. Si `p_health_flag` non null : `INSERT INTO health_flags ... ON CONFLICT (…) DO NOTHING` en s'appuyant sur la **contrainte / index unique partiel** couvrant `(athlete_id, type)` filtré sur `status IN ('active','monitoring')`. L'idempotence est garantie côté PostgreSQL, pas seulement par un SELECT-then-INSERT applicatif.
2. `INSERT INTO decisions (...)` avec la row fournie (append-only, aucune contrainte d'unicité `(athlete_id, decision_date)`).
3. `COMMIT`. Si (1) ou (2) échoue → rollback complet, rien n'est persisté.

**Aucune logique de coaching côté SQL.** La RPC est un pur enregistreur transactionnel. Toute décision reste dans le moteur TypeScript.

### Stratégie tests d'intégration M2

- **Supabase CLI local** pour héberger l'instance de test (Postgres + auth + storage bundlés).
- **Migrations versionnées** (`supabase/migrations/M2_*.sql`) appliquées automatiquement au démarrage de l'instance de test.
- **Seed reproductible** (`supabase/seed.sql` ou script TypeScript) contenant Louis + scénarios canoniques M1 transposés en rows SQL.
- Chaque test intégration part d'un état DB déterministe (reset + seed avant chaque suite).

### Mapping TrainingIntervention ↔ DbSessionType

Le mapping vit dans `src/mapping/`. Il implémente la fonction pure déterministe définie dans `05_DATA_MODEL.md`.

Contraintes canoniques :
- Fonction pure, sortie unique pour tout `(kind, load_profile)` valide
- Aucune décision de coaching dans cette couche — mapping seulement
- Testée par un test unitaire par ligne du tableau canonique

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

---

## Contraintes canoniques

### Moteur M1 (frozen)

- **Aucune dépendance externe** dans `src/{types,engine,rules,domains,mapping}`
- Fonctions pures par défaut
- Traçabilité des signaux consommés (implémentation libre, tests obligatoires)
- Séparation `TrainingIntervention` interne ↔ `DbSessionType` persistance
- Mapping déterministe : pour tout `(kind, load_profile)` valide → sortie unique
- Aucun couplage avec Supabase, LLM ou UI au niveau du moteur
- TypeScript strict
- Tests déterministes
- **Frozen depuis 2026-08-13 (verdict M1 APPROVED). Ne pas modifier sans nouvelle décision architecte tracée dans `11_DECISION_LOG.md`.**

### Adapter M2 (`src/supabase/`)

- Aucune règle métier (repositories, `buildRawContext`, RPC PostgreSQL inclus)
- Aucune donnée historique fabriquée : legacy → `NULL` ou fallback documenté, jamais reconstruit
- Inversion `DbSessionType → TrainingIntervention` limitée aux mappings mathématiquement non ambigus
- Écriture atomique : health flag + décision dans une seule transaction PostgreSQL (RPC `persist_daily_run`)
- `decisions` append-only, aucune contrainte unique sur `(athlete_id, decision_date)`
- Idempotence health flag garantie côté PostgreSQL (contrainte / index unique partiel), pas seulement applicatif
- Clé serveur uniquement, lue depuis env, jamais commitée
