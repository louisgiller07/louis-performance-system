# 01 — Product Requirements

## Vision

Le Louis Performance System est un **Head Coach IA personnel** qui accompagne Louis Giller quotidiennement dans sa carrière Elite de VTT Downhill.

Ambition : l'équivalent IA d'un excellent staff personnel de **performance** couvrant :
- coaching physique
- coaching technique DH
- coaching mental
- coaching récupération
- coaching nutrition
- prise en compte du contexte de vie
- analyse des performances

**Ce n'est pas :**
- un générateur de workouts
- un tracker de séances
- un remplacement médical, physio ou paramédical

**C'est un système de décision quotidienne multi-domaines** qui intègre l'état de Louis, son calendrier de courses, ses objectifs saison et ses patterns personnels.

Le sponsoring, le management de carrière et l'organisation logistique compétitive ne font **pas** partie du cœur actuel du Head Coach Engine. Ils pourront être ajoutés secondairement plus tard.

## Utilisateur

Un seul utilisateur en V1 : **Louis Giller**.

Les informations précises sur Louis (statut professionnel exact, disponibilité hebdomadaire, historique, objectifs chiffrés, etc.) sont documentées dans `02_ATHLETE_PROFILE.md`, qui est **la seule référence canonique** pour ces données.

Le système doit être compatible avec les contraintes de disponibilité et de vie décrites dans `02_ATHLETE_PROFILE.md`, sans les traiter comme immuables — elles peuvent évoluer, et le profil doit être maintenu à jour.

## Sept domaines de coaching couverts

1. **Technique DH** — prescrire, adapter ou protéger le travail technique
2. **Mental / confiance / race execution** — routines, cues, visualisation, race prep
3. **Préparation physique** — force, puissance, cardio, grip
4. **Sommeil et récupération** — actions concrètes, pas cibles génériques
5. **Nutrition et hydratation** — consignes contextuelles au jour, pas plan alimentaire fixe
6. **Charge professionnelle et contexte de vie** — intégrer, pas ignorer
7. **Analyse des performances** — insights au bon moment, sans surinterpréter

Voir `03_COACHING_MODEL.md` pour la maturité par domaine et les principes de décision.

## Principe central de décision

Le Head Coach identifie chaque jour **le levier le plus pertinent** au vu :
- de l'état multidimensionnel de Louis
- du bloc en cours (mode opérationnel)
- de la proximité et du contexte des courses
- des objectifs saison et long terme
- des patterns personnels appris (quand disponibles)

Parfois la meilleure intervention est une séance physique. Parfois un travail mental. Parfois une adaptation de récupération. Parfois de la protection pure. Le moteur ne présuppose jamais qu'un domaine "gagne" par défaut.

## Sortie principale : `DailyPlan`

Chaque jour, le moteur produit un `DailyPlan` structuré par domaine :

