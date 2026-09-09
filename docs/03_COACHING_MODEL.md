# 03 — Coaching Model

## Vision du Head Coach

Le Head Coach identifie chaque jour **le levier le plus pertinent** pour Louis parmi 7 domaines de coaching de performance. Il ne se limite pas à prescrire une séance physique.

Parfois la meilleure intervention est :
- une séance physique
- une séance technique ciblée
- un travail mental
- une adaptation du sommeil et de la récupération
- une stratégie nutritionnelle
- une décision de préservation (protéger une DH, une course, ne rien faire)
- une combinaison de plusieurs de ces leviers

---

## Les 7 domaines

### Domaine 1 — Technique DH

Objectif : prescrire, adapter ou protéger le travail technique DH.

Sorties possibles : objectif technique unique du jour, choix du spot, structure de runs, conditions d'arrêt.

**Ne s'active pas les soirs de semaine** sauf session vélo semaine possible (pumptrack 5 min du travail, Pléiades avec Bullit dès arrivée).

### Domaine 2 — Mental / confiance / race execution

Objectif : prescrire un travail mental pertinent, ou intégrer une composante mentale dans un autre domaine.

Sorties possibles : cue mentale du jour, routine à pratiquer, rappel d'un actif (Wiriehorn), debrief mental post-session structuré.

**Progression V0.2 → futur** : basique en V0.2 (cues, rappels, routines simples). Évolue avec les données longitudinales.

### Domaine 3 — Préparation physique

Objectif : prescrire ou adapter la séance physique du jour.

Sorties : `TrainingIntervention`, durée, objectif, contraintes d'intensité, `do_not_do`.

C'est le domaine le plus mûr en V0.2.

### Domaine 4 — Sommeil et récupération

Objectif : actions concrètes, pas juste "dormez plus".

Sorties : heure de coucher cible (PROVISIONAL), actions récupération spécifiques (mobilité, rouleau avant-bras, respirations), tests en cours à maintenir.

### Domaine 5 — Nutrition et hydratation

Objectif : consignes contextuelles au jour, pas plan alimentaire fixe.

Sorties : focus nutrition du jour, cible qualitative, rappels de timing (post-workout, avant course).

**Cibles chiffrées comme "2 L/jour" ou "8h sommeil" sont des baselines PROVISIONAL**, à individualiser avec les données de Louis. Elles ne sont pas traitées comme vérités universelles.

### Domaine 6 — Charge professionnelle et contexte de vie

Objectif : intégrer les contraintes hors-sport dans les décisions coach.

Sorties : adaptation du plan aux contraintes horaires, reconnaissance d'une semaine chargée, suggestion de reporter, alerte pattern émergent.

### Domaine 7 — Analyse des performances

Objectif : faire remonter au bon moment des insights, sans surinterpréter.

Sorties : insight du jour (rare, seulement si pertinent), rappel d'un pattern personnel confirmé, signal d'alerte sur tendance.

**Quasi-passif en V0.2** — devient central en couche D quand des patterns sont confirmés.

---

## Maturité par domaine (V0.2)

| Domaine | Maturité V0.2 | Évolution attendue |
|---|---|---|
| 1. Technique DH | Moyenne | Croissance avec vidéos + Bullit + secteurs course |
| 2. Mental | Basique | Croissance avec debriefs course + patterns émotionnels |
| 3. Préparation physique | Élevée | Ajustements continus, calibration |
| 4. Sommeil / Récupération | Moyenne | Croissance avec données de sommeil et wake_ups |
| 5. Nutrition / Hydratation | Basique | Croissance post audit inter-saison |
| 6. Contexte pro / vie | Basique | Croissance avec observation régularité stress |
| 7. Analyse performance | Quasi-passif | Central à partir de v1.0 |

L'architecture est prête pour les 7 domaines dès aujourd'hui, mais l'implémentation est progressive.

---

## Séparation stricte des connaissances : faits vs hypothèses vs patterns

### Faits

- Mesures, déclarations, résultats vérifiables
- Stockés en base (tables `athlete_baselines`, `daily_checkins`, `race_calendar`, etc.)
- **Ne contiennent jamais d'interprétation**

### Hypothèses de coaching

- Interprétations initiales, révisables
- Vivent dans les documents canoniques (`02_ATHLETE_PROFILE.md` §12, ce document §Domaines)
- **Ne sont jamais stockées comme "vérités" dans les tables de faits**

