# PHYS-01.1 — FORCE STABILIZATION REPORT

**Date** : 2026-10-15 · **Pour** : HPM (via Louis)

**Branche** : `feat/phys-01-physical-coaching` (worktree `D:\nx\phys01`), depuis le candidat D `649a0a2`. Commit PHYS-01.1 : voir §7.
- Local uniquement : aucun push, merge, déploiement, migration ni activation V2.
- C, D (`649a0a2`), P0-SAFE et le moteur M1 figé ne sont pas touchés.

**Verdict : `READY LOCAL`** pour le parcours Force stabilisé.
- PHYS-01 reste `PARTIAL` pour les autres catégories physiques, qui n'ont pas été traitées ici (§5 de PHYS-01).
- Les règles sportives restent PROVISIONAL.

## 1. Compatibilité et rollback (démontrés sur le code réel de D)

### 1.1 Pourquoi le web de D ne lisait pas les séances PHYS-01

PHYS-01 (`5ec0976`) passait le Session Model en **v2.7**. Le web de D n'affiche une prescription que si son manifeste figure **exactement** dans sa liste blanche (v2.6, v2.5 : `SUPPORTED_SESSION_MODEL_V2_MANIFESTS`). Il refusait donc toute séance PHYS-01.

**Contre-preuve** : sur le code de D, les documents v2.7 de `5ec0976` sont tous refusés.

### 1.2 Solution rétrocompatible : aucun changement de format

- **Pas de nouvelle version.** Le Session Model reste `session-model-v2.6`, avec les mêmes versions de composants (gabarits v2.1, politique v2.4).
- **Plan inchangé.** Un plan est identique à celui de D : même snapshot, mêmes ids, même plan, démontré avec le générateur de D.
- **Ajouts du jour seulement**, à la prescription finale de Force :
  - le retour au calme, avec des exercices et une consigne déjà connus de D ;
  - la séance raccourcie (un sous-ensemble des items) ;
  - le conseil de charge (une clé additionnelle que D ignore).

  Ces ajouts sont tracés comme les règles A04 et A10 : par la règle `v2.time.strength_shortened` et par la version de règle du conseil. Leur catalogue `strength-daily-v1` est hors manifeste.

### 1.3 Ce qui a été démontré

| Démonstration | Code exécuté | Résultat |
|---|---|---|
| Lecture des anciennes séances par PHYS-01.1 | web PHYS-01.1 sur les documents générés par le moteur de D (fixtures v2.6) | toutes les suites web passent (§4) |
| Anciennes interfaces face aux nouvelles séances | **web de D** (`649a0a2`, worktree jetable, rien de commité) : son décodeur, sa carte du jour et son module Force guidé, sur les documents PHYS-01.1 | **4/4** : tout est décodé ; « Retour au calme » affiché ; conseil ignoré ; séance guidée qui tourne (9 séries de travail, 1 enregistrée) ; séance de 30 min (4 séries) |
| Contre-preuve | web de D sur les documents v2.7 de PHYS-01 | **refusés** (1/1) |
| Rollback de l'Edge vers D | **`runDailyFor` compilé de D** (`D:\nx\rel01-d-deploy`, en lecture seule) sur une base contenant des données PHYS-01.1 | **2/2** : plan de D = plan PHYS-01.1 ; D fait son KEEP et son MODIFY sans *catalog mismatch* ; retour à PHYS-01.1 : le conseil relit les séries enregistrées sous la prescription de D |

### 1.4 Ordre de déploiement et rollback (réellement exploitables)

- **Seul composant au comportement modifié : `daily-run`.**
  - `generate-training-plan` produit les mêmes plans que D : pas de redéploiement nécessaire. Son graphe change pourtant (`b53e9025…`), car un module commun a changé.
  - Le web PHYS-01.1 ajoute seulement l'affichage du conseil.
  - `session-execution`, `completed-session` et `health-flag-resolution` gardent les empreintes de D.
  - Aucune migration.
