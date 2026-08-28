# 04 — Daily Decision Engine

**Version canonique :** V0.2
**Statut :** spec exécutable, prête à implémentation

## Vision

Le Daily Decision Engine est **le cerveau du Head Coach**, pas un générateur de séances physiques.

Sortie principale : un `DailyPlan` structuré par domaine, avec `reasoning`, `confidence`, `triggered_rules`.

---

## Pipeline de décision

```
1. RawContext (checkin + calendrier + historique + mode + planned_session)
2. MultidimensionalAthleteState (6 dimensions + ContextState séparé)
3. Safety (couche A — hard)
4. Mode + Race/Event Context (couche B — soft constraints)
5. Domain Decisions (couche C par domaine)
6. Head Coach Arbitration (KEEP/MODIFY/REPLACE/REST + cohérence)
7. DailyPlan JSON
```

Chaque étape est **testable indépendamment**. Chaque étape produit une trace (`TriggeredRule`) pour audit.

---

## 1. RawContext → MultidimensionalAthleteState

### RawContext (entrée du moteur)

Le `RawContext` contient au minimum :

- `today` (date ISO)
- `checkin` (DailyCheckin du jour)
- `planned_session` (TrainingIntervention prévue par le weekly planner ou par Louis, peut être `null`)
- `planned_intent` (optionnel : notes du planificateur sur pourquoi cette séance était prévue)
- `active_mode` (TrainingMode courant)
- `upcoming_races` (liste, incluant fenêtre post-event utile)
- `recent_sessions` (7 derniers jours de sessions complétées)
- `active_experiments` (liste des ActiveExperiment en cours, cf. `03_COACHING_MODEL.md`)
- `active_health_flags` : liste structurée `HealthFlag[]`, **pas un simple nombre**. Chaque flag contient au minimum `type` (concussion_suspect, injury_suspect, illness, pain_persistent) et `status` (active, monitoring, resolved). Nécessaire pour évaluer la règle "retour post-commotion sans validation médicale".
- `n_total_checkins`, `n_total_completed_sessions` (indicateurs contextuels, non utilisés comme seuils de confidence en M1)

### Champs douleur enrichis dans `DailyCheckin` (V0.2 M1 local)

Les règles SAFETY utilisent :
- `pain_traumatic` (bool) — caractère traumatique de la douleur
- `pain_function_loss` (bool) — perte fonctionnelle déclarée
- `pain_getting_worse` (bool) — aggravation nette rapportée

Ces champs sont utilisés dans le `RawContext` et les fixtures pour M1 (local, hors Supabase runtime).

Ils **ne sont pas encore présents** dans la table Supabase `daily_checkins`. Voir `05_DATA_MODEL.md` §Évolutions anticipées et `12_BACKLOG.md` pour la migration additive requise **avant** la connexion Supabase réelle en M2.

**Ne pas modifier la DB maintenant.** M1 est purement local.

### AthleteDimensions (calculées à partir du checkin + historique)

Six dimensions séparées, chacune avec `level`, `score`, `raw_signals`, `reasons` :

- `systemic`
- `legs`
- `arms_grip`
- `mental`
- `health`
- `recent_load`

### ContextState (structuré, pas une DimensionState)

Le contexte n'est **pas** une DimensionState avec un score `GREEN/AMBER/RED`.

`ContextState` regroupe :

```
ContextState {
  current_block           // référence au training_block courant
  training_mode           // TrainingMode actif
  planned_session         // TrainingIntervention | null
  planned_intent          // string | undefined
  availability            // WeeklyAvailability pour la semaine
  event_context           // EventContext | undefined (voir §3)
  active_experiments      // ActiveExperiment[]
  life_constraints        // travel, cours, imprévus
}
```

`AthleteDimensions` + `ContextState` = **MultidimensionalAthleteState** (entrée des couches suivantes).

### `global_readiness_ui`

Score agrégé 0-1 calculé pour l'interface **uniquement**. **Ne doit pas** être utilisé comme cerveau de décision.

---

## 2. Couche A — SAFETY RULES

Non-contournables. Écrasent toutes les autres couches. Produisent un `DailyPlan` minimal centré sur la protection de Louis + orientation vers professionnel de santé quand pertinent.