Exemple : "grip endurance sous-développé" est une hypothèse issue de l'onboarding, pas un fait mesuré.

### Learned Patterns (couche D)

- Corrélations confirmées avec preuves longitudinales suffisantes
- Seuil d'activation **jamais universel** (pas de "N ≥ 30" appliqué partout)
- Chaque candidat évalué individuellement selon :
  - **quantité** d'observations pertinentes
  - **durée** d'observation
  - **force** de la corrélation
  - **absence de contre-exemples** récents significatifs
  - **niveau de confiance** calculé

Un pattern simple et robuste peut être confirmé avec relativement peu d'observations si le signal est clair. Un pattern complexe demandera bien plus de données.

**Couche D vide en V0.2** — aucun pattern personnel actif.

Exemples de patterns candidats à surveiller (dans l'ordre de probabilité de découverte) :
- Effet de la coupure liquides 21h sur les réveils nocturnes
- Récupération réelle post-DH weekend
- Impact du sommeil sur les chronos
- Effet des semaines de cours (~10/an) sur la charge d'entraînement
- Réaction à différents types de charge physique

---

## Contraintes canoniques de coaching

### 1. Aucune chaîne de downgrade générique

Le vieux modèle `STRENGTH_A → STRENGTH_B → AEROBIC → RECOVERY → REST` est **proscrit**.

Chaque adaptation vient d'une **cause identifiée** dans une dimension précise.

### 2. Décisions multidimensionnelles

6 dimensions séparées :
- `systemic` (sommeil + énergie globale)
- `legs` (fatigue jambes)
- `arms_grip` (fatigue avant-bras / grip)
- `mental` (stress travail + motivation)
- `health` (douleur, maladie)
- `recent_load` (charge 7 jours)

Plus un `ContextState` séparé (bloc, mode, planned session, availability, event context, life constraints).

Fatigue jambes ≠ fatigue grip ≠ mauvais sommeil ≠ stress mental ≠ douleur.

Exemples :
- `arms_grip = RED` seul → autorise haut du corps sans grip, autorise bas du corps normal, refuse DH intense, refuse tirage lourd
- `legs = RED` seul → autorise haut du corps + grip, refuse squat lourd, refuse DH physique
- `mental = RED` seul → session physique OK mais moins exigeante mentalement
- `systemic = RED` seul → réduit intensité globale mais pas nature de la session

Le `global_readiness_ui` est un indicateur d'interface, **pas le cerveau de décision**.

### 3. Pas de double-counting

Un même signal (ex. `sleep_deficit`) ne peut pas déclencher plusieurs adaptations en cascade.

Le moteur doit **tracer les signaux déjà consommés** par les règles précédentes et empêcher leur réutilisation.

L'implémentation TypeScript exacte (classe mutable, structure immuable, closure, etc.) est laissée à Claude Code, tant que le comportement est couvert par tests.

**Propriété de signal — décision vs coaching de support (verrouillé V0.3_002A, 2026-08-28)** :
un domaine ne peut jamais reconsommer (`consume()`) un signal déjà consommé par un autre domaine, ni faire découler une seconde adaptation d'intervention de la même cause — l'exclusivité de `consume()` reste totale. Une **lecture de support non consommante** (`SignalTrace.has()`/`consumedByRule()`) reste autorisée quand elle est sémantiquement justifiée : elle permet à un domaine de décrire/expliquer une cause déjà revendiquée ailleurs, sans jamais modifier la décision du propriétaire. Premier cas d'usage verrouillé : le domaine Préparation physique reste seul propriétaire de décision des signaux `stress_high`/`motivation_low` en `mental = RED` (règle `MENTAL_RED` existante) ; le domaine Mental (V0.3_002) lit ce signal déjà consommé pour produire son propre `action_hint` explicatif.

### 4. Soft constraints réellement soft (règle canonique unique)

**SAFETY** (couche A) = **hard** / non-contournable.

**Toutes les autres couches** (B, C, D) produisent des **recommandations, contraintes ou connaissances arbitrables**.

Le poids d'une soft constraint indique la force de la préférence :
- `strong` = forte préférence, dérogation nécessite une **justification forte**
- `moderate` = préférence, dérogation possible avec justification claire
- `weak` = signal, dérogation acceptable si contexte le justifie

**`strong` ne signifie jamais "obligatoire".**

Toute dérogation significative doit être loggée avec `override_reason`.

### 5. Douleur non-SAFETY reste actionnable

Une douleur légère ou modérée qui ne remplit pas les critères SAFETY doit quand même déclencher :
- **monitoring** (observer évolution)
- **protection** de la zone concernée (éviter charge sur cette zone)
- **adaptation** de la séance si elle sollicite la zone

Elle ne doit pas être ignorée simplement parce qu'elle n'atteint pas les critères SAFETY. Elle ne doit pas non plus annuler automatiquement l'entraînement.

**Monitoring immédiat vs. suivi 24–48h (V0.3_006C1)** : le monitoring 24–48h ci-dessus reste inchangé (suivi post-séance). Pour une session DH-family, un **critère d'interruption immédiat** s'ajoute (jamais ne le remplace) : *"Pendant la séance, arrête la partie DH si la douleur augmente clairement ou si ton contrôle se dégrade."* — un critère d'arrêt opérationnel uniquement, jamais une autorisation de rouler, jamais une déclaration que la séance est sûre, jamais un seuil numérique de douleur nouveau (SAFETY A2/A4 restent l'unique seuil numérique dur). Voir §Session Prescription V1 ci-dessous et `head-coach-engine/src/domains/dhPrescription.ts#resolveDhImmediatePainMonitoringNote`.