- **Ordre conseillé** :
  1. le web (sans effet visible tant que `daily-run` est en D) ;
  2. puis `daily-run`.
  - L'ordre inverse est sûr aussi : le web de D affiche les séances PHYS-01.1 (retour au calme compris), sans le conseil.
- **Rollback**, à tout moment et dans les deux sens :
  - `daily-run` → D : ses prescriptions n'ont plus de retour au calme ni de conseil ; le KEEP et le MODIFY des plans existants fonctionnent ;
  - web → D : le web de D lit toutes les séances déjà produites.
- **Aucun point de non-retour.**

## 2. Fiabilité des charges

| Exigence | Règle implémentée (PROVISIONAL) | Preuve |
|---|---|---|
| Séries réellement enregistrées | Exécutions **terminées** seulement ; séries actives (une correction remplace son original) ; jamais un set non fait, à 0 répétition ou à 0 kg | tests unitaires et bout en bout |
| Même exercice, variante compatible | **Même identifiant d'exercice** seulement (même mouvement, même matériel). Haltère ↔ barre jamais comparés. Changer de variante relance la calibration. | test « another variant is never read » |
| Unités et incréments | Cran selon le matériel : barre / poulie 2,5 kg (charge **totale**), kettlebell 4 kg, haltères 2 kg **par haltère**. L'unité est explicite dans le conseil et en aide sous le champ « charge ». « Si cette charge n'est pas disponible, prends la plus proche et note-la. » | tests `loadBasis` ; affichage web |
| Débutant | Aucun exercice chargé dans les gabarits débutants (vérifié sur tout le catalogue) ; calibration = objectif d'effort, **jamais un chiffre** | test catalogue ; pilote A |
| Répétitions terminées et RPE | Charge de travail = celle de la majorité des séries faites. +1 cran seulement si **toutes les séries prescrites** atteignent le haut de la fourchette dans l'effort cible. −1 cran si une série est sous la fourchette ou si RPE ≥ cible + 2. | table de règles |
| Pas de progression automatique en cas de douleur, de fatigue ou d'échec | Douleur déclarée (toute intensité) → `hold: pain` ; fatigue M1 (C3.3, C3.5, C3.6, C3.7) → `hold: fatigue` ; échec → baisse ou maintien, jamais de hausse ; **une seule progression à la fois** : dose du jour plus lourde (séries ou RPE cible) → `hold: dose_up` | tests ; pilote E (douleur légère, vraie décision M1) |
| Consultatif | Jamais pré-rempli, jamais imposé, sans effet sur la décision, le contenu ou la dose. Un échec de lecture laisse la séance sans conseil. | tests |

**Le scénario « 50 → 57,5 kg » clarifié.** Historique exact du pilote B (base locale, PHYS-01.1). Développé couché à la barre, plan de 6 semaines ; la semaine 4 (décharge) n'a pas de haut du corps.

| Séance | Dose prescrite | Conseil | Ce que le rider enregistre |
|---|---|---|---|
| 1 (introduction) | 3 × 8–10, RPE 5–6 | **calibration** (2 à 3 répétitions en réserve, aucun chiffre) | 3 × 10 à **50 kg**, RPE 6 |
| 2 (développement) | 4 × 6–8, RPE 7–8 | **repère 50 kg** (autre fourchette : montré, jamais converti) | choisit **55 kg** à l'effort : 4 × 8, RPE 8 |
| 3 (surcharge) | 5 × 6–8, RPE 8 | **55 kg gardés** (`dose_up` : la séance ajoute déjà une série) | 5 × 8 à 55 kg, RPE 8 |
| 4 (développement, cycle 2) | 4 × 6–8, RPE 7–8 | **57,5 kg (+2,5)** : référence séance 3, même fourchette, toutes les séries à 8, RPE 8 ≤ 8, dose du jour non plus lourde | 4 × 8 à 57,5 kg, RPE 8 |
| 5 (surcharge, cycle 2) | 5 × 6–8, RPE 8 | **57,5 kg gardés** (`dose_up`) | — |