| ID | Trigger | Action | Confidence |
|---|---|---|---|
| A1 | `suspected_concussion = true` | REST + health_flag + orientation médicale | HIGH |
| A2 | `pain = true` ET `pain_intensity ≥ 6` ET `pain_new = true` | REST + health_flag + orientation médicale | HIGH |
| A3 | `fever_or_illness = true` | REST + health_flag | HIGH |
| A4 | `pain = true` ET critère objectif de gravité (traumatique, perte de fonction, aggravation nette) | REST + health_flag + orientation | HIGH |
| A5 | Retour post-commotion sans health_flag résolu | Zéro DH tant que non validé | HIGH |

**Ce qui n'est PAS SAFETY** (déplacé en couche C) :
- Sommeil <4h + stress ≥8 → C4.6
- Douleur légère/modérée sans critère de gravité → produit monitoring + protection + adaptation (voir §Douleur non-SAFETY)

### Comportement de la couche A

Dès qu'une SAFETY se déclenche :
- `DailyPlan` est fortement contraint (typiquement REST)
- `training.active = false` sauf indication contraire
- `recovery` et `sleep` restent utiles pour orienter Louis
- `monitoring` liste ce que Louis doit observer
- `protection.do_not_do` liste les interdits
- `reasoning` cite explicitement la règle et oriente vers un professionnel si pertinent

### Douleur non-SAFETY : comportement obligatoire