### 6. SAFETY limitée aux vraies règles médicales

- Suspicion de commotion
- Douleur nouvelle ≥ 6/10 avec caractère sévère
- Fièvre / maladie déclarée
- Douleur avec critère objectif de gravité (traumatique, perte de fonction, aggravation nette sur zone à risque)
- Retour post-commotion sans validation médicale

Les seuils comme "sommeil <4h + stress ≥8" sont des **heuristiques fortes de récupération** (couche C), pas SAFETY.

### 7. Le moteur part du plan existant

Chemin normal de décision :

`season/block objectives → planned session → daily state → KEEP / MODIFY / REPLACE / REST`

Le moteur ne génère **pas** une séance depuis zéro par défaut. Il part du `planned_session` du contexte et décide :
- **KEEP** — dimensions permettent la séance prévue
- **MODIFY** — adaptation (intensité, volume, focus) sans changer la nature
- **REPLACE** — remplacement par une autre `TrainingIntervention` justifiée par une cause
- **REST** — récupération complète justifiée

**Fallback** : si aucune séance n'est planifiée (`planned_session = null`), le moteur peut inférer une séance depuis le contexte (mode, jour de semaine, dimensions). Cette inférence est explicitement marquée comme fallback dans `triggered_rules`.

Même si le weekly planner complet arrive en V0.3+, l'architecture V0.2 doit respecter cette logique.

### 8. Seuils numériques PROVISIONAL

Tant qu'un seuil n'est pas calibré sur les données de Louis, il est marqué `PROVISIONAL` et documenté.

Aucun seuil n'est traité comme vérité universelle sans justification.

### 9. Le Head Coach oriente vers les professionnels de santé quand nécessaire

Le Head Coach n'est pas un médecin, ni un physiothérapeute, ni un préparateur mental professionnel. Il oriente Louis vers ces professionnels quand la situation le nécessite (SAFETY déclenchée, douleur persistante, blessure suspectée, symptômes anormaux).

Le suivi médical de référence de Louis est disponible (`02_ATHLETE_PROFILE.md` §3.2).

---

## Assemblage multi-domaines : intégration

### Cohérence

Le Head Coach doit assurer que les décisions des différents domaines ne se contredisent pas. Exemple d'incohérence à éviter :
- `sleep.bedtime_hint = "22h30"` et `training.time_slot = "22h-23h30"` sont incompatibles.

### Priorisation

Cible normale : **2 à 4 domaines actifs** par jour, jamais tous en même temps.

En cas de doute sur le domaine prioritaire :

| Contexte | Domaines prioritaires |
|---|---|
| Race week T-3 à T-1 | Mental + Récupération |
| Race day | Mental + Nutrition + Sommeil |
| Weekend DH normal | Technique DH |
| Soir semaine avec force prévue | Physique |
| Fatigue AMBER + soir semaine | Récupération |
| Fatigue RED | SAFETY ou Récupération |
| Post-course A/A+ | Debrief mental + Récupération + Analyse |