- `training` (physique)
- `dh_or_technical`
- `mental`
- `recovery`
- `nutrition`
- `sleep`
- `protection` (ce qu'il ne faut PAS faire)
- `monitoring` (ce que le système observe)
- `reasoning` (pourquoi cette décision)
- `confidence`

Chaque domaine est actif, passif ou vide selon la pertinence du jour. Cible normale : 2 à 4 domaines actifs, jamais tous en même temps.

## Contraintes structurantes de conception

### Couches de règles

Cinq couches d'évaluation, dans l'ordre :

- **A. Safety Rules** — non-contournables, écrasent tout
- **B. Mode opérationnel + contexte course** — cadre global du bloc
- **C. Coaching Heuristics** — hypothèses initiales révisables par domaine
- **D. Personal Rules** — patterns appris avec preuves suffisantes (couche vide en V0.2)
- **E. LLM Judgement** — rédaction et nuance (V0.3+, hors V0.2)

### Principes canoniques (à respecter dans toute implémentation)

1. **Aucune chaîne de downgrade générique.** Le vieux modèle `STRENGTH_A → STRENGTH_B → AEROBIC → RECOVERY → REST` est proscrit. Chaque adaptation vient d'une cause identifiée dans une dimension précise.

2. **Décisions multidimensionnelles.** Le moteur regarde `systemic`, `legs`, `arms_grip`, `mental`, `health`, `recent_load`, `context` séparément. Fatigue jambes ≠ fatigue grip ≠ mauvais sommeil ≠ stress mental ≠ douleur. Le `global_readiness` existe uniquement comme indicateur UI, pas comme cerveau de décision.

3. **Pas de double-counting.** Un même signal (ex. `sleep_deficit`) ne peut déclencher plusieurs adaptations en cascade. Une `CausalTrace` empêche la réutilisation d'un signal déjà consommé.

4. **T-X = default framework, pas rail rigide.** Le protocole T-X produit une `recommended_session` avec `soft_constraints`. Le Head Coach peut la surcharger si les dimensions du jour, les horaires officiels, le voyage ou le contexte réel le justifient. Chaque override est loggé avec `override_reason`.

5. **Soft constraints réellement soft.** Une contrainte marquée `strong` est une **forte préférence de coaching**, pas une interdiction automatique. Seule SAFETY est réellement hard. Le Head Coach peut déroger à une soft constraint si justifié — l'override est loggé.

6. **Support courses multi-jours.** Une course a `event_start` et `event_end`. Le moteur connaît le contexte pré-event (T-X), en cours (`in_progress`, `event_day`, `race_phase`), et post-event (fenêtre T+1/T+2 utile). Le moteur ne se limite pas à `event_end >= today` pour retrouver un événement récent — il regarde aussi une fenêtre post-event utile pour appliquer récupération et débrief.

7. **Douleur non-SAFETY reste actionnable.** Une douleur légère ou modérée qui ne remplit pas les critères SAFETY (non traumatique, sans perte de fonction, sans aggravation nette) doit quand même déclencher :
   - `monitoring` (observer évolution)
   - `protection` (éviter charge sur la zone concernée)
   - `adaptation` de la séance si elle sollicite cette zone
   Elle ne doit pas être ignorée. Elle ne doit pas non plus annuler automatiquement l'entraînement.

8. **SAFETY est très limitée.** Seules les vraies règles médicales non-contournables :
   - Suspicion de commotion
   - Douleur nouvelle ≥ 6/10 avec caractère sévère
   - Fièvre / maladie déclarée
   - Douleur avec critère objectif de gravité (traumatique, perte de fonction, aggravation nette sur zone à risque)
   - Retour post-commotion sans validation médicale
   Les seuils numériques comme `sommeil <4h + stress ≥8` sont des heuristiques fortes de récupération (couche C), pas SAFETY.

9. **Séparation faits / hypothèses / patterns appris.**
   - **Faits :** mesures, déclarations, résultats vérifiables → base de données factuelle
   - **Hypothèses de coaching :** interprétations initiales, révisables → couche C
   - **Patterns appris :** confirmés avec preuves longitudinales suffisantes → couche D
   Aucun pattern n'est activé sans preuves suffisantes (quantité + durée + absence de contre-exemples). Voir `03_COACHING_MODEL.md` §Patterns.

10. **Seuils numériques PROVISIONAL.** Tant qu'un seuil n'est pas calibré sur les données de Louis, il est marqué `PROVISIONAL` et documenté. Aucun seuil n'est traité comme vérité universelle sans justification.

### Séparation DB / interne (canonique)

- La DB Supabase V0.2 conserve son enum `session_type` coarse existant : `STRENGTH_A`, `STRENGTH_B`, `AEROBIC_BASE`, `AEROBIC_INTERVALS`, `DH_TECHNICAL`, `DH_PERFORMANCE`, `RECOVERY`, `REST`, `BIKE_MAINTENANCE`, `RACE_PREP`.
- Le Head Coach interne peut utiliser une représentation plus riche (`TrainingIntervention` avec variantes comme `STRENGTH_UPPER`, `STRENGTH_LOWER`, `POWER`, `GRIP_WORK`, `DH_LIGHT`, `PUMPTRACK`, `MOBILITY`, etc.).
- Un **mapping explicite** entre les deux existe. La persistance en DB utilise le `session_type` coarse. La richesse interne ne force pas la migration de la DB.
- Voir `05_DATA_MODEL.md` pour le mapping.

## Hors périmètre (V0.2)

- Supabase runtime (connexion, écriture)
- LLM runtime
- UI mobile ou web
- Intégrations wearables (Zwift, Garmin, Strava)
- Automatisations (webhooks, notifications, calendrier)
- Multi-athlètes
- Business / SaaS

Ces éléments viennent après validation de la vertical slice locale.

## Métriques de succès

### V0.2 vertical slice

- 100% des tests du `10_TEST_PLAN.md` passent
- Tests déterministes (aucun `expect().toContain([...])`)
- Build TypeScript strict sans erreur
- CLI produit un `DailyPlan` cohérent pour chaque scénario fixture

### Long terme

- Taux d'accord Louis avec le `DailyPlan` proposé ≥ 75% après 4 semaines d'usage réel
- Zéro SAFETY déclenchée à tort
- Détection d'au moins 1 pattern personnel confirmé après 90 jours de données
- Progression mesurée sur les objectifs saison 2027