Une douleur **non-SAFETY** (légère/modérée, sans critère de gravité) doit :
1. **Monitoring** — observer évolution 24-48h
2. **Protection** — ajouter `do_not_do` sur la zone concernée
3. **Adaptation** — si la séance prévue sollicite la zone, adapter (pivot vers autre exercice, réduction d'intensité, ou substitution partielle)

Elle ne doit **pas** :
- annuler automatiquement l'entraînement
- déclencher SAFETY
- être ignorée simplement parce qu'elle n'atteint pas les critères SAFETY

### Rappel : pas de "readiness globale" comme trigger

Aucune SAFETY, aucune règle de couche B ou C ne se déclenche à partir d'un score global de fatigue ou de readiness.

Toute règle s'appuie sur des **dimensions individuelles nommées** :
`systemic`, `legs`, `arms_grip`, `mental`, `health`, `recent_load`.

Chaque dimension entraîne potentiellement une réponse différente.

---

## 3. Couche B — MODE + RACE/EVENT CONTEXT

Produit des **soft constraints**, pas des interdictions dures. Le Head Coach peut y déroger (couche 6).

### Modes opérationnels

Chaque mode définit des soft constraints par défaut.

| Mode | Soft constraints principales |
|---|---|
| `RACE_WEEK` | `no_development` (strong), `no_grip_heavy` (strong), `no_dh_intense` (strong) |
| `RACE_CLUSTER` | `no_grip_heavy` (moderate), `protect_sleep` (moderate) — développement compatible autorisé |
| `OFF_SEASON_RECOVERY` | `no_development` (moderate) |
| `OFF_SEASON_DEVELOPMENT` | Aucune contrainte par défaut, développement structuré autorisé |
| `PRE_SEASON` | Aucune contrainte par défaut |
| `IN_SEASON` | Aucune contrainte par défaut |
| `INJURY_RECOVERY` | `no_development` (strong), `no_dh_intense` (strong) |
| `OTHER` | Aucune contrainte par défaut |

### Event Context

Modélisation d'un événement compétitif :

```
UpcomingRace {
  event_name
  event_start
  event_end
  priority: A_PLUS | A | B | C
  race_format: HOT_TRAIL_2DAY | IXS_3DAY | ...
  race_phase?: RacePhase  // enrichi si horaires officiels connus
}
```

Le moteur produit un `EventContext` pour tout événement pertinent :

```
EventContext {
  race
  days_to_event         // jours jusqu'à event_start (négatif si passé)
  days_from_event       // jours depuis event_start (positif si en cours ou passé)
  event_day             // 0, 1, 2... si en cours, null sinon
  in_progress           // event_start ≤ today ≤ event_end
  phase: RacePhase      // PRE_EVENT | RACE_DAY_GENERIC | POST_EVENT | ...
}
```

### Fenêtre de pertinence

Le moteur cherche un événement pertinent selon plusieurs fenêtres, **pas uniquement** `event_end >= today` :

- **Pré-event** : `days_to_event` ≤ 7
- **En cours** : `in_progress = true`
- **Post-event utile** : `days_from_event` ≤ 2 après `event_end` (récupération, debrief)

Un événement récemment terminé reste dans le contexte pour appliquer récupération et debrief.

### Protocole T-X — pré-event uniquement

**T-X sert uniquement avant `event_start`.** Une fois l'événement commencé, le moteur utilise `event_day` et `race_phase`.

Le protocole T-X est un **default framework**, pas un rail rigide. Il produit une `RaceProtocolRecommendation` :

```
RaceProtocolRecommendation {
  recommended_session
  reasoning
  soft_constraints
}
```

**`recommended_session` n'est jamais forcée.** Le Head Coach peut la surcharger si :
- les dimensions du jour le justifient
- les horaires officiels réels de l'événement diffèrent
- des contraintes de voyage l'imposent
- le contexte spécifique de la course le justifie

Chaque override est loggé avec `override_reason`.

#### Format `HOT_TRAIL_2DAY`

**Pré-event (`days_to_event > 0`)** :

| T-X | Recommandation par défaut |
|---|---|
| T-7 | STRENGTH_UPPER léger |
| T-6 | DH_TECHNICAL |
| T-5 | AEROBIC_BASE court |
| T-4 | RECOVERY_ACTIVE |
| T-3 | RECOVERY_ACTIVE court |
| T-2 | REST |
| T-1 | REST |

**En cours (`in_progress = true`)** : la recommandation dépend de `event_day` et `race_phase` :

| event_day | race_phase (si connu) | Recommandation |
|---|---|---|
| 0 | `PRACTICE` / `PRACTICE_TIMED` | RACE_ACTIVITY (samedi entraînement + chrono) |
| 1 | `FINAL` | RACE_ACTIVITY (dimanche 2 runs finale) |

**Post-event** :

| Days after event_end | Recommandation |
|---|---|
| T+1 | RECOVERY_ACTIVE |
| T+2 | RECOVERY_ACTIVE ou AEROBIC_BASE léger |

#### Format `IXS_3DAY`

**Pré-event (`days_to_event > 0`)** :

| T-X | Recommandation par défaut |
|---|---|
| T-7 | STRENGTH_UPPER léger |
| T-6 | DH_TECHNICAL |
| T-5 | AEROBIC_BASE court |
| T-4 | RECOVERY_ACTIVE |
| T-3 | RECOVERY_ACTIVE court |
| T-2 | REST |
| T-1 | RACE_ACTIVITY (trackwalk / practice officielle si `race_phase` connu) |

**En cours (`in_progress = true`)** :

| event_day | race_phase (si connu) | Recommandation |
|---|---|---|
| 0 | `TRACKWALK` / `PRACTICE` | RACE_ACTIVITY |
| 1 | `PRACTICE_TIMED` / `QUALI` | RACE_ACTIVITY |
| 2 | `FINAL` | RACE_ACTIVITY |

**Post-event** :

| Days after event_end | Recommandation |
|---|---|
| T+1 | RECOVERY_ACTIVE |
| T+2 | RECOVERY_ACTIVE ou AEROBIC_BASE léger |

### Priorité du programme officiel

**Le programme officiel réel de l'événement (horaires organisateur, race_phase précise) a priorité sur le framework T-X par défaut.**

Si `race_phase` est connu (renseigné dans la DB ou via horaires officiels), il prend le pas sur le mapping générique. Le T-X reste un fallback quand la phase précise n'est pas encore connue.

### Priorité A_PLUS vs A

- **A+** : soft constraints appliquées avec poids `strong`. Dérogation nécessite justification forte.
- **A** : soft constraints appliquées avec poids `moderate`. Dérogation plus facile.

---

## 4. Couche C — DOMAIN DECISIONS

Chaque domaine produit sa décision indépendamment, à partir :
- des dimensions calculées
- des soft constraints des couches A/B
- des signaux non encore consommés

### Traçabilité des signaux (contrainte canonique)

Le moteur doit **tracer quels signaux ont déjà influencé la décision** dans les couches précédentes, pour empêcher qu'un même signal déclenche plusieurs adaptations en cascade.

Exemple : si `sleep_deficit` a déjà été utilisé par la règle C4.6 pour prescrire récupération, il ne peut pas être réutilisé par une règle du domaine training pour downgrader la séance.

L'implémentation TypeScript (classe, structure immuable, closure) est libre tant que le comportement est couvert par tests.

### Décisions par la cause, pas par le score global

Pas de chaîne générique. Chaque adaptation vient d'une dimension identifiée.

Exemples :

**`arms_grip = RED` seul :**
- Refuse grip lourd → pivot vers exercice sans grip
- Refuse DH intense → DH léger si prévu
- Autorise bas du corps normal
- Autorise haut du corps sans tirage lourd

**`legs = RED` seul :**
- Refuse squat lourd → pivot vers haut du corps
- Refuse DH physique → DH léger si prévu
- Autorise haut du corps + grip

**`mental = RED` seul (stress travail, motivation basse) :**
- Autorise session physique
- Réduit la charge cognitive (session moins exigeante mentalement)
- Propose techniques de respiration

**`systemic = RED` seul (mauvais sommeil, énergie basse, sans autre fatigue) :**
- Ne change pas la nature de la session
- Réduit l'intensité globale (RPE cible réduit)
- Protège la récupération suivante

**`health = RED` (douleur non-SAFETY) :**
- Adapte selon la zone
- Ajoute monitoring
- Ajoute protection

**`recent_load` HIGH ou VERY_HIGH :**
- **Forte recommandation** de récupération (soft constraint, arbitrable)
- Réduit la propension au développement
- N'impose **pas** RECOVERY (seule SAFETY peut réellement imposer une décision)
- La décision finale reste au Head Coach en fonction des autres dimensions et du contexte

---

## 5. Head Coach Arbitration

Après passage des couches C, les propositions des domaines sont assemblées.

### Décision KEEP / MODIFY / REPLACE / REST

À partir du `planned_session` du RawContext et des propositions des domaines, le Head Coach décide :

- **KEEP** : la séance prévue est maintenue telle quelle
- **MODIFY** : adaptation (intensité, volume, focus, cue) sans changement de nature
- **REPLACE** : substitution par une autre `TrainingIntervention`, justifiée par une cause identifiée
- **REST** : récupération complète

Si `planned_session = null` : fallback d'inférence depuis le contexte (mode, jour, dimensions), marqué explicitement dans `triggered_rules`.

### Cohérence

Le Head Coach vérifie qu'il n'y a pas de contradiction entre domaines :
- horaires compatibles (séance et bedtime)
- charge cumulée cohérente
- constraints respectées ou dérogées avec justification

### Résolution des conflits — règle unique

Toutes les contraintes des couches B, C, D sont **arbitrables**.

Le poids de la contrainte guide l'arbitrage, il ne l'impose pas :
- `strong` → dérogation nécessite une justification forte
- `moderate` → dérogation possible avec justification claire
- `weak` → dérogation acceptable si contexte le justifie

Seule la couche SAFETY est réellement hard.

**Toute dérogation significative à une soft constraint ou à une `recommended_session` doit être loggée avec `override_reason`.**

### Priorisation des domaines

Cible normale : 2 à 4 domaines actifs par jour.

---

## 6. Sortie : `DailyPlan`

```
DailyPlan {
  date
  active_mode
  event_context?

  training: {
    active
    session_type: TrainingIntervention  // représentation riche interne
    duration_min
    time_slot?
    content_ref?
    objective?
  }

  dh_or_technical: { active, focus?, spot_hint? }
  mental: { active, focus?, action_hint? }
  recovery: { active, actions: string[] }
  nutrition: { active, focus?, hydration_target_l?, notes? }
  sleep: { active, target_hours?, bedtime_hint?, notes? }
  protection: { do_not_do: string[] }
  monitoring: { observe: string[] }

  reasoning: string
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'

  triggered_rules: TriggeredRule[]
  health_flag_to_create?: HealthFlagToCreate

  planned_session_before: TrainingIntervention | null
  final_session: TrainingIntervention

  overrode_race_protocol: boolean
  override_reason?: string

  engine_version: string
}
```

### Confidence

La confidence en V0.2 est **qualitative** : `LOW` / `MEDIUM` / `HIGH`.

Elle reflète la robustesse de la décision, pas une probabilité mathématique.

Règle déterministe pour M1 :

- **`HIGH`** : SAFETY claire et non ambiguë (règle médicale certaine)
- **`LOW`** : données nécessaires manquantes ou contexte contradictoire important (dimensions incomplètes, contradictions entre règles, plusieurs signaux qui pointent dans des directions opposées)
- **`MEDIUM`** : décision normale reposant principalement sur les heuristiques PROVISIONAL de V0.2 (cas par défaut)

La calibration plus fine (fonction du volume de données, de la présence de patterns validés, etc.) arrivera avec les données longitudinales et sera introduite en V0.3+.

**Tout score numérique de confidence en V0.2 est proscrit.** La confidence est un enum qualitatif.

### Événements mécaniques comme contexte

Le coaching setup vélo reste hors périmètre. Cependant, les événements mécaniques qui affectent une performance doivent pouvoir être loggés comme contexte pour éviter d'attribuer un mauvais chrono au physique ou au mental à tort.

Exemples : crevaison, dérailleur cassé, problème de frein, incident matériel.

Ces événements sont stockés dans `completed_sessions.main_content` ou `race_calendar.notes` selon le contexte (session normale ou course), et sont pris en compte par le domaine 7 (Analyse) lors du debrief.

**Le moteur ne fait aucune recommandation de setup ou de mécanique.** Il enregistre seulement le contexte pour interprétation correcte des résultats.

### Mapping vers DB

Le `training.session_type` en `TrainingIntervention` (riche) est mappé vers `DbSessionType` (coarse) au moment de la persistance en Supabase. Voir `05_DATA_MODEL.md`.

---

## 7. Contraintes non négociables (récapitulatif)

1. Aucune chaîne de downgrade générique.
2. Décisions basées sur les dimensions individuelles nommées, pas un score global.
3. Pas de double-counting (traçabilité des signaux consommés).
4. `recommended_session` du protocole T-X est overridable, jamais forcée.
5. Toutes les couches non-SAFETY produisent des contraintes arbitrables (règle unique — `strong` reste soft).
6. Douleur non-SAFETY produit monitoring + protection + adaptation.
7. SAFETY strictement limitée aux vraies règles médicales.
8. Support courses multi-jours : T-X uniquement pré-event, `event_day + race_phase` pendant, fenêtre post-event utile.
9. Le moteur part du `planned_session` et décide KEEP/MODIFY/REPLACE/REST.
10. Séparation DB `session_type` vs interne `TrainingIntervention`.
11. Tout override loggé avec `override_reason`.
12. Seuils numériques PROVISIONAL tant que non calibrés.
13. Confidence qualitative en V0.2 (LOW/MEDIUM/HIGH).
14. Experiments actifs distincts des heuristiques permanentes.
15. Événements mécaniques loggés comme contexte, sans recommandation setup.
16. Head Coach ne remplace pas médecin/physio — oriente vers eux.
17. Propriété de signal (verrouillé V0.3_002A) : un signal a au plus un propriétaire de décision (`consume()`, exclusif) ; une lecture de support non consommante (`has()`/`consumedByRule()`) est autorisée quand justifiée sémantiquement, sans jamais causer de seconde adaptation ni modifier la décision du propriétaire.

---

## 8. Roadmap V0.2 → futur

### V0.2 (actuel)
- Vertical slice locale
- Couches A + B + C basiques (training + recovery)
- Fixtures Louis
- Tests déterministes

### V0.3
- **V0.3_001 — Longitudinal Intelligence Runtime + Human Insight Review** : architecture verrouillée le 2026-08-27 ; V0.3_001A **CLOSED LOCALLY** (orchestration + correction du détecteur recommendation, 2026-08-28), V0.3_001B **CLOSED REMOTE** (déploiement + premier backfill + idempotence remote vérifiés, 2026-08-28), V0.3_001C **CLOSED REMOTE** (`submit-review` durci + surface web `/insights` déployée, 2026-08-28) — **V0.3_001 dans son ensemble COMPLETE (2026-08-28)**. Opérationnalise le pipeline M5 déjà construit et déployé selon son statut canonique propre (`evidence → agrégat → candidat d'insight → revue humaine`), sans jamais influencer `daily-run` ni activer automatiquement un pattern — `daily-run` reste non modifié. Voir `docs/06_ARCHITECTURE.md` et `docs/11_DECISION_LOG.md` pour le détail complet.
- **V0.3_002 — Domain Coaching Enrichment** : architecture verrouillée le 2026-08-28 (voir `docs/06_ARCHITECTURE.md` §V0.3_002 et `docs/11_DECISION_LOG.md`) ; décomposition V0.3_002A (architecture, CLOSED) → V0.3_002B (Technique DH, NOT STARTED — next) → V0.3_002C (Mental) → V0.3_002D (Nutrition) → V0.3_002E (intégration/régressions) → V0.3_002F (rollout remote/clôture). Peuple `dh_or_technical`/`mental`/`nutrition`, actuellement inertes.
- Debrief course post-mortem structuré
- Planificateur hebdomadaire
- Runtime ActiveExperiment (T9)

### v1.0
- Couche D activée avec premiers patterns confirmés
- Couche E (LLM) opérationnelle
- Interface app mobile

### V2.0+
- Domaine 7 (analyse) pleinement autonome
- Détection précoce sur-entraînement
- Simulation pré-course