### Rôle spécial du domaine 7 (Analyse)

Quasi-toujours passif en V0.2. Ne surface que dans deux cas :
1. Post-course (debrief structuré obligatoire)
2. Détection d'un signal fort (rare)

Ne jamais surcharger le `DailyPlan` d'insights non essentiels.

---

## Experiments actifs

Le moteur distingue les **règles pérennes** des **expérimentations temporaires**.

Un `ActiveExperiment` est modélisé conceptuellement :

```
ActiveExperiment {
  id
  hypothesis          // ce qu'on cherche à valider
  start_date
  intervention        // action à maintenir
  metrics             // quoi observer
  review_date         // quand évaluer
  status: active | expired | validated | rejected
}
```

Une expérimentation influence le moteur **uniquement tant que `status = active` et `today ≤ review_date`**.

Une expérimentation expirée ne doit plus influencer le coach — sa transformation éventuelle en heuristique permanente ou en learned pattern nécessite une décision explicite (validation ou rejet, tracée dans `11_DECISION_LOG.md`).

### Experiment actif au 11.08.2026

- **id** : `sleep-liquids-cutoff-2026-08`
- **hypothesis** : la coupure des liquides à 21h + arrêt Red Bull réduit les réveils nocturnes de Louis
- **start_date** : 2026-08-11
- **intervention** : plus de liquides après 21h, zéro Red Bull
- **metrics** : `sleep_wake_ups` dans le checkin quotidien
- **review_date** : à définir (typiquement 3-4 semaines)
- **status** : active

**Note scope M1** : le concept est documenté maintenant. Son implémentation runtime + les tests T9.1/T9.2 sont P1, pas M1.

---

## Coaching Heuristics initiales (couche C)

Toutes les heuristiques ci-dessous sont **PROVISIONAL** et révisables. Elles vivent dans le moteur mais ne sont pas des vérités absolues.

### Domaine 1 — Technique DH

| ID | Heuristique |
|---|---|
| C1.1 | Une seule cue technique par session DH |
| C1.2 | Weekend DH complet (Sa+Di) autorisé hors race week et hors overload |
| C1.3 | Session DH intense max 1 par weekend en RACE_CLUSTER |
| C1.4 | Choix du spot par priorité contextuelle (voir `02_ATHLETE_PROFILE.md` §9) |
| C1.5 | Si course dans ≤ 2 semaines : favoriser le spot de la course |
| C1.6 | Si fatigue AMBER **ou RED** (systemic/legs/arms_grip) : préférer spot proche/terrain à demande réduite (corrigé V0.3_006C1 — une fatigue RED aboutit souvent à une session déjà réduite par Training, ex. pivot DH_LIGHT/LIGHT, mais reste DH-family et doit donc aussi recevoir un terrain à demande réduite, jamais retomber sur le terrain frais/course par défaut) |
| C1.7 | Si Bullit disponible : sessions courtes semaine possibles aux Pléiades |

*Portée V0.3_002B verrouillée (`docs/06_ARCHITECTURE.md` §V0.3_002) : `focus` = une seule chaîne de cue technique actionnable (pas de champ "priorité" séparé) ; `spot_hint` = catégorie terrain/logistique uniquement, jamais un nom de spot réel affirmé comme actuellement disponible ; la proximité course (C1.5) influence `spot_hint`, jamais `focus`.*

#### Session Prescription V1 — DH-first (V0.3_006B, PROVISIONAL)

Corrige le constat du deuxième cycle de dogfood externe : une recommandation DH ("DH performance · charge lourde") indiquait une catégorie de séance mais jamais une fenêtre exécutable — l'athlète devait reconstruire lui-même combien de temps prévoir, avec quel focus, sur quel terrain. Périmètre strictement DH-first : `DH_PERFORMANCE`, `DH_TECHNICAL`, `DH_LIGHT`, `PUMPTRACK` (même modèle utile, `RACE_ACTIVITY` explicitement exclu — compatibilité uniquement, aucune prescription de jour de course).

