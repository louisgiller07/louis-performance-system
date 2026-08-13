# 08 — Conventions

## Stack

- **Node.js** : LTS actuel (24.x en 2026)
- **TypeScript** : dernière version stable, mode strict
- **Vitest** : dernière version stable
- **Package manager** : `npm`

Ne jamais épingler une version obsolète. Utiliser `@latest` à l'installation, laisser npm résoudre.

## Structure du repo

```
louis-performance-system/
├── CLAUDE.md
├── README.md
├── docs/
│   ├── 00_PROJECT_STATUS.md
│   ├── 01_PRODUCT_REQUIREMENTS.md
│   ├── 02_ATHLETE_PROFILE.md
│   ├── 03_COACHING_MODEL.md
│   ├── 04_DAILY_DECISION_ENGINE.md
│   ├── 05_DATA_MODEL.md
│   ├── 06_ARCHITECTURE.md
│   ├── 07_GLOSSARY.md
│   ├── 08_CONVENTIONS.md
│   ├── 10_TEST_PLAN.md
│   ├── 11_DECISION_LOG.md
│   └── 12_BACKLOG.md
└── head-coach-engine/
    ├── src/
    │   ├── types/
    │   ├── engine/
    │   ├── rules/
    │   ├── domains/
    │   ├── mapping/
    │   └── cli/
    ├── tests/
    ├── fixtures/
    ├── package.json
    ├── tsconfig.json
    └── tsconfig.build.json
```

## TypeScript

### Configuration

Deux fichiers :

- `tsconfig.json` — base + tests + fixtures (utilisé par l'IDE et Vitest)
- `tsconfig.build.json` — build production, `src/` uniquement, `outDir: ./dist`

**Strict activé partout** :
- `strict: true`
- `noImplicitAny: true`
- `strictNullChecks: true`

### Modules

- `"type": "module"` dans `package.json`
- Imports ES modules avec extension `.js` explicite dans les paths (même pour les fichiers `.ts`) : `import { foo } from './bar.js'`

## Nommage

### Fichiers

- `camelCase.ts` pour les fichiers de code : `buildDailyPlan.ts`, `computeDimensions.ts`
- `PascalCase` réservé aux composants UI (plus tard)
- Tests : `<subject>.test.ts` dans `tests/`
- Fixtures : `<subject>.ts` dans `fixtures/`

### Types

- `PascalCase` pour les types et interfaces : `DailyPlan`, `AthleteState`, `EngineContext`
- Suffixes explicites : `Result`, `Context`, `Decision`, `Recommendation` quand pertinent

### Fonctions

- `camelCase` verbes explicites : `buildDailyPlan`, `evaluateSafety`, `computeAllDimensions`
- Fonctions pures préférées. Effets de bord clairement identifiables.

### Constantes

- `SCREAMING_SNAKE_CASE` pour les vraies constantes globales : `ENGINE_VERSION`, `LOUIS_HIGH_RISK_LOCATIONS`
- `camelCase` pour les objets de configuration

## Structure du code

### Séparation stricte

- `types/` — types purs, aucun code exécutable métier
- `engine/` — orchestration, calcul d'état, assembleur `DailyPlan`
- `rules/` — couches A (safety), B (modes, race protocol)
- `domains/` — couches C par domaine (training, recovery, mental, nutrition, etc.)
- `mapping/` — mapping `TrainingIntervention` ↔ `DbSessionType`
- `cli/` — commandes de démonstration locale
- `tests/` — tests unitaires et d'intégration
- `fixtures/` — données de test réalistes (Louis)

### Fonctions pures par défaut

Chaque règle, chaque calcul de dimension, chaque décision de domaine est **une fonction pure** : entrée + état → sortie sans effet de bord.

La trace des signaux consommés est mutable et passée en argument — c'est la seule exception documentée (l'implémentation exacte reste au choix de Claude Code).

## Tests

### Déterministes

- **Interdiction** : `expect(result).toContain(['A', 'B'])` sur des sorties alternatives
- Chaque test a **une sortie attendue unique**
- Si le comportement est ambigu, la spec doit trancher **avant** l'écriture du test

### Structure

- Un `describe` par comportement testé
- Nom du `it` explicite : ce qu'on teste + résultat attendu
- Fixtures partagées via `fixtures/louis.ts`, jamais dupliquées

### Couverture minimale

Voir `10_TEST_PLAN.md` pour la liste des scénarios canoniques.

## Commits

### Format

`<type>: <sujet court>` en anglais.

Types :
- `feat` — nouvelle fonctionnalité
- `fix` — correction de bug
- `refactor` — refactor sans changement de comportement
- `test` — ajout/modification de tests
- `docs` — mise à jour de documents
- `chore` — outillage, deps, config

Exemples :
- `feat: multidimensional athlete state`
- `fix: prevent double-counting of sleep_deficit signal`
- `docs: update 00_PROJECT_STATUS after M1 completion`

### Un commit = un changement cohérent

Ne pas mélanger `refactor` + `feat` dans le même commit. Splitter.

## Workflow après modification importante

1. **Tests** : `npm test` dans le package concerné
2. **Build** : `npm run build`
3. **Mise à jour docs** :
   - `docs/00_PROJECT_STATUS.md` si milestone ou changement de phase
   - `docs/11_DECISION_LOG.md` si décision architecturale
   - Le document canonique concerné si une règle métier a évolué (avec accord de l'architecte)
4. **Diff clair** avant push
5. **Review Louis**
6. **Push**

## Communication dans le code

### Commentaires

- Éviter les commentaires évidents
- Documenter le **pourquoi**, pas le **quoi**
- Marquer explicitement `PROVISIONAL` les seuils numériques non calibrés :
  ```typescript
  // PROVISIONAL — baseline initiale, à individualiser avec les données Louis
  const SLEEP_TARGET_HOURS = 8;
  ```
- Marquer explicitement les hypothèses de coaching en couche C :
  ```typescript
  // Coaching Heuristic C4.1 — cible sommeil PROVISIONAL
  ```

### JSDoc

Utilisée seulement pour les fonctions exportées de niveau public dont la signature n'est pas triviale.

## Language

- **Code, tests, commits** : anglais
- **Documents `/docs`** : français (public interne principalement francophone)
- **Messages utilisateurs (DailyPlan.reasoning, action_hint, etc.)** : français (Louis parle français)
- **Erreurs techniques** : anglais

## Interdictions absolues

- Ne pas casser le schéma Supabase V0.2 existant sans discussion
- Ne pas remplacer l'enum `session_type` de la DB par un enum plus riche
- Ne pas activer une Personal Rule (couche D) sans preuves longitudinales documentées
- Ne pas utiliser `any` sans justification en commentaire
- Ne pas commiter du code qui ne compile pas ou ne passe pas les tests
- Ne pas modifier un document canonique de `/docs` sans que la modification soit tracée dans `11_DECISION_LOG.md`
