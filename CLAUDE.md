# CLAUDE.md — Instructions pour Claude Code

Ce fichier est lu automatiquement par Claude Code au démarrage de chaque session dans ce repository.

## Contexte du projet

Ce repo contient le **Louis Performance System** — un Head Coach IA personnel pour Louis Giller, pilote suisse Elite de VTT Downhill.

Le système couvre sept domaines de coaching de **performance** :
1. Technique DH
2. Mental / confiance / race execution
3. Préparation physique
4. Sommeil et récupération
5. Nutrition et hydratation
6. Charge professionnelle et contexte de vie
7. Analyse des performances

Le Head Coach **ne remplace pas** un médecin, un physiothérapeute, un ostéopathe ou tout autre professionnel de santé. Il oriente vers eux quand nécessaire.

Le sponsoring et le management de carrière ne font **pas** partie du cœur actuel du Head Coach Engine. Ils pourront être ajoutés secondairement plus tard.

## Source de vérité — gouvernance

Le repository GitHub est le **conteneur partagé de vérité**, mais avec des sous-couches distinctes :

- **`/docs`** = intention et comportement canonique (métier + architecture)
- **Code** = implémentation actuelle
- **Tests** = contrats exécutables
- **Supabase** = état persistant réel

Le code ne "gagne" pas automatiquement contre les docs. Si l'implémentation diverge de la spec, **Claude Code doit signaler le conflit** et proposer une résolution — jamais modifier silencieusement la spec pour se conformer à l'implémentation.

## Règles de travail

### Avant toute décision importante

1. **Lis `/docs` d'abord.** Les documents dans `docs/` sont la source canonique.
2. **En cas de contradiction entre spec et implémentation existante, arrête-toi et signale.** Ne résous pas silencieusement.
3. **Ne modifie jamais une règle métier sans mise à jour du document canonique correspondant.** Si tu penses qu'une règle doit changer, propose la modification du document d'abord, code ensuite.

### Documents canoniques

- `docs/00_PROJECT_STATUS.md` — état d'avancement, phase actuelle
- `docs/01_PRODUCT_REQUIREMENTS.md` — vision produit, ambition, hors périmètre
- `docs/02_ATHLETE_PROFILE.md` — Louis Athlete Model (faits vs hypothèses vs patterns)
- `docs/03_COACHING_MODEL.md` — 7 domaines, 5 couches, principes de coaching
- `docs/04_DAILY_DECISION_ENGINE.md` — spec complète du moteur de décision
- `docs/05_DATA_MODEL.md` — schéma Supabase V0.2 + séparation DB/interne
- `docs/06_ARCHITECTURE.md` — architecture technique, découpage, principes
- `docs/07_GLOSSARY.md` — vocabulaire canonique
- `docs/08_CONVENTIONS.md` — conventions de code et de commit
- `docs/10_TEST_PLAN.md` — scénarios de tests attendus
- `docs/11_DECISION_LOG.md` — historique des décisions structurantes
- `docs/12_BACKLOG.md` — priorités P0/P1/P2

## Gouvernance documentaire

### Documents que Claude Code peut modifier directement

- `docs/00_PROJECT_STATUS.md` — après un milestone franchi ou changement de phase
- `docs/11_DECISION_LOG.md` — quand une décision architecturale est prise ou modifiée (en accord avec la spec)
- `docs/12_BACKLOG.md` — cocher/déplacer les tâches déjà validées après implémentation

### Documents que Claude Code NE modifie PAS de sa propre initiative

- `docs/01_PRODUCT_REQUIREMENTS.md`
- `docs/02_ATHLETE_PROFILE.md`
- `docs/03_COACHING_MODEL.md`
- `docs/04_DAILY_DECISION_ENGINE.md`
- `docs/05_DATA_MODEL.md`
- `docs/06_ARCHITECTURE.md`
- `docs/07_GLOSSARY.md`
- `docs/08_CONVENTIONS.md`
- `docs/10_TEST_PLAN.md`

Si Claude Code pense qu'un de ces documents doit évoluer :
1. Il **signale la contradiction** ou le besoin d'évolution.
2. Il **propose un diff** pour validation.
3. La modification est appliquée **après accord** de l'architecte (Claude Project) et de Louis.

L'objectif est d'éviter que l'implémentation modifie silencieusement la spec pour se rendre elle-même correcte.

## Après toute modification importante

1. **Lance les tests** (`npm test` dans le package concerné).
2. **Lance le build** (`npm run build`).
3. **Mets à jour `docs/00_PROJECT_STATUS.md`** si un milestone est franchi.
4. **Mets à jour `docs/11_DECISION_LOG.md`** si une décision architecturale est prise ou modifiée.
5. **Mets à jour `docs/12_BACKLOG.md`** si des tâches sont complétées.
6. **Montre le diff clairement** avant tout push.

## Ne fais pas

- **Ne connecte pas Supabase runtime** avant que la vertical slice locale soit validée par tests.
- **Ne construis pas d'UI** avant que le moteur core soit stable.
- **N'intègre pas Garmin/Strava/LLM/webhooks** avant validation explicite.
- **Ne casse pas le schéma Supabase V0.2 existant.** Toute évolution du schéma doit être additive et documentée dans `docs/05_DATA_MODEL.md` et `docs/11_DECISION_LOG.md`.
- **Ne remplace pas l'enum `session_type` de la DB par un enum plus riche.** La DB conserve son `session_type` coarse. Le Head Coach peut utiliser une représentation interne plus riche (`TrainingIntervention`), avec mapping explicite. Voir `docs/05_DATA_MODEL.md`.
- **N'invente pas de nouveaux termes.** Utilise le vocabulaire de `docs/07_GLOSSARY.md`.

## Contrainte canonique : traçabilité des signaux (double-counting)

Le moteur doit **tracer quels signaux (dimensions, causes) ont déjà influencé la décision** afin d'empêcher qu'un même signal (ex. `sleep_deficit`) déclenche plusieurs adaptations en cascade.

Cette contrainte est un **comportement obligatoire**, couvert par tests. L'implémentation TypeScript exacte (classe mutable, structure immuable, closure, etc.) est laissée au choix de Claude Code — le seul critère est que les tests de non-double-counting passent et que le code reste lisible.

## Style de code

Voir `docs/08_CONVENTIONS.md` pour :
- TypeScript strict
- Nommage
- Structure des fichiers
- Style de commit
- Tests déterministes (aucun `expect().toContain([...])` sur des sorties alternatives)

## Communication avec Louis

- Réponses en français, sauf commit messages, code, tests (anglais).
- Explique tes choix quand ils dérivent d'une interprétation de la spec.
- Si tu hésites entre deux implémentations, présente les options avec trade-offs.

## Architecture actuelle en un paragraphe

Une **librairie pure TypeScript** dans `head-coach-engine/` produit un `DailyPlan` à partir d'un `EngineContext`. Le pipeline est :

`RawContext → MultidimensionalAthleteState → Safety → Mode+RaceContext → DomainDecisions → HeadCoachArbitration → DailyPlan`

Aucune connexion Supabase, aucun LLM, aucune UI en V0.2 vertical slice.

## Workflow de session type

1. Lis `docs/00_PROJECT_STATUS.md` pour connaître la phase.
2. Lis `docs/12_BACKLOG.md` pour la prochaine tâche.
3. Consulte le(s) document(s) canonique(s) pertinent(s).
4. Implémente.
5. Tests + build.
6. Mets à jour status + decision log + backlog si pertinent.
7. Diff clair pour review Louis.