**Sémantique critique de `duration_min` pour une session DH** : représente la **fenêtre totale de session / temps passé sur le site de pratique**, jamais le temps de pédalage/descente continu, le temps physiologique effectif, ni le temps de descente cumulé. Inclut conceptuellement : descente, remontée mécanique/tire-fesses/navette, pauses, attente, reconnaissance, récupération normale entre les runs. Une journée DH d'environ 09h30 à 16h00 représente une fenêtre d'environ 6 à 6h30, même si le temps de descente réel est largement inférieur. Ne jamais interpréter `duration_min = 360` comme "6 heures d'effort physique continu".

**Table PROVISIONAL de fenêtre de session** (cibles génériques de coaching, jamais une limite physiologique individualisée — voir `head-coach-engine/src/config/sessionPrescriptionPolicy.ts`, source de vérité runtime unique) :

| Kind | LIGHT | MODERATE | HEAVY |
|---|---|---|---|
| DH_PERFORMANCE | 180 min (~3 h) | 270 min (~4 h 30) | 360 min (~6 h) |
| DH_TECHNICAL | 180 min (~3 h) | 240 min (~4 h) | 330 min (~5 h 30) |
| DH_LIGHT | 150 min (~2 h 30) | 210 min (~3 h 30) | 270 min (~4 h 30) |
| PUMPTRACK | 60 min (~1 h) | 105 min (~1 h 45) | 150 min (~2 h 30) |

`DH_LIGHT`/HEAVY est une combinaison atypique (le kind "léger" avec une charge lourde) mais réellement atteignable aujourd'hui (planification athlète directe sans qu'aucune règle d'adaptation ne l'interdise) — une valeur provisoire cohérente (270 min) est définie plutôt que de rendre silencieusement la combinaison impossible.

**LoadProfile ≠ duration** : HEAVY/MODERATE/LIGHT reste le concept qualitatif existant de charge globale d'entraînement, jamais redéfini comme une durée. La table choisit simplement une fenêtre de session typique pour une combinaison kind/charge finale donnée — une longue journée DH peut contenir une part importante de remontées/attente/récupération.

**Aucun mapping RPE** : aucune correspondance canonique LoadProfile → RPE cible n'existe (ni dans ce document, ni dans le code) — V1 n'en invente aucune. `completed_sessions.rpe` reste exclusivement l'effort ressenti réel post-séance (NAL-006).

**Aucun modèle de nombre de runs / dénivelé** : NALYNT ne connaît aujourd'hui ni la longueur de piste, ni la vitesse de remontée, ni l'affluence — un nombre de runs ou un dénivelé cible créerait une fausse précision. Différé.

**Précédence de durée explicite (corrigée)** : la durée `planned_session.duration_min` explicitement fournie par l'athlète (aujourd'hui non exposée par l'interface Planning) reste une **information de confiance**, jamais silencieusement écrasée par la table provisoire :
- **Aucune durée explicite** → valeur provisoire générique pour la combinaison kind/charge **finale**.
- **Durée explicite ET arbitrage n'a strictement rien changé** (kind + charge identiques au planifié, un vrai KEEP) → la durée explicite exactement, quelle que soit sa position par rapport à la table provisoire.
- **Durée explicite ET l'arbitrage a changé le kind et/ou la charge** (fatigue, douleur, mental, préservation de famille engagée, protocole de course) → **MIN(durée explicite, valeur provisoire pour la combinaison finale)**. La durée explicite devient une **borne supérieure**, jamais un plancher : une adaptation censée réduire la charge d'entraînement ne doit jamais silencieusement allonger une séance plus courte voulue par l'athlète jusqu'à une valeur générique plus longue. Exemple : `DH_PERFORMANCE`/`HEAVY`/120 min rétrogradé en `MODERATE` (mental RED) reste 120 min, jamais 270 min (la valeur provisoire `MODERATE`) ; à l'inverse, `DH_PERFORMANCE`/`HEAVY`/360 min rétrogradé en `MODERATE` devient 270 min (la durée explicite dépassait la valeur provisoire, plafonnée).

Ne jamais interpréter la table provisoire comme une autorisation d'étendre une disponibilité contrainte par l'athlète.

**Focus technique — repli générique** : `athlete_coaching_profiles.technique_primary_focus` reste prioritaire. En son absence, un repli générique fixe par kind est utilisé (jamais présenté comme une personnalisation apprise) :

| Kind | Focus générique |
|---|---|
| DH_PERFORMANCE | Précision des lignes et vitesse maîtrisée |
| DH_TECHNICAL | Précision et qualité d'exécution |
| DH_LIGHT | Fluidité, relâchement et marge |
| PUMPTRACK | Pompage, trajectoires et conservation de vitesse |

