# 11 — Decision Log

Historique des **décisions structurantes** du projet. Une décision = une entrée. Uniquement les décisions qui expliquent pourquoi l'architecture actuelle est comme elle est.

Format d'entrée :
YYYY-MM-DD — [Titre court de la décision]

Contexte : ce qui a motivé la décision.
Décision : ce qui a été tranché.
Alternatives considérées : (si pertinent)
Impact : quels documents / composants affectés.
Statut : active | superseded (par entrée du [date])


---

## 2026-08-11 — Architecture Head Coach multi-domaines (non générateur de workouts)

**Contexte** : Louis a explicitement demandé un système équivalent à un staff personnel de performance (~CHF 2'000/mois), pas un générateur de séances.

**Décision** : le Head Coach couvre 7 domaines (technique DH, mental, physique, sommeil/récup, nutrition, contexte de vie, analyse). La sortie est un `DailyPlan` multi-domaines, pas un session_type unique.

**Impact** : `01_PRODUCT_REQUIREMENTS.md`, `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`.

**Statut** : active

---

## 2026-08-11 — Suppression des chaînes de downgrade génériques

**Contexte** : La V0.1 utilisait une chaîne `STRENGTH_A → STRENGTH_B → AEROBIC → RECOVERY → REST` déclenchée par un score de readiness global. Cette approche est causalement pauvre : un mauvais sommeil et une fatigue grip produisaient la même adaptation.

**Décision** : décisions basées sur des dimensions individuelles nommées (`systemic`, `legs`, `arms_grip`, `mental`, `health`, `recent_load`). Chaque cause identifiée entraîne une adaptation appropriée.

**Alternatives considérées** : garder un readiness global comme trigger. Rejetée car ne permet pas la richesse d'un vrai coach.

**Impact** : `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`, tous les tests.

**Statut** : active

---

## 2026-08-11 — Prévention du double-counting

**Contexte** : sans traçabilité, un même signal (ex. `sleep_deficit`) peut déclencher plusieurs adaptations en cascade.

**Décision** : le moteur trace quels signaux ont déjà influencé la décision, empêchant leur réutilisation. Implémentation libre en TypeScript tant que les tests le couvrent.

**Impact** : `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`, `06_ARCHITECTURE.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — T-X comme default framework, pas rail rigide

**Contexte** : la V0.1 imposait un `forced_session` T-X. Cela ne reflète pas la réalité (horaires officiels, voyage, état du jour, format hybride).

**Décision** : le protocole T-X produit une `recommended_session` avec soft constraints. Le Head Coach peut la surcharger si justifié. Toute dérogation est loggée avec `override_reason`.

**Impact** : `04_DAILY_DECISION_ENGINE.md`.

**Statut** : active

---

## 2026-08-11 — Support courses multi-jours (pre / in-progress / post)

**Contexte** : une course iXS commence vendredi et se termine dimanche. Le moteur ne peut pas se limiter à `event_end >= today`.

**Décision** :
- `UpcomingRace` a `event_start` + `event_end`
- Le moteur produit un `EventContext` avec `days_to_event`, `days_from_event`, `event_day`, `in_progress`, `phase`
- Fenêtre post-event utile : `days_from_event` ≤ 2 après `event_end`
- T-X sert uniquement pré-event. Une fois l'événement commencé, `event_day + race_phase` prennent le relais.
- Le programme officiel réel (si `race_phase` renseigné) prime sur le mapping T-X générique.

**Impact** : `04_DAILY_DECISION_ENGINE.md`, `05_DATA_MODEL.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — SAFETY strictement limitée aux vraies règles médicales

**Contexte** : la V0.1 traitait `sommeil <4h + stress ≥8` comme SAFETY. Ce n'est pas une règle médicale, c'est une heuristique forte de récupération.

**Décision** : SAFETY limitée à :
- Suspicion de commotion
- Douleur nouvelle ≥ 6/10
- Fièvre / maladie
- Douleur avec critère objectif de gravité (traumatique, perte de fonction, aggravation nette)
- Retour post-commotion sans validation médicale

Les autres seuils (sommeil, stress, charge) deviennent des heuristiques fortes en couche C, arbitrables.

**Impact** : `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — Soft constraints réellement soft (règle unique)

**Contexte** : ambiguïté entre "strong = obligatoire" et "strong = préférence forte".

**Décision** : règle canonique unique. Seule SAFETY est hard. Toutes les autres couches produisent des recommandations arbitrables. `strong` = préférence forte nécessitant justification forte pour override. Toute dérogation loggée avec `override_reason`.

**Impact** : `01_PRODUCT_REQUIREMENTS.md`, `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`.

**Statut** : active

---

## 2026-08-11 — Douleur non-SAFETY reste actionnable

**Contexte** : sans règle explicite, une douleur légère non-SAFETY était ignorée.

**Décision** : toute douleur, même non-SAFETY, doit produire :
- monitoring (observer évolution)
- protection de la zone concernée
- adaptation si la séance sollicite la zone

Elle ne doit ni être ignorée, ni annuler automatiquement l'entraînement.

**Impact** : `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — Séparation DbSessionType (persistance) vs TrainingIntervention (interne)

**Contexte** : la DB Supabase V0.2 est déjà déployée avec un enum `session_type` coarse. Le Head Coach a besoin d'une représentation plus riche (STRENGTH_LOWER, STRENGTH_UPPER, GRIP_WORK, DH_LIGHT, etc.) sans devoir remigrer la DB.

**Décision** :
- La DB conserve son enum `session_type` coarse
- Le Head Coach interne utilise `TrainingIntervention` riche
- Un mapping explicite existe entre les deux
- La persistance en `decisions.final_session` utilise le DbSessionType
- La richesse est stockée dans `daily_plan JSONB` (à ajouter)

**Impact** : `05_DATA_MODEL.md`, `06_ARCHITECTURE.md`, `07_GLOSSARY.md`.

**Statut** : active

---

## 2026-08-11 — Le moteur part du plan existant (KEEP/MODIFY/REPLACE/REST)

**Contexte** : sans point de départ, le moteur devait tout générer, sortant du rôle de coach quotidien pour devenir un planificateur.

**Décision** : chemin normal = `season/block → planned session → daily state → KEEP / MODIFY / REPLACE / REST`. Le moteur part du `planned_session` du RawContext. Si aucun plan n'existe, fallback d'inférence marqué explicitement.

**Impact** : `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — Confidence qualitative en V0.2

**Contexte** : les seuils numériques `base=0.8`, `<21 checkins`, `<15 sessions` de la V0.1 étaient arbitraires et non calibrés.

**Décision** : confidence qualitative en V0.2 (`LOW` / `MEDIUM` / `HIGH`), reflétant quantité de données, données manquantes, contradictions, heuristiques PROVISIONAL, présence de patterns validés. Tout score numérique reste PROVISIONAL.

**Impact** : `04_DAILY_DECISION_ENGINE.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — Experiments actifs distincts des heuristiques permanentes

**Contexte** : le test "coupure liquides 21h + zéro Red Bull" avait été codé comme une règle permanente, alors qu'il s'agit d'une expérimentation avec fenêtre de review.

**Décision** : introduction d'un concept `ActiveExperiment` avec `hypothesis`, `start_date`, `intervention`, `metrics`, `review_date`, `status`. Un experiment influence le coach uniquement tant que `status = active`.

**Impact** : `03_COACHING_MODEL.md`, `02_ATHLETE_PROFILE.md`, `05_DATA_MODEL.md` (évolution V0.3), `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — Cue "Comme à Wiriehorn" comme hypothèse, pas règle permanente

**Contexte** : la cue Wiriehorn a été identifiée comme actif mental fort à l'onboarding, mais elle ne doit pas être imposée pour toujours.

**Décision** : la cue est utilisée comme hypothèse actuellement efficace. Le modèle peut apprendre qu'une autre cue fonctionne mieux et l'ajuster.

**Impact** : `03_COACHING_MODEL.md`.

**Statut** : active

---

## 2026-08-11 — Séparation faits / hypothèses / patterns

**Contexte** : sans discipline épistémologique, les interprétations initiales de l'onboarding pouvaient être stockées comme "faits" en base.

**Décision** :
- **Faits** : mesures, déclarations, résultats vérifiables → base de données
- **Hypothèses de coaching** : interprétations initiales, révisables → documents canoniques uniquement
- **Learned Patterns** : confirmés par preuves longitudinales → couche D, vide en V0.2

Aucun learned pattern n'est activé sans preuves suffisantes. Pas de seuil universel type "N ≥ 30" — chaque candidat évalué individuellement.

**Impact** : `02_ATHLETE_PROFILE.md`, `03_COACHING_MODEL.md`.

**Statut** : active

---

## 2026-08-11 — Provenance obligatoire dans athlete_profile

**Contexte** : sans provenance, Claude Code peut prendre des données reconstruites comme vérité.

**Décision** : chaque bloc factuel de `02_ATHLETE_PROFILE.md` doit citer sa source (onboarding + date, table Supabase, déclaration Louis + date). Sans source claire → `À VÉRIFIER`.

**Impact** : `02_ATHLETE_PROFILE.md`.

**Statut** : active

---

## 2026-08-11 — Événements mécaniques loggés comme contexte

**Contexte** : le coaching setup vélo est hors périmètre, mais un dérailleur cassé peut expliquer un mauvais chrono qu'il serait erroné d'attribuer au physique ou au mental.

**Décision** : les événements mécaniques sont loggés dans `completed_sessions.main_content` ou `race_calendar.notes` comme contexte, sans que le moteur ne fasse de recommandation setup.

**Impact** : `04_DAILY_DECISION_ENGINE.md`, `05_DATA_MODEL.md`.

**Statut** : active

---

## 2026-08-12 — Workflow GitHub + Claude Code + Claude Project

**Contexte** : jusqu'ici toute la conception vivait dans les conversations Claude Project. Louis souhaite un vrai repository GitHub comme source de vérité partagée.

**Décision** :
- Repo `louisgiller07/louis-performance-system` = source de vérité partagée
- `/docs` = intention canonique (métier + architecture)
- Code = implémentation
- Tests = contrats exécutables
- Supabase = état persistant
- Claude Code implémente dans le repo
- Claude Project = architecte + Head Coach + gardien des docs canoniques
- Claude Code ne modifie pas de sa propre initiative les documents canoniques (sauf status, decision log, backlog)

**Impact** : `CLAUDE.md`, tout le workflow projet.

**Statut** : active