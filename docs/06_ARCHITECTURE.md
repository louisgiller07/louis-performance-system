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
  - persiste de manière idempotente et atomique tout `health_flag_to_create` dans `health_flags`, dans le même appel de la fonction PostgreSQL `persist_daily_run` (transaction unique implicite) que l'insertion `decisions`
- Migrations DB additives : baseline V0.2 + `M2_001` à `M2_006` (dont `M2_004` REQUIRED) — voir `docs/05_DATA_MODEL.md`
- Le moteur M1 (`src/{types,engine,rules,domains,mapping}`) est **frozen** et strictement inchangé
- Encore aucune UI, aucun LLM, aucune intégration externe

### M3 — API HTTP

- Edge Function `supabase/functions/daily-run` (DONE local + remote, 2026-08-18) :
  `Authorization: Bearer <JWT>` → `@supabase/server@1.4.1` (`withSupabase({auth:"user"})`)
  → `ctx.supabase`/RLS `athletes_own_data` → athlete propre (jamais body/query)
  → `ctx.supabaseAdmin` → `runDailyFor(admin, athlete.id, date)` (appelé une fois)
  → `{dailyPlan, decisionId, healthFlagId, warnings}` (200) ou erreur mappée (400/403/405/422/500)
- **Frontière de build** : `npm run build` → `head-coach-engine/dist/*.js` (gitignored,
  généré à la demande) → import Deno. Jamais la source `.ts` M1/M2 (résolution littérale
  Deno incompatible avec la convention `.js`-suffixe→`.ts`, prouvé M3_001).
- **Séparation des tests** : `npm test` (suite historique, dist-indépendante) /
  `npm run test:edge` (build + mapping d'erreurs, dépend de `dist/`) /
  `npm run test:m3:http` (E2E réel : build + Edge Runtime local + DB locale).
- **Error mapping** (`supabase/functions/daily-run/errorMapping.ts`, aucune logique
  métier/M1/persistance) :
  - `NoCurrentCheckinError` → 422 `no_checkin_for_date`
  - `NoCurrentTrainingBlockError` → 422 `no_current_training_block`
  - `IncompleteCheckinPainCriteriaError` → 422 `pain_criteria_missing`
  - `IncompleteDailyCheckinError` → 422 `checkin_incomplete`
  - `PersistDailyRunRpcError` → 500 `persistence_failed`
  - erreurs invalides/invariant cassé/imprévues → 500 `internal_error`
- **Remote : DONE, prouvé sur `uvolpldwwyvadlamulvr`** (M3_005 canary + M3_006 run réel) :
  - `--use-api` packaging de l'import externe `head-coach-engine/dist/**` (gitignored,
    hors `supabase/functions/`) **proven** : le CLI bundle automatiquement tout le
    graphe transitif compilé, sans copie manuelle ni duplication du moteur.
  - `daily-run` **ACTIVE** sur le projet remote, `verify_jwt: true` (comportement par
    défaut du gateway conservé, jamais désactivé pour cette fonction).
  - Exécution authentifiée remote **proven** : JWT utilisateur réel → gateway →
    `withSupabase({auth:"user"})` → `ctx.supabase`/RLS → athlete propre → `ctx.supabaseAdmin`
    → `runDailyFor` → `persist_daily_run`.
  - Résolution RLS de l'athlete propre **proven** sur le remote (même mécanisme qu'en
    local, aucun `athlete_id` client).
  - Persistance réelle de la decision **proven** : `200` avec `dailyPlan` réel,
    `decisionId` correspondant exactement à la row `decisions` créée, `daily_plan`
    DB deep-equal à la réponse HTTP, `confidence` legacy `NULL`, `confidence_level`
    renseigné.
- **Workflow de déploiement validé** :
  ```
  cd head-coach-engine
  npm run deploy:daily-run
  ```
  soit `npm run build` (compile `dist/`) → Supabase CLI invoqué avec `--workdir ..`
  (résout `supabase/config.toml` depuis `head-coach-engine/`) → `--use-api` (bundling
  serveur, sans Docker) → `--project-ref uvolpldwwyvadlamulvr` explicite (jamais le
  linked project implicite).
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
  ├── health_flags (status IN 'active','monitoring', colonne réelle flag_type mappée vers HealthFlag.type) → active_health_flags: HealthFlag[]
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

