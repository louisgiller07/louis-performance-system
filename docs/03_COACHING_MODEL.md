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
| C1.6 | Si fatigue AMBER : préférer spot proche |
| C1.7 | Si Bullit disponible : sessions courtes semaine possibles aux Pléiades |

*Portée V0.3_002B verrouillée (`docs/06_ARCHITECTURE.md` §V0.3_002) : `focus` = une seule chaîne de cue technique actionnable (pas de champ "priorité" séparé) ; `spot_hint` = catégorie terrain/logistique uniquement, jamais un nom de spot réel affirmé comme actuellement disponible ; la proximité course (C1.5) influence `spot_hint`, jamais `focus`.*

### Domaine 2 — Mental

| ID | Heuristique |
|---|---|
| C2.1 | Avant les courses A/A+ : proposer une cue mentale efficace pour Louis (actuellement "Comme à Wiriehorn", hypothèse issue de l'onboarding — le modèle peut apprendre qu'une autre cue fonctionne mieux) |
| C2.2 | Avant chaque run chronométré ou finale : recommander routine pit 60-90s |
| C2.3 | Cue post-erreur : toujours technique, jamais émotionnelle |
| C2.4 | Post-course : debrief mental séparé du debrief technique/physique |
| C2.5 | Si stress détecté élevé plusieurs jours → suggestion respiration courte |

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