**Monitoring fatigue DH** : quand une adaptation fatigue (C3.3/C3.5/C3.6) s'applique et que la session finale reste DH-family, une instruction opérationnelle concise est ajoutée à `monitoring.observe` ("Réduis encore la séance ou arrête la partie DH si ta précision se dégrade nettement ou si la fatigue jambes/grip augmente pendant la session.") — aucun seuil numérique non validé.

**Précédence Safety absolue** : la prescription est calculée sur la session finale entièrement arbitrée (après Training/douleur/contraintes soft/A5) — un A1 (REST) ne produit jamais de durée/focus/terrain DH ; un A5 (DH forcé en `RECOVERY_ACTIVE`) ne laisse subsister aucune prescription DH périmée.

Voir `docs/06_ARCHITECTURE.md` §V0.3_006B pour l'architecture V1 complète.

#### DH Execution Guidance (V0.3_006C1)

Corrige le constat du deuxième cycle de revue externe : la prescription V1 indique quoi faire (kind/charge/durée/focus) mais l'athlète devait encore traduire lui-même la recommandation en comportement de conduite concret. Toujours aucun `DailyPlan.prescription` séparé — enrichissement exclusif des structures déjà authoritatives.

**Comportement d'exécution par charge** (`dh_or_technical.load_guidance`, champ optionnel — engine-emitted et **persisté**, résolu depuis `final_session.load_profile` par `head-coach-engine/src/domains/dhPrescription.ts#resolveDhLoadGuidance` sur la session finale entièrement arbitrée ; copie approuvée dans `sessionPrescriptionPolicy.ts#DH_LOAD_GUIDANCE`, purement qualitatif, aucun RPE/pourcentage de runs/vitesse inventé) :
- **LIGHT** : aucune recherche de vitesse/performance, priorité fluidité/exécution propre, marge maintenue sur toute la session.
- **MODERATE** : qualité d'exécution avant vitesse maximale ; engagement accru uniquement quand lignes/contrôle restent propres, jamais tous les runs poussés.
- **HEAVY** : séance orientée performance, engagement progressif, vitesse travaillée sans jamais sacrifier précision/contrôle (HEAVY ne signifie jamais une conduite délibérément imprudente).

*Correction d'architecture (V0.3_006C1, avant tout commit)* : cette copie était initialement web-only (recalculée dans `web/src/features/dailyPlan/dhPrescriptionLabels.ts#DH_LOAD_DESCRIPTION` à partir de `final_session.load_profile`). C'est une prescription de coaching substantielle, pas un simple libellé d'UI — elle doit donc rester ce que le moteur a réellement prescrit au moment de la génération, jamais recalculée a posteriori par le bundle web. Corrigée pour être engine-emitted/persistée avant tout commit de ce jalon.

**Invariant canonique d'historique** : un `DailyPlan` persisté fait foi de ce que le coach a réellement prescrit au moment de sa génération. L'historique (`/history` comme la restauration `/today`) peut appliquer traductions, libellés, mise en forme et sanitization de termes techniques, mais ne doit **jamais** ajouter une instruction de coaching substantielle absente du plan persisté d'origine. Concrètement : un `DailyPlan` V0.3_006B (antérieur à cette correction) qui n'a jamais porté `load_guidance` ne doit **jamais** gagner rétroactivement le texte de comportement HEAVY/MODERATE/LIGHT simplement parce que le bundle web a changé — seul le libellé neutre de charge (`web/src/features/dailyPlan/dailyPlanLabels.ts#LOAD_PROFILE_LABELS`, ex. "charge lourde") est affiché pour un tel plan legacy. Voir `web/src/features/dailyPlan/DailyPlanView.tsx` (rendu conditionnel sur la présence de `load_guidance`) et le test de régression dédié dans `web/src/features/{dailyPlan/DailyPlanResult,history/HistoryDetail,dailyPlan/DailyPlanPanel}.test.tsx`.