- **Le passage de 50 à 55 kg est le choix du rider**, guidé par l'effort. NALYNT a seulement montré le repère : la fourchette avait changé.
- Le seul cran conseillé par NALYNT est **55 → 57,5 kg**.
- Dans la démonstration PHYS-01, le +2,5 kg tombait la semaine de surcharge. PHYS-01.1 l'interdit : une seule progression à la fois.

## 3. Durée des séances

**Ce qui est compté** : toute la séance, avec des bornes hautes.
- échauffement ;
- séries (4 s par répétition, 10 s de mise en place) ;
- repos du plan, à leur borne haute ;
- montée en charge du principal ;
- transitions (60 s par exercice) ;
- retour au calme.

**Ce qui est garanti** : rien n'est raccourci pour tenir. Les repos sont ceux du plan, l'échauffement est complet, la dose est celle de M1 (plus de passage en LIGHT pour une raison de temps).

**Échelle A10** : séance complète → retour au calme réduit à sa mobilité → retrait des derniers accessoires (le principal est toujours gardé) → récupération active → repos.

| Séance de 30 min (exemples) | Total | Échauffement | Séries | Repos | Montée en charge | Transitions | Retour au calme |
|---|---|---|---|---|---|---|---|
| Bas du corps LIGHT, haltères (squat goblet 3 × 8–10 + soulevé de terre roumain 2 × 10–12) | 28 | 6,8 | 4,4 | 5,5 | 3,0 | 6,0 | 2,2 |
| Haut du corps LIGHT (développé haltères 3 × 8–10 + rowing 2 × 10–12) | 27 | 4,9 | 6,0 | 5,5 | 3,0 | 6,0 | 1,2 |
| Bas du corps MODERATE (squat goblet seul, 4 × 6–8, repos 120–180 s) | 29 | 6,8 | 2,8 | 9,0 | 3,0 | 5,0 | 2,2 |
| Haut du corps MODERATE, barre (développé couché seul, 4 × 6–8) | 26 | 4,9 | 2,8 | 9,0 | 3,0 | 5,0 | 1,2 |
| Bas du corps **surcharge** (squat goblet 5 × 6–8, repos 150–180 s) | **33** | 6,8 | 3,5 | 12,0 | 3,0 | 5,0 | 2,2 |

- **La surcharge du bas du corps ne tient pas en 30 min**, même réduite à son principal. NALYNT propose alors la récupération active, et ne retire jamais une série ni un repos.
- Avec retour au calme, toutes les séances complètes restent dans les créneaux du planificateur, qui sont inchangés :

| Dose | Durée de la séance complète |
|---|---|
| LIGHT | 36–40 min |
| MODERATE | 44–51 min |
| Surcharge | 51–58 min |

## 4. Tests

### 4.1 Head Coach : écart entre 1455 et 1441

- **D (validation REL-01)** : **1455/1455**. Fichiers en séquentiel (`--no-file-parallelism`) ; Edge servie avec le flag V2 local ; `RUN_LOCAL_P0_EDGE=1`.
- **Rapport PHYS-01** : 1466 tests = 1455 de D + 11 PHYS-01. Résultat : 1440 réussis, 1 échec, **25 ignorés**. Ce passage était en parallèle, **sans `RUN_LOCAL_P0_EDGE`** et sans le flag V2 dans l'Edge.
  - Les 25 tests ignorés sont ceux des 7 fichiers activés par cette variable (P0 première génération, P0-2, P0-3, P0-4, INT-01 B…).
  - Le chiffre « 1441 » additionnait réussis et échec, sans les tests ignorés. **Aucun test n'avait disparu.**
- **PHYS-01.1, dans les conditions exactes de D** : **1472/1472**, 146 fichiers, **0 ignoré, 0 échec**, 68 preuves de cible (`nalynt-phys01` uniquement). Cela fait 1455 tests de D plus 17 nouveaux.

### 4.2 Le test de concurrence intermittent

- **Test** : `p0_3PlannedSessionLock.integration.test.ts`, « concurrency — the rider's UPDATE, then DELETE, hold the lock… ».
- **Mécanisme** :
  - la connexion A tient son verrou **4 s** (`pg_sleep(4)`) ;
  - pendant ce temps, le harnais doit observer A, lancer B, puis observer B en attente ;
  - pour cela, il passe par des `docker exec psql` **synchrones** (`execFileSync`), qui bloquent la boucle Node.