Fonction PostgreSQL créée par migration `M2_006`, invoquée via RPC Supabase. Signature (colonne discriminante réelle `flag_type` confirmée par audit DDL 2026-08-14) :

```
persist_daily_run(
  p_athlete_id     uuid,
  p_health_flag    jsonb,          -- null si pas de health_flag_to_create ;
                                   -- doit contenir au minimum { flag_type, status }
  p_decision_row   jsonb           -- row decisions à insérer (append)
) RETURNS jsonb                    -- { health_flag_id?, decision_id }
```

Comportement du corps de la fonction (deux écritures dans le même appel) :

1. Si `p_health_flag` non null : `INSERT INTO health_flags ... ON CONFLICT DO NOTHING` en s'appuyant sur l'**index unique partiel** de `M2_005` couvrant `(athlete_id, flag_type)` filtré sur `status IN ('active','monitoring')`. L'idempotence est garantie côté PostgreSQL, pas seulement par un SELECT-then-INSERT applicatif.
2. `INSERT INTO decisions (...)` avec la row fournie (append-only, aucune contrainte d'unicité `(athlete_id, decision_date)`). La row contient les colonnes M2 (`daily_plan`, `active_mode`, `confidence_level`) et les projections dénormalisées. La colonne legacy `confidence numeric(3,2)` n'est pas remplie (reste `NULL`). `overridden_by_user` prend son default DB (`false`).
3. La fonction retourne `{ health_flag_id?, decision_id }` si les deux écritures ont réussi.

**Contrat transactionnel** : les deux écritures sont réalisées dans le même appel de fonction PostgreSQL, qui s'exécute intrinsèquement dans une transaction unique. Aucun `COMMIT` ni `ROLLBACK` explicite n'est utilisé dans le corps (invalide dans une `FUNCTION` — seules les `PROCEDURE` PostgreSQL peuvent gérer explicitement leurs transactions). Toute erreur non capturée fait échouer l'appel et **annule les écritures de cet appel**.

**Sécurité (contrat M2)** :
- `SECURITY INVOKER` (pas `SECURITY DEFINER`) — la fonction s'exécute avec les droits du rôle appelant.
- Aucune exposition à `PUBLIC`, `anon` ou `authenticated`.
- `EXECUTE` accordé uniquement au rôle serveur utilisé par M2 (`service_role` ou équivalent serveur validé lors de l'implémentation).
- **Jamais appelable directement depuis une future UI cliente sans nouvelle décision architecte tracée dans `11_DECISION_LOG.md`.**

**Aucune logique de coaching côté SQL.** La RPC est un pur enregistreur transactionnel. Toute décision reste dans le moteur TypeScript.

### Baseline read-only et stratégie tests d'intégration M2

**Baseline V0.2 (capture initiale)** :
- Fichier `supabase/migrations/20260814095000_baseline_v0_2.sql` (timestamp réel de capture, 2026-08-14 09:50:00 UTC, antérieur à toute migration M2 dans l'ordre lexicographique), produit par `supabase db dump --linked --schema public` depuis la DB Louis distante.
- **Strictement read-only** : versionné dans le repo pour référence factuelle et reconstruction locale, mais **jamais réédité manuellement** et **jamais poussé** via `db push`. Représente l'état existant de la DB au moment où M2 commence.
- Choix de `db dump --linked` plutôt que `db pull` : `db pull` peut générer une migration depuis le schéma distant et peut également proposer une synchronisation de l'historique de migrations distant. Nous choisissons `db dump --linked` pour garder la capture initiale strictement read-only vis-à-vis du schéma **et** de l'historique remote — aucune écriture, aucune synchronisation, aucun effet de bord côté DB Louis.
- Toutes les migrations M2 (`M2_001` à `M2_006`) portent des timestamps strictement postérieurs à celui de la baseline dans leur nom de fichier.

**Application locale** :
- `supabase start` lance une instance Postgres locale.
- La baseline puis les migrations M2 sont appliquées dans l'ordre par la CLI.
- Seed reproductible (`supabase/seed.sql` ou script TypeScript) contenant Louis + scénarios canoniques M1 transposés en rows SQL.
- Chaque suite de tests part d'un état DB déterministe (reset + seed).

**Déploiement remote (une seule fois, hors développement)** :
- Avant le premier `supabase db push` M2 vers la DB Louis, la baseline V0.2 doit être marquée comme **déjà appliquée** dans l'historique de migrations distant (via `supabase migration repair` ou méthode équivalente), afin qu'elle ne soit jamais rejouée sur le schéma existant.
- **Aucun `db push`, aucun `migration repair`, aucune modification remote** pendant tout le développement local.

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
- Écriture atomique : health flag + décision dans le même appel de la fonction PostgreSQL `persist_daily_run` (transaction unique implicite)
- `decisions` append-only, aucune contrainte unique sur `(athlete_id, decision_date)`
- Idempotence health flag garantie côté PostgreSQL (index unique partiel sur `(athlete_id, flag_type)`), pas seulement applicatif
- Clé serveur uniquement, lue depuis env, jamais commitée
- Baseline V0.2 strictement read-only : jamais rééditée, jamais poussée, jamais rejouée. Marquée comme appliquée dans l'historique remote une seule fois, hors développement, uniquement après revue Louis.
- Confidence : nouvelle colonne `decisions.confidence_level` (enum `LOW|MEDIUM|HIGH`) écrite par le DAL pour toute décision M2. Colonne legacy `decisions.confidence` (numeric) jamais écrite par M2.
- `overridden_by_user` conserve son default DB (`false`) — jamais renseigné par M2.
- RPC `persist_daily_run` : `SECURITY INVOKER`, `EXECUTE` réservé au rôle serveur M2, jamais exposée à `PUBLIC`/`anon`/`authenticated`.

---

## V0.3_001 — Longitudinal Intelligence Runtime (ARCHITECTURE V0.3_001 LOCKED ; V0.3_001A CLOSED LOCALLY, V0.3_001B CLOSED REMOTE — 2026-08-28 ; V0.3_001C NON COMMENCÉ)

**Statut : ARCHITECTURE V0.3_001 LOCKED — V0.3_001A CLOSED LOCALLY, V0.3_001B CLOSED REMOTE (2026-08-28), V0.3_001C NOT STARTED.** Cette section documente une décision d'architecture approuvée avant implémentation ; le runtime couvert par V0.3_001A/B est désormais mis en œuvre et vérifié en remote (voir `docs/11_DECISION_LOG.md` pour l'historique complet de la revue et les entrées de clôture V0.3_001A/V0.3_001B). **Les briques M5 sous-jacentes existent déjà selon leur statut canonique** (calculateur d'outcomes + RPC `persist_decision_outcome` déployés depuis M5_001B/M5_004 ; ledger d'evidence append-only déployé depuis M5_006A ; cycle de vie actif/retiré + ses RPC/vues déployés depuis M5_006B ; agrégation déterministe M5_006D et projecteur d'insight déterministe M5_007 implémentés/testés en TypeScript pur dans `longitudinal-engine`, sans migration ni déploiement propre ; ledger de revue humaine + son RPC + ses vues déployés depuis M5_007). **V0.3_001A a été implémenté et testé localement** (orchestrateur opérationnel, `refresh-longitudinal`, `get-insights`, correction du détecteur recommendation-vs-actual) **puis V0.3_001B a déployé ce même runtime sur `uvolpldwwyvadlamulvr` et vérifié en remote un premier backfill ainsi qu'une preuve d'idempotence** — voir `docs/11_DECISION_LOG.md` (entrées de clôture 2026-08-28) pour le détail complet. **Aucune API `submit-review`, aucune UI Insights n'existent à ce jour** (V0.3_001C, non commencé).

### Objectif produit

Rendre utilisable le pipeline M5 déjà construit :

```
données athlète réelles
  -> outcomes de décision (déterministe, M5_004, déjà déployé)
  -> détecteurs (déterministe, M5_005/M5_006B/M5_006C, purs TypeScript)
  -> evidence append-only/révisionnée (M5_006A, déjà déployé)
  -> cycle de vie actif/retiré (M5_006B, déjà déployé)
  -> pattern_evidence_current_effective (M5_006B, déjà déployé)
  -> agrégation déterministe (M5_006D, pur TypeScript, non déployé en soi)
  -> candidat d'insight déterministe (M5_007, pur TypeScript)
  -> revue humaine (M5_007, ledger déjà déployé)
```

**S'arrête strictement là.** Interdits explicites : insight → `daily-run`, revue → `daily-run`, `accepted_as_insight` → activation de coaching, personnalisation automatique par pattern appris, score de confiance/signification, causalité, autorité décisionnelle LLM. Safety A1-A5 inchangée. Le comportement de décision quotidienne M1-M4 reste frozen — `daily-run` n'est pas modifié.

### Modèle de dates/plages — quatre concepts strictement séparés (implémenté, V0.3_001A)

L'implémentation a révélé une contrainte de performance critique, absente du verrouillage initial : `buildTimeline` (M5_002B, inchangé) matérialise **un `AthleteDay` par date calendaire** de la plage qui lui est fournie — contrairement à `aggregateEffectivePatternEvidence` (M5_006D), qui ne fait qu'une validation O(1) de la plage sans énumération. Passer `1900-01-01..9999-12-31` à `buildTimeline` tenterait de matérialiser environ 2,9 millions de jours. **`INSIGHT_AGGREGATION_RANGE` ne doit donc jamais être transmise à `buildTimeline`.** Quatre concepts de plage/date distincts en découlent :

**A. `INSIGHT_AGGREGATION_RANGE`** — constante de domaine **statique et immuable** :
```
INSIGHT_AGGREGATION_RANGE = { fromDate: "1900-01-01", toDate: "9999-12-31" }
```
Jamais dérivée de l'horloge (ni navigateur, ni serveur), jamais de la date de migration, jamais d'une date de carrière athlète. Utilisée **uniquement** pour : les bornes de lecture d'evidence effective (`pattern_evidence_current_effective`, un simple filtre `WHERE` sur des lignes réelles — Postgres ne matérialise ici que les lignes existantes, jamais de dates), `aggregateEffectivePatternEvidence`, `PatternInsightSnapshot.rangeFromDate`/`rangeToDate`, et l'empreinte de fraîcheur de revue. Choisie précisément pour que cette empreinte reste stable tant que l'evidence ne change pas — une plage glissante ou basée sur "aujourd'hui" ferait passer une revue acceptée en `reviewed_stale` chaque jour sans aucun changement de contenu. `1900` évite la zone de traitement spéciale des années 0-99 par `Date.UTC` ; `9999` est le maximum représentable par le parseur `YYYY-MM-DD` à 4 chiffres déjà verrouillé par M5_006D. `aggregateEffectivePatternEvidence.ts` lui-même n'est **pas modifié** — cette politique vit dans la couche runtime/produit qui fournit la plage explicite à l'appel.

**B. `LONGITUDINAL_PROCESSING_DATE`** — date calendaire courante, **côté serveur uniquement**, fuseau produit V1 fixe `Europe/Zurich` (aucun champ fuseau par athlète n'existe dans le schéma — limitation V1 explicite). Utilisée pour : la maturité des outcomes (J+1/J+3/J+7, `calculateAndPersistOutcomes`), la borne supérieure de la requête source, et la borne supérieure de la timeline. N'entre **jamais** dans `PatternInsightSnapshot`, dans l'empreinte de fraîcheur d'une revue, ni dans aucune identité de candidat.

**C. `LONGITUDINAL_SOURCE_QUERY_RANGE`** — `{fromDate: "1900-01-01", toDate: longitudinalProcessingDate}`. Bornes de filtre `WHERE .gte()/.lte()` uniquement, passées aux 5 lectures de l'adaptateur source — Postgres ne retourne que les lignes réellement présentes, **aucune matérialisation de date**. La borne supérieure à `longitudinalProcessingDate` exclut structurellement toute ligne source datée dans le futur, sans filtre applicatif séparé.

**D. `LONGITUDINAL_TIMELINE_RANGE`** — intervalle compact réellement transmis à `buildTimeline`, jamais `INSIGHT_AGGREGATION_RANGE`. Dérivation canonique implémentée :
```
timelineToDate = longitudinalProcessingDate

maxLookbackDays = max(
  SLEEP_ENERGY_BASELINE_WINDOW_DAYS,   // 60
  PAIN_PERSISTENCE_LOOKBACK_DAYS       // 3
)

timelineFromDate = max(
  earliestRealSourceDate - maxLookbackDays jours,
  DOMAIN_HISTORY_FLOOR_DATE  // "1900-01-01"
)
```
`earliestRealSourceDate` est la date minimale réellement présente parmi les 5 pools sources chargés via `LONGITUDINAL_SOURCE_QUERY_RANGE`. La marge de lookback est nécessaire car `sleep_quality_to_same_day_energy_correlation` et `pain_persistence_across_recent_checkins` exigent structurellement que `timeline.range.fromDate` couvre respectivement 60 et 3 jours avant chaque unité d'évaluation — sans cette marge, la toute première unité d'évaluation de l'historique d'un athlète échoue systématiquement (`InsufficientTimelineCoverageError`), y compris quand aucune détection réelle n'est requise en amont de cette date. Si aucune ligne source réelle n'existe, `timelineRange = {processingDate, processingDate}` (aucune marge appliquée sur un historique vide). Les lignes sources datées dans le futur sont exclues par construction via la borne supérieure de C, jamais par un filtre applicatif séparé. `buildTimeline` lui-même n'est **pas modifié** et la sémantique des détecteurs (matrice supporting/neutral/contradicting, fenêtres de lookback) reste inchangée.

### Correction de persistance — détecteur `recommendation_vs_actual_execution@1.0.0`

Avant opérationnalisation, l'identité de persistance de ce détecteur doit être corrigée : `evaluationKey = evidenceKey = decision:<decisionId>` (au lieu de l'actuel `decision:<id>:completion:<completedSessionId>`, irreproductible quand `no_evidence` se déclenche puisque `completedSessionId` n'existe pas dans cette branche). `no_evidence` doit alors déclencher un retrait via `transition_pattern_evidence_lifecycle` (`reason_code = detection.reason`, `context = {}`), exactement comme `sleepEnergyAdapter`/`painPersistenceAdapter` le font déjà — aucune logique de cycle de vie dupliquée, aucun `SELECT`-puis-transition côté application. `detector_rule_version` reste `1.0.0` (sémantique de classification inchangée), **sous précondition stricte** : une vérification remote read-only doit confirmer `pattern_evidence_identities` count = 0 pour `(recommendation_vs_actual_execution, 1.0.0)` avant tout changement de code — si le compte est non nul, arrêt, décision d'architecture/versionnement à reprendre, aucune réécriture de ligne historique. Aucune migration requise (`transition_pattern_evidence_lifecycle` existe déjà, générique, déployée depuis M5_006B). **Cette correction a été implémentée et testée localement en V0.3_001A (2026-08-28), puis déployée et vérifiée en remote en V0.3_001B (2026-08-28, même jour)** — `detector_rule_version` reste `1.0.0`, aucune réécriture de ligne historique n'a jamais eu lieu. La précondition a été confirmée immédiatement avant le changement de code (V0.3_001A), reconfirmée à la clôture V0.3_001A par requête SQL directe (jointure relationnelle sur `pattern_evidence_identities`/`_revisions`/`_source_refs`/`_lifecycle_transitions` : 0 identité pour `(recommendation_vs_actual_execution, 1.0.0)`), et restée vraie à chaque vérification read-only ultérieure (le comptage global `pattern_evidence_identities = 0`, strictement plus large que ce seul détecteur/version, est resté vérifié jusqu'au déploiement remote V0.3_001B inclus) — voir `docs/11_DECISION_LOG.md`.

### Modèle d'exécution

**On-demand.** Trois opérations conceptuelles : `refresh-longitudinal` et `get-insights` ont été **implémentées et testées localement en V0.3_001A**, puis **déployées et vérifiées en remote sur `uvolpldwwyvadlamulvr` en V0.3_001B** (`verify_jwt: true`, `status: ACTIVE`) ; `submit-review` **reste non implémentée** (V0.3_001C). **À ce stade, exécution on-demand : aucun scheduler ni appelant automatique déployé** — le déclenchement reste manuel/opérateur exclusivement :

- **`refresh-longitudinal`** (écriture, implémentée localement) — `POST` avec un corps strictement vide (`{}` — aucun `athleteId`/date/plage acceptés côté client, tout champ inconnu rejeté `400 invalid_request`). Pour l'athlète authentifié (résolu depuis le JWT, jamais depuis le corps de requête) : calcule `longitudinalProcessingDate`, charge une timeline compacte (`LONGITUDINAL_TIMELINE_RANGE`, voir ci-dessus), calcule les outcomes matures (`calculateAndPersistOutcomes`) puis exécute les 3 détecteurs existants sur la **même** timeline (`runDetectors`, aucun second chargement), persiste evidence/cycle de vie via les RPC déjà déployées. Idempotent, sûr à rejouer/réessayer. **Répartition des clients, implémentée** : résolution de l'athlète et lectures des 5 sources de la timeline via `ctx.supabase` (authentifié, RLS) ; écritures d'outcomes/evidence exclusivement via `ctx.supabaseAdmin` (RPC déjà `service_role`-only), jamais utilisé pour la lecture par simple confort. Réponse `{status: "complete"|"partial_failure", processingDate, outcomes, detectors, errors}` — `detectors` détaille les 3 rule ids exactes (`attempted`/`inserted`/`superseded`/`unchanged`/`withdrawn`/`unchangedWithdrawal`/`skippedNoPrior`/`errorCount` chacun) ; `errors` ne contient que des identifiants stables et un code fixe (`scope`/`detectorRuleId?`/`evaluationUnitId`/`code`) — jamais un message Postgres/RPC/SQL brut. Toujours HTTP 200 après orchestration réussie (jamais de 207).
- **`get-insights`** (lecture, implémentée localement) — `GET` sans aucun paramètre de requête (tout paramètre, y compris `athleteId`/`range`/`fromDate`, rejeté `400 invalid_request`). Résout l'athlète authentifié (JWT uniquement), lit `pattern_evidence_current_effective`, applique `INSIGHT_AGGREGATION_RANGE`, agrège, lit les revues humaines courantes, construit des candidats **côté serveur uniquement**, retourne `{range, candidates}`. **Zéro usage de `service_role`** : les deux lectures (evidence effective, revues courantes) passent exclusivement par `ctx.supabase` (authentifié, RLS — les deux vues sources sont `security_invoker=true` avec grants `authenticated` confirmés). Aucune table de persistance de candidat. Un `detectorRuleId`/`detectorRuleVersion` non enregistré dans le registre de projecteurs échoue explicitement (`UnsupportedPatternInsightProjectorError` → `500 unsupported_insight_projector`, message sanitisé), jamais de repli silencieux.
- **`submit-review`** (écriture humaine explicite uniquement) — jamais de création de revue automatique. **Non implémentée (V0.3_001C).**

### Limite d'authentification/frontière serveur

Réutilise **conceptuellement** le motif déjà établi par `daily-run` : JWT navigateur → frontière serveur authentifiée → résolution de l'athlète propre (RLS) → opérations `service_role` internes si nécessaire. Le navigateur ne reçoit **jamais** de identifiants `service_role`. Le navigateur ne peut **jamais** appeler directement les RPC de persistance réservées à `service_role`. Le partage du motif d'authentification **ne signifie pas** une intégration dans `daily-run` — ce sont de nouvelles opérations serveur séparées, `daily-run` lui-même n'est pas modifié.

### Candidats côté serveur uniquement

Autorité candidat navigateur = **AUCUNE**. Autorité candidat serveur = **COMPLÈTE**. Le navigateur ne fournit jamais d'autorité sur `candidateSnapshot`/`title`/`statement`/`caveats`/`direction`/comptages/ratios/`evidenceBalance`/`firstEventDate`/`lastEventDate`/`athleteId`.

### Jeton de fraîcheur de revue complet

Le navigateur peut renvoyer exactement : `detectorRuleId`, `detectorRuleVersion`, `insightKind`, `insightProjectorVersion`, `rangeFromDate`, `rangeToDate`, `sourceEvidenceRefs`, plus `decision` et `reviewerNote` optionnel. `athleteId` n'est jamais fourni par le navigateur — résolu depuis la session authentifiée. Le serveur reconstruit indépendamment le candidat courant canonique et compare les 7 dimensions exactement — réutilise la même logique que la dérivation `reviewed_stale` déjà verrouillée dans `buildPatternInsightCandidates.ts` (`fingerprintMatches`), sans hash inventé. Toute divergence → `stale_candidate`/conflit typé, **aucune écriture**, retour du candidat frais. Correspondance complète → persistance du `candidate.snapshot` **généré par le serveur** uniquement.

**Point de linéarisation de fraîcheur.** La fraîcheur est évaluée au moment où le serveur a reconstruit indépendamment le candidat canonique courant et a comparé avec succès les 7 dimensions du jeton navigateur. Cette comparaison réussie autorise la persistance du `candidate.snapshot` serveur ; elle ne constitue pas un verrou sur les mutations d'evidence futures et ne garantit pas que le candidat restera courant jusqu'au commit ou après celui-ci. Si l'evidence effective change après cette comparaison réussie, la revue persistée reste valide comme trace append-only de l'état effectivement revu et peut se projeter immédiatement `reviewed_stale` lors d'une lecture ultérieure. En revanche, toute divergence déjà présente au moment de la reconstruction/comparaison serveur produit `stale_candidate` (ou `candidate_not_found` si le candidat n'existe plus) et **aucune écriture**.

### Persistance de candidat

Modèle M5_007 inchangé : evidence = persistée, revue humaine = persistée, agrégat = calculé, candidat = calculé. Aucune table de candidat, aucun ledger matérialisé de candidat.

### Discipline de backfill

Le traitement historique réutilise la **même** logique d'orchestration canonique que le fonctionnement normal ; le premier traitement historique remote a été une étape de rollout **séparément supervisée** (V0.3_001B, 2026-08-28), jamais déclenchée implicitement par un chargement de page. Discipline exécutée et vérifiée : preuve locale complète fraîche → aperçu/rapport remote read-only → invocation remote historique explicitement approuvée → validation read-only post-backfill → preuve d'idempotence par une seconde invocation consécutive. Voir `docs/11_DECISION_LOG.md` pour le résultat complet.

### Échelle MVP

Balayage complet de la timeline athlète pertinente à chaque `refresh-longitudinal` explicite — aucun curseur, aucune marque haute, aucune file, aucune infrastructure de job en arrière-plan. Simplification délibérée V1/athlète-unique. Le passage à un traitement incrémental n'est justifié que par un symptôme qualitatif (latence perceptible, ou passage à plusieurs athlètes), jamais par un seuil numérique choisi à l'avance.

### Hors périmètre explicite

Enrichissement des domaines Technique DH / Mental / Nutrition, planificateur hebdomadaire, runtime `ActiveExperiment`, Garmin/Zwift/Strava, LLM, activation de coaching par pattern appris, scheduler/cron, table de persistance de candidat, scores de confiance/signification, causalité.