**Terrain — précédence déterministe** (`head-coach-engine/src/domains/technique.ts#selectSpotHint`, une seule recommandation gagnante, jamais concaténée) : douleur non-SAFETY constrainante (upper_grip ou membre inférieur) > fatigue significative (**AMBER ou RED**, systemic/legs/arms_grip — corrigé V0.3_006C1, voir C1.6 ci-dessus : une fatigue RED ne doit jamais retomber sur le terrain frais/course par défaut) > Mental RED > proximité course > frais/défaut. Toujours une caractéristique de terrain descriptive (jamais un nom de spot réel, jamais GPS/base de données). Les deux variantes douleur restent un langage générique de réduction de sollicitation mécanique ("terrain moins cassant/moins exigeant en freinage et en grip", "terrain moins exigeant physiquement") — **jamais** une affirmation de sécurité médicale pour une zone donnée. Voir `head-coach-engine/src/config/sessionPrescriptionPolicy.ts#DH_SPOT_HINT`.

**`execution_task` — nouveau champ optionnel de `dh_or_technical`** : `focus` = ce qui est travaillé, `execution_task` = comment le travailler aujourd'hui, `load_guidance` = comment rouler selon la charge du jour — trois champs distincts, jamais fusionnés. Peuplé **uniquement** quand le focus résolu vient du repli générique (jamais dérivé du texte libre `technique_primary_focus` personnel — aucune tentative déterministe de "comprendre" un texte libre arbitraire, aucun LLM). Une tâche fixe par kind DH, voir `sessionPrescriptionPolicy.ts#DH_GENERIC_EXECUTION_TASK`.

**Priorité d'exécution mentale — action pré-run unifiée** : quand une action mentale AMBER/RED existante se déclenche et que la session finale reste DH-family, `mental.action_hint` devient un template unique remplaçant (jamais en complément, pour ne jamais dupliquer la mention de respiration) le texte de base AMBER/RED : *"Avant de partir, fais quelques respirations lentes puis rappelle-toi ta priorité : [focus]. Pendant le run, reviens uniquement à ce focus."* — une action concrète avant le run + le focus technique déjà résolu comme priorité attentionnelle pendant l'exécution. Aucune nouvelle cue, aucun compte de respiration inventé, aucun LLM.

**Monitoring immédiat douleur non-SAFETY** : voir §5 ci-dessus — additif au monitoring 24–48h existant, jamais un remplacement, jamais une déclaration de sécurité.