- **Ce qui s'est passé** : sous forte charge (fichiers en parallèle, runtime Edge, plusieurs stacks Docker), ces appels ont dépassé la fenêtre. A a terminé avant que B ne soit vu en attente : « the other connection ended first ».
- **Pertinence** : la propriété du produit (B attend le verrou, puis est refusé) n'est pas contredite. C'est l'observation qui a manqué sa fenêtre.
  - Isolé : 10/10, deux fois.
  - En séquentiel, dans les conditions de D : il passe, dans la suite complète 1472/1472.
  - PHYS-01 ne touche ni ce SQL ni ce code.
- **Décision** : aucune correction, et aucun délai augmenté. C'est un défaut de **déterminisme du harnais**, pas du produit.
- **Proposition, hors PHYS-01, sur décision HPM** : remplacer le `pg_sleep` fixe par une libération pilotée par le test (A attend un signal que le test envoie après avoir observé B). L'observation ne dépendrait alors plus d'aucune durée.

### 4.3 Résultats PHYS-01.1

| Suite | Résultat | Sur D |
|---|---|---|
| planning-engine | **937/937** | 883 |
| head-coach-engine, séquentiel, Edge + flag V2 + `RUN_LOCAL_P0_EDGE=1` + compatibilité D | **1472/1472** (0 ignoré) | 1455/1455 |
| web, intégrations comprises, séquentiel | **2286/2286** (23 preuves de cible) | 2274 |
| prescription-engine | **96/96** | 96 |
| longitudinal-engine (non modifié) | **890/890** | 890 |
| Web de D sur les documents PHYS-01.1 (+ contre-preuve) | **5/5** | — |
| `build:release:all` ; build web avec variables factices | OK | — |

**Bout en bout** (stack isolée `nalynt-phys01`, 74 migrations de D) :
- **A** : débutant ;
- **B** : avancé sur 6 semaines (§2) ;
- **C** : 30 min avec haltères seuls, séance raccourcie à dose LIGHT conservée ;
- **D** : signal de santé bloquant ;
- **E** : douleur légère, hausse retenue ;
- chemin Edge `daily-run` réel ;
- compatibilité avec le code de D.

## 5. Différences canoniques

Elles sont détaillées dans `docs/release/PHYS_01_PROPOSED_CANON_DIFFS.md` (docs/03, 04, 05, 07, 10), en quatre catégories :
- **A, comportement implémenté** : format inchangé, retour au calme quotidien, KEEP + retour au calme, durées estimées sous A10, échelle A10 à dose constante, conseil de charge persisté et consultatif ;
- **B, nouvelles règles de progression** : sources, calibration, référence de même fourchette, cran et unité, échec et effort, une progression à la fois, douleur et fatigue, débutants ;
- **C, validation sportive requise** : seuils, crans, estimateur de durée, composition du retour au calme, ordre de l'échelle A10, signaux M1 retenus ;
- **D, décisions produit ouvertes** : créneaux du planificateur ou durée réelle, charges disponibles du rider, progression au poids du corps, correspondances entre variantes, avertissement d'historique indisponible.

Le moteur M1 figé n'est pas modifié. L'ADR PHYS-01.1, encore à l'état de proposition, est dans `docs/11`.

## 6. Verdict

**`READY LOCAL`** — parcours Force stabilisé :
- compatible avec D dans les deux sens, sans aucun point de non-retour ;
- charges fiables et consultatives ;
- durées honnêtes ;
- suites vertes dans les conditions de D.

PHYS-01 reste `PARTIAL` pour l'endurance, la puissance et la mobilité. Les règles sont à faire valider par un préparateur physique qualifié avant toute commercialisation.

## 7. Branche et commit

`feat/phys-01-physical-coaching` : PHYS-01 `5ec0976`, puis le commit PHYS-01.1 local (identifiant dans le message de remise).

**STOP.** Aucun push, merge, déploiement, migration ni activation V2.