**Nettoyage de présentation (aucun changement de provenance technique)** : `web/src/features/dailyPlan/safetyPresentation.ts` sanitize désormais, en plus du cas A5 (V0.3_006A1), le rule_id `MENTAL_RED` (texte fixe substitué) et `PAIN_NON_SAFETY` (texte dynamique reconstruit à partir du code de localisation de douleur, jamais "non-SAFETY" ni le code brut exposés à l'athlète), ainsi que tout code `pain_location_code` brut apparaissant dans `monitoring.observe`/`protection.do_not_do`. Le libellé français canonique de chaque code (`web/src/features/checkin/checkinTypes.ts#PAIN_LOCATION_LABELS`) est la même source utilisée par le sélecteur de check-in — jamais une seconde copie. `triggered_rules`/`decisions.daily_plan` restent byte-for-byte ce que le moteur a émis ; seule la présentation change.

**Limite clinique explicite** : aucune des additions ci-dessus n'affirme qu'une activité est médicalement sûre, n'autorise une auto-clôture de suivi, ni n'invente un seuil de douleur numérique — SAFETY A2/A4 restent l'unique seuil dur. Toute évolution vers une affirmation de sécurité clinique spécifique à une zone/un terrain nécessiterait une décision de politique Safety/médicale séparée, non prise par ce jalon.

Voir `docs/06_ARCHITECTURE.md` §V0.3_006C1 et `docs/11_DECISION_LOG.md` pour l'architecture complète.

### Domaine 2 — Mental

| ID | Heuristique |
|---|---|
| C2.1 | En PRE_EVENT, toute priorité : proposer une cue mentale efficace pour Louis (actuellement "Comme à Wiriehorn.", hypothèse issue de l'onboarding — la cue pourra être réévaluée par une décision future explicite) |
| C2.2 | Avant chaque run chronométré ou finale : recommander routine pit 60-90s |
| C2.3 | Cue post-erreur : toujours technique, jamais émotionnelle |
| C2.4 | Post-course : debrief mental séparé du debrief technique/physique |
| C2.5 | Si stress élevé détecté (AMBER) → suggestion respiration courte, retour à une priorité unique |
| C2.6 | Si motivation basse détectée (AMBER) → suggestion d'une action simple unique pour démarrer (verrouillé V0.3_002C, 2026-08-29) |

*Portée V0.3_002C verrouillée (`docs/06_ARCHITECTURE.md` §V0.3_002) : régulation courte en `mental = AMBER`, cue attentionnelle en `PRE_EVENT`, lecture de support en `RED` (signal déjà propriété de Training). C2.2 (pit routine), C2.3 (cue post-erreur en direct) et le debrief mental post-course structuré (C2.4) restent différés — aucun déclencheur intra-jour fiable dans ce moteur à cadence quotidienne.*

### Domaine 3 — Préparation physique

| ID | Heuristique |
|---|---|
| C3.1 | Pas de force lourde bas du corps à J-1 ou J-2 d'une DH importante |
| C3.2 | Pas de travail grip lourd en race week |
| C3.3 | Sommeil < 6h + force bas du corps prévue → adaptation d'intensité (pas downgrade automatique) |
| C3.4 | 48h min entre 2 séances force lourdes bas du corps (PROVISIONAL) |
| C3.5 | Grip fatigue élevée → pivot vers exercices sans grip |
| C3.6 | Jambes fatigue élevée → pivot vers haut du corps ou DH léger |
| C3.7 | Charge 7j VERY_HIGH → forte recommandation de récupération (soft, arbitrable — pas une force absolue) |
| C3.8 | En RACE_CLUSTER, développement possible si compatible avec récup + DH + proximité course |

### Domaine 4 — Sommeil et récupération

| ID | Heuristique |
|---|---|
| C4.1 | Cible sommeil initiale : 8h (baseline PROVISIONAL, à individualiser) |
| C4.2 | En race week : bedtime cible plus tôt |
| C4.3 | Experiment actif `sleep-liquids-cutoff-2026-08` : coupure liquides 21h + zéro Red Bull. Applicable tant que l'experiment est actif (voir §Experiments). |
| C4.4 | Post-DH intense : proposer 5 min rouleau/massage avant-bras |
| C4.5 | 3 jours consécutifs sommeil < 7h : alerte + adoucissement |
| C4.6 | Sommeil <4h ET stress ≥8/10 : heuristique forte de récupération (ex-A4 SAFETY) |

### Domaine 5 — Nutrition et hydratation

| ID | Heuristique |
|---|---|
| C5.1 | En race week : rappeler apport énergétique augmenté (pas de % chiffré tant que audit nutrition pas fait) |
| C5.2 | Post-force : protéines + glucides dans les 60 min |
| C5.3 | Hydratation cible baseline : ~2 L/jour (PROVISIONAL) |
| C5.4 | Hydratation cible baseline jour DH : ~3-3.5 L/jour (PROVISIONAL) |
| C5.5 | Zéro stimulants (Red Bull, café tardif) tant que l'experiment `sleep-liquids-cutoff-2026-08` est actif |
| C5.6 | Jour de course : petit-déjeuner riche à 2h min avant premier run |

*Portée V0.3_002D verrouillée (`docs/06_ARCHITECTURE.md` §V0.3_002) : uniquement guidance contextuelle race-week/jour-DH/séance de force ; `hydration_target_l` peuplé seulement quand une cible numérique canonique unique existe déjà (C5.3), jamais un point estimé inventé depuis une plage (C5.4 reste en `notes`) ; aucun nouveau seuil numérique introduit. C5.5 reste différé jusqu'à l'existence réelle du runtime `ActiveExperiment`.*

### Domaine 6 — Contexte professionnel

| ID | Heuristique |
|---|---|
| C6.1 | Stress ≥ 7 sur 3 jours consécutifs : alerte + adoucissement |
| C6.2 | Semaine en cours : réduire attentes vendredi PM |
| C6.3 | Voyage : adapter contenu (mobilité + isométries si limité) |
| C6.4 | Reporter décisions structurantes (pro, vie) en jours calmes |

### Domaine 7 — Analyse

| ID | Heuristique |
|---|---|
| C7.1 | Après course A/A+ : générer debrief structuré |
| C7.2 | Jamais afficher un pattern comme "confirmé" sans preuves longitudinales suffisantes |
| C7.3 | Tendance visible : signaler comme "hypothèse à observer", pas fait |
| C7.4 | Premières règles personnelles envisageables selon la robustesse du signal, pas selon un seuil universel |
