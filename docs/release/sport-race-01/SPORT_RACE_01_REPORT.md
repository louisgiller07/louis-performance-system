# SPORT_RACE_01_REPORT — préparation des semaines de course DH

**Date** : 2026-10-19 · **Pour** : HPM et Louis, puis le préparateur physique pour les questions sportives · **Branche** : `fix/sport-race-01`, depuis la production `79b4d19` · **Nature** : développement local seulement.

**Verdict : BLOCKED (arbitrage requis).**
- **Le défaut est réel et reproduit.** De J-6 à J-1, NALYNT ne propose aucune séance exécutable, quel que soit le format.
- **Le moteur n'est pas en cause.** Il applique fidèlement trois règles du canon :
  - le plan V2 ne contient aucune séance en semaine de course (politique PROVISIONAL) ;
  - le quotidien V2 n'invente jamais une séance un jour sans séance prévue ;
  - seuls deux formats ont un protocole d'avant-course.
- **La correction exige un changement de contrat et des choix sportifs.** Ils sont proposés ici (§ 4 et § 8), mais ni appliqués ni codés.

**Ce qui a été fait, en local seulement** :
- aucun code moteur ni web modifié ; aucune migration ; aucun flag ;
- un test d'intégration qui fixe le contrat actuel de la semaine de course ;
- statut et backlog à jour ;
- preuves dans `evidence/`.

**Méthode**
- **Code** : le runtime de production compilé (`nalynt-rc-79b4d19`) et le web de production. Les chemins réels :
  - génération V2 ;
  - acceptation du plan ;
  - `runDailyFor` (M1, réconciliation V2, A10, persistance) ;
  - `record_session_execution`.
- **Environnement** : pile locale isolée (SQL 76), riders fictifs, flags OFF.
- **Preuves** :
  - `evidence/SPORT_RACE_01_REAL_DECISIONS.txt` : toutes les décisions jour par jour ;
  - `evidence/SPORT_RACE_01_VISIBLE_TEXTS_375.txt` : textes affichés à 375 px ;
  - scripts de simulation : espace de travail de la session.

---

## 1. Causes exactes des défauts observés

### 1.1 Les six formats, de J-7 à deux jours après la course

**Rider et plan**
- Rider C de SPORT-VALIDATION-01 : Force intermédiaire, DH avancé, salle complète, 4 terrains.
- Créneaux : lundi à vendredi « physical », samedi et dimanche « riding ».
- Plan généré le dimanche 2026-11-01 ; les semaines 1 et 2 sont faites en entier.
- Rôles des semaines (identiques pour les six formats) :

| Semaine | Rôle | Séances |
|---|---|---|
| 2–8.11 | `race_specific` | Force MODERATE 60, endurance MODERATE 45, DH MODERATE 90 × 2 |
| 9–15.11 | `taper` | Force LIGHT 45 (lun.), endurance LIGHT 45 (mar.), DH LIGHT 60 à 4 passages (sam. 14) |
| 16–22.11 | `race` | **aucune séance** |
| 23–29.11 | `introduction` | 5 séances LIGHT |

**Notation**
- ✔ : prescription du jour créée, donc séance guidée exécutable.
- ✘ : aucune prescription, statut `blocked` avec la raison indiquée.

**Formats sans protocole d'avant-course** : SWISS_CUP, OTHER et sans format, course du samedi 21 au dimanche 22. Ces trois cas sont identiques, car « sans format » devient `OTHER`.

| Jour | Séance prévue | Décision M1 | Prescription |
|---|---|---|---|
| J-7 (sam. 14) | DH LIGHT 60 (affûtage) | KEEP DH LIGHT 60 | ✔ |
| J-6 à J-1 | aucune | KEEP récupération active (`INFERENCE_FALLBACK`) | ✘ `no_lineage` / `no_planned_session` |
| J0, J+1 | aucune | KEEP `RACE_ACTIVITY` | ✘ `no_lineage` |
| fin+1, fin+2 | Force LIGHT 45 | REPLACE récupération active (`POST_EVENT`) | ✔ |

**UCI_WC**, du vendredi 20 au dimanche 22 : même schéma.
- J-7 (vendredi 13) : rien de prévu, récupération ✘.
- J-6 (samedi 14) : DH d'affûtage ✔.
- J-5 à J-1 : récupération ✘.
- J0 à J+2 : course ✘.

**`HOT_TRAIL_2DAY`**, du samedi 21 au dimanche 22 :

| Jour | Prévu | Décision M1 (protocole T-X) | Prescription |
|---|---|---|---|
| J-7 (sam. 14) | DH LIGHT 60 | **REPLACE Force haut du corps LIGHT 45** (T-7) | ✔, un jour où le rider n'a qu'un créneau vélo |
| J-6 (dim. 15) | — | KEEP DH MODERATE **240 min** (T-6) | ✘ ; affiché « DH technique, 4 h, charge modérée » |
| J-5 | — | KEEP endurance LIGHT 30 | ✘ |
| J-4, J-3 | — | KEEP récupération active, puis 20 min | ✘ |
| J-2, J-1 | — | KEEP REPOS | ✘ (repos voulu) |
| J0, J+1 | — | `RACE_ACTIVITY` | ✘ |
| fin+1, fin+2 | Force LIGHT 45 | REPLACE récupération active | ✔ |

**`IXS_3DAY`**, du vendredi 20 au dimanche 22 :
- J-7 (vendredi 13) : Force haut LIGHT ✘.
- J-6 (samedi 14) : DH d'affûtage LIGHT 60 maintenue (`PLANNED_LOAD_CAP`) ✔.
- J-5 : endurance 30 ✘.
- J-4 et J-3 : récupération ✘.
- J-2 : repos ✘.
- J-1 : `RACE_ACTIVITY` (practice officielle) ✘.
- J0 à J+2 : course ✘.
- fin+1 et fin+2 : récupération ✔.

### 1.2 Pourquoi une séance est proposée ou non

| Catégorie demandée | Constat | Où |
|---|---|---|
| **Absence de séance initialement planifiée** (cause principale) | La semaine de course V2 n'a aucune séance (gabarit `race` à 0 séance), et un jour sans séance prévue n'a jamais de prescription du jour, quelle que soit la recommandation de M1 (y compris un T-X ou une récupération). Avec une séance prévue, le même protocole T-X produit des séances exécutables (§ 5.3) | canon `docs/03` §6 (« semaine de course : aucune séance normale », PROVISIONAL ; « Un KEEP sans séance prévue […] n'a pas de prescription du jour : aucune séance n'est inventée ») ; code `weekTemplateCatalog.ts:91-95`, `buildKeepFinalPrescriptionV2.ts` (`no_planned_session`) |
| **Absence de protocole** | Pas de table d'avant-course pour SWISS_CUP, UCI_WC, UCI_WORLDS, OTHER ni l'absence de format : M1 retombe sur sa récupération par défaut chaque jour. Le rider ne peut d'ailleurs choisir que « Course sur 2 jours », « Course sur 3 jours » ou « Autre format » | `docs/04` §3 (tables HOT_TRAIL et IXS seulement) ; ADR 11:596 ; `raceProtocol.ts:83-87` ; UI A09 (11:5706) |
| **Règle de récupération volontaire** | T-4 et T-3 récupération, T-2 et T-1 repos (T-X) ; T+1 et T+2 récupération ; `INFERENCE_FALLBACK` = récupération, valeur générique sûre | `docs/04` §3 ; `fallbackInference.ts` |
| **Disponibilité insuffisante** | Aucune dans les six formats (rider C). Voir D2 (3 créneaux) et D4C (DH manuelle un jour sans créneau vélo) au § 5 | — |
| **Protection de santé** | Aucune avec un check-in neutre. Avec une fièvre (D3), A3 puis A7 imposent le repos jusqu'à la levée du signal, jours de course compris : c'est le comportement voulu | P0-SAFE |
| **Défaut de code** | **Aucun** au sens d'une règle approuvée violée. Les points discutables relèvent de règles (§ 4) | — |

### 1.3 Ce que voit le rider (web de production, 375 px)

- **Un jour sans séance prévue** : Aujourd'hui affiche la recommandation de M1 comme « Ta mission du jour, NALYNT te propose cette séance », mais sans bouton de séance guidée. La page de séance indique « Pas de séance guidée pour cette recommandation. » C'est cohérent avec le canon : un conseil, pas une séance guidée.
- **Ce que reçoit le rider dans les faits** :
  - formats sans protocole : six jours de « Récupération active » ;
  - Hot Trail, J-6 : « DH technique, 4 h, charge modérée ». Ces 240 min sont la fenêtre V1 de M1, appliquée faute de séance V2 ;
  - IXS, J-5 : « Aérobie base, 30 min ».
- **Course ajoutée après la génération, format « Autre »** : aucun affûtage. Force MODERATE 60 à J-5 et J-4, endurance MODERATE 60 à J-3 (E1, § 5). C'est conforme à l'avertissement A09, « Pas d'affûtage spécifique automatique ».
- **Séance manuelle, ou du plan, remplacée par le REPOS du T-X ou par la course** : Aujourd'hui affiche « Repos » ou « Activité course » et « Pas de séance guidée ». Aucun message trompeur visible.

---

## 2. Contrats canoniques existants

| Sujet | Règle approuvée | Référence |
|---|---|---|
| Contexte d'événement | Fenêtres : avant-course ≤ 7 jours, en cours, après-course ≤ 2 jours. Statuts : annulé ou ignoré exclus, terminé seulement pour l'après-course | `docs/04` §3 (212-218, 316-322) |
| Protocole T-X | « default framework, pas un rail rigide », jamais forcé. Tables seulement pour HOT_TRAIL_2DAY et IXS_3DAY : T-7 Force haut léger, T-6 DH technique, T-5 endurance courte, T-4 et T-3 récupération, T-2 repos, T-1 repos (HOT_TRAIL) ou activité de course (IXS) | `docs/04` 220-297 |
| Programme officiel | Il prime sur le T-X (`race_phase`) ; **aucune donnée ne le porte** (pas de colonne, pas de saisie) | `docs/04` 299-303 ; ADR 11:597 ; `docs/05` (race_calendar) |
| Format absent | NULL devient `OTHER` avec un avertissement ; `OTHER` ne déclenche aucun T-X ; message UI : « Pas d'affûtage spécifique automatique les jours précédents » | ADR 11:596, 11:5706 |
| Modes | RACE_WEEK : `no_development`, `no_grip_heavy`, `no_dh_intense` (fortes). Le mode vient de `training_blocks` ; un rider V2 est en `UNSPECIFIED` : ces contraintes ne s'appliquent jamais à lui | `docs/04` 173 ; `docs/05` 59-63 |
| Plan V2 | Course dans la semaine → `race` (aucune séance) ; la semaine d'avant → `taper` ; deux semaines avant → `race_specific` ; ensuite `introduction`. Doses PROVISIONAL. Course C ignorée par le macro-plan | `docs/03` §6 (400-404) ; ADR UX-11A.5a.4 (11:3975, « Accepted (architecture) / PROVISIONAL (contenu) ») ; BUG-V2-2 (11:5143) ; A09 |
| Quotidien V2 | KEEP copiable seulement avec une lignée du plan courant ; « Un KEEP sans séance prévue (récupération par défaut, protocole avant course) n'a pas de prescription du jour : aucune séance n'est inventée » ; « le moteur n'invente jamais […] une séance sans prescription » | `docs/03` 448, 459 ; `docs/05` 286, 314 |
| REPLACE (A04) | Builders Force, DH, endurance, récupération ; **lignée de plan obligatoire** ; `RACE_ACTIVITY` → `replace_target_not_supported` | ADR 11:5269-5274 |
| A10 | Une prescription bloquée reste bloquée ; seule exception : refus `modify_not_supported` → récupération active | `docs/04` 481-489 |
| Séance manuelle (P0-3) | Seul cas où une prescription est construite sans séance générée : une séance saisie par le rider dans `/plan`, avec les builders de REPLACE | `docs/05` 293-297 |
| Plan V2 et engagement | « un plan V2 ne marque pas ses séances comme « engagées » » : en approche de course, le T-X remplace la séance du plan | ADR 11:5518 ; `docs/04` 324-330 |
| Constantes | Une séance principale par jour au plus ; créneaux `riding` / `physical` / `any` (DH sur vélo, Force sur physique), au placement seulement ; Safety A1–A7 seules règles dures | `docs/05` 234-250, 375 ; `docs/04` §2 |

**Incohérences canoniques à signaler** (sans effet sur ce défaut, à corriger séparément) :
- `docs/03` 453 et `docs/05` 286 disent encore que MODIFY et REPLACE ne produisent aucune prescription, ce qu'A04 a remplacé ;
- `docs/06` 526 suppose une `race_phase` saisie sur la course, alors qu'elle n'existe pas ;
- `docs/10` 182 et 578 décrivent encore l'ancien découpage hebdomadaire du fallback.

---

## 3. Corrections locales démontrables

**Aucune correction de code.** J'ai cherché un défaut qui relève sans ambiguïté des règles approuvées ; je n'en ai trouvé aucun. Les comportements gênants sont tous des choix du canon :
- la semaine de course vide ;
- l'interdiction d'inventer une séance ;
- l'absence de protocole pour les autres formats ;
- l'interaction entre le T-X et le plan V2 ;
- la fenêtre V1 de M1, gelée.

Les corriger dans le code reviendrait à modifier la spec silencieusement.

**Livré, en local** :
1. **`head-coach-engine/tests/supabase/sportRace01.integration.test.ts`**, 7 cas sur les chemins réels, qui fixent le contrat actuel :
   - plan autour d'une course, une séance par jour au plus ;
   - `IXS_3DAY`, de J-7 à fin+1 ;
   - formats sans protocole (`OTHER`, `SWISS_CUP`, `UCI_WC`, sans format) ;
   - Hot Trail à J-7 et J-6 ;
   - fièvre à J-2 ;
   - course ajoutée après le plan ;
   - séance terminée puis nouveau `daily-run`, sans doublon.

   Il servira de référence si le contrat change.
2. **`docs/00_PROJECT_STATUS.md`** : SPORT-SAFE-01 CLOSED en production (décision HPM) ; SPORT-RACE-01 BLOCKED.
3. **`docs/12_BACKLOG.md`** : SPORT-SAFE-01 coché ; nouvelle entrée SPORT-RACE-01, avec les arbitrages.
4. **Ce rapport et ses preuves.**

---

## 4. Arbitrages à effectuer

| # | Question | Constat | Recommandation |
|---|---|---|---|
| **AR-1** | Contrat de la semaine de course V2 | Aucune séance exécutable de J-6 à J-1 | **Option P** (§ 8) : le plan V2 place les séances d'avant-course du protocole du format, avec les doses V2 existantes ; le quotidien est inchangé. L'option D (création quotidienne) demanderait SQL et l'abandon de `docs/03` 448 : déconseillée pour la bêta |
| **AR-2** | Protocole T-X pour DH | Tables HOT_TRAIL et IXS non validées par un préparateur (question 11 de SPORT-VALIDATION-01) | Validation du préparateur avant usage dans le plan |
| **AR-3** | Formats sans protocole (Swiss Cup, UCI, autre, inconnu) | Six jours de récupération conseillée, aucune séance guidée ; pas de calendrier commun supposé | Conserver ce comportement conservateur (aucune activation, aucune intensité ajoutée), mais le dire clairement au rider. Demander : jours d'entraînement officiel et de reconnaissance, qualifications, finales, jours de voyage, disponibilités de la semaine |
| **AR-4** | T-7 et dernière DH d'affûtage | Pour une course du samedi au format Hot Trail, le T-X de J-7 remplace la DH d'affûtage par du renfo haut du corps, un jour vélo seulement. La dernière DH exécutable date alors de J-13 (D1, D3) ou J-14 (D2) | À trancher : marquer « engagées » les séances V2 liées à la course (la famille est préservée, en DH LIGHT), ou aligner le placement du plan sur le T-X, ou accepter |
| **AR-5** | Doses de semaine de course | T-6 DH : LIGHT 60 à 4 passages (affûtage) contre MODERATE (T-X). T-5 endurance « courte » : 30 min dans le T-X, 45 min minimum en V2. Pas d'activation ni d'« opener » à J-1 ou J-2 | Préparateur ; aucune dose nouvelle sans validation |
| **AR-6** | Fenêtre V1 « 4 h » | Hot Trail, J-6 : DH MODERATE 240 min conseillée à un rider V2 sans séance V2 | Présentation : ne pas afficher la durée V1 sur le chemin V2 sans prescription, ou montrer le conseil sans durée. M1 reste inchangé |
| **AR-7** | Course ajoutée ou modifiée après la génération | Le plan ne se régénère pas. Au format « Autre » : séances MODERATE jusqu'à J-3. En Hot Trail : le T-X les adapte en séances exécutables | Régénération sur ajout ou modification de course (déclencheur `race_added` existant), ou message explicite ; bêta : reconstruction manuelle déjà annoncée au rider |
| **AR-8** | Mode RACE_WEEK des riders V2 | Toujours `UNSPECIFIED` : les contraintes « pas de DH intense » ne s'appliquent jamais | Dériver RACE_WEEK de la proximité d'une course dans l'adaptateur (sans toucher M1), ou y renoncer explicitement |
| **AR-9** | Jours d'après-course dans la semaine de course | Course du lundi : mardi à dimanche sans séance. T+2 « récupération ou endurance légère » appliqué en récupération seule (DOG-002) | À trancher avec AR-1 |
| **AR-10** | Alignement de l'affûtage par semaine | Selon le jour de course, la dernière DH d'affûtage tombe à J-7 (course du samedi) ou à J-2 (course du lundi) ; 2 DH à 8 passages deux semaines avant (question 12) | Préparateur |
| **AR-11** | Programme officiel | Aucune saisie : les phases fines (practice, qualifications, finale) ne sont jamais atteintes | Champ additif de programme officiel (SQL, P1), à décider après AR-1 |

---

## 5. Programmes réels avant / après, et proposition sportive

**Avant = après** : aucun code moteur ni web n'a changé, donc toutes les sorties ci-dessous sont celles de la production. La proposition (§ 5.3) est un contrat à décider, pas un programme livré.

### 5.1 Les quatre riders demandés (sorties réelles)

**D1 — avancé, cinq soirs physiques, DH le week-end, course de 2 jours** (`HOT_TRAIL_2DAY`, samedi et dimanche)
- **Affûtage** : Force LIGHT 45 (lundi 9), endurance LIGHT 45 (mardi 10). La DH du samedi 14 devient **Force haut LIGHT 45** (T-7).
- **Semaine de course** : aucune séance guidée.
  - Conseils : DH MOD « 4 h » (J-6), endurance 30 (J-5), récupération (J-4, J-3), repos (J-2, J-1).
- **Course**, puis récupération guidée à J+1 et J+2.
- **Bilan** : du lundi 9 au vendredi 20, 3 séances guidées (2 Force légères, 1 endurance légère). **Dernière DH : dimanche 8, à J-13.**

**D2 — intermédiaire, trois créneaux** (mardi et jeudi physique, samedi vélo), même course
- **Affûtage** : Force LIGHT 45 (mardi), endurance LIGHT 45 (jeudi). La DH du samedi 14, **son seul créneau vélo**, devient Force haut LIGHT 45.
- **Semaine de course** : rien de guidé. Lundi 23 sans séance, récupération conseillée ; mardi 24 récupération guidée.
- **Dernière DH** : samedi 7, deux semaines avant la course.

**D3 — fatigué à l'approche de la course**
- **Affûtage** :
  - fatigue systémique le lundi 9 : la Force LIGHT devient une **récupération active** (`V2_SYSTEMIC_FLOOR`), exécutable ;
  - jambes lourdes le samedi 14 (C3.6) : Force haut LIGHT 45, exécutable.
- **Semaine de course** :
  - J-4, douleur au genou 4/10 : `PAIN_NON_SAFETY` sur la récupération conseillée, non guidée ;
  - **J-2, fièvre : A3, repos Safety** (`not_required`) ;
  - de J-1 à fin+2 : **A7, repos maintenu** tant que le signal de santé reste ouvert, jours de course compris.
- **Lecture** : la priorité santé fonctionne. La reprise exige de lever le signal ; c'est le circuit P0-SAFE existant, rien à changer.

**D4 — reconnaissances connues**

| Variante | Ce que fait le moteur |
|---|---|
| **(a) `IXS_3DAY`**, practice officielle la veille | J-1 = `RACE_ACTIVITY`, sans séance guidée (voulu). Le reste comme au § 1.1 |
| **(b) Course saisie depuis son premier jour officiel**, jeudi à dimanche, format « Autre » | Jeudi à dimanche = `RACE_ACTIVITY`. Avant : récupération conseillée (pas de protocole) ; la DH d'affûtage du samedi 14 reste exécutable |
| **(c) DH manuelles** ajoutées dans `/plan` | **Dimanche 15** (J-6, jour vélo) : maintenue LIGHT 60 (T-6 plafonné) et **exécutable**. **Vendredi 20** (J-1, créneau physique seulement) : remplacée par le repos du T-X, sans séance guidée |

Conséquence : aujourd'hui, un rider qui connaît ses reconnaissances obtient une séance exécutable en semaine de course seulement de deux façons :
- en ajoutant une séance manuelle un jour vélo, hors jour de repos du protocole ;
- en saisissant la course depuis son premier jour officiel, ce qui donne une activité de course, sans séance guidée.

### 5.2 Scénarios complémentaires (sorties réelles)

- **Course ajoutée après la génération** (E1) :
  - **format « Autre »** : semaine `build_plus` gardée telle quelle, sans affûtage. Force MOD 60 à J-5 et J-4, endurance MOD 60 à J-3, conseil de récupération J-2 et J-1, course.
  - **Hot Trail** : le T-X adapte chaque séance prévue en séance **exécutable** : Force haut LIGHT 45 (J-7), DH MOD 90 maintenue (J-6), endurance LIGHT 45 (J-5), récupération (J-4), récupération de 20 à 40 min (J-3). Ensuite, repos conseillé et course.
- **Course proche** (E2, plan généré le mardi 17 pour une course le samedi 21) : semaine de course sans séance, puis introduction le 25. Récupération et repos conseillés seulement.
- **Séance terminée puis nouveau `daily-run`** (E6) : décision ajoutée ; une seule exécution, liée à sa prescription figée ; une prescription par décision ; une séance prévue par jour.
- **Semaines normales sans course** : inchangées, puisque le code n'a pas changé. Les plans sans course de SPORT-VALIDATION-01 restent valables.

### 5.3 Proposition de semaine de course (à valider, non implémentée)

Les séances ci-dessous sont **réellement construites par les builders actuels** quand une séance existe ce jour-là. Preuve : E1 Hot Trail, contenus dans `evidence/SPORT_RACE_01_REAL_DECISIONS.txt`.

L'option P les placerait dans le plan, chaque jour libre de T-7 à T-1, pour un format qui a un protocole :

| Jour (T-X) | Type du protocole | Séance V2 existante (contenu réel) | À valider |
|---|---|---|---|
| T-7 | Force haut léger | Force haut LIGHT 45 : développé haltères 3 × 8–10 à RPE 5–6, rowing un bras 2 × 10–12, dead bug 2 × 8–10 | placement sur un jour vélo seulement (AR-4) |
| T-6 | DH technique | DH LIGHT 60 à 4 passages (dose d'affûtage) | dose (AR-5) |
| T-5 | Endurance courte | endurance fondamentale LIGHT 45 : 10 min d'échauffement, 30 min à RPE 3–4, 5 min de retour au calme | 30 min dans le T-X contre 45 min en V2 (AR-5) |
| T-4, T-3 | Récupération | `recovery_active_v1`, 20 à 40 min à RPE 2–3, mobilité, respiration | — |
| T-2, T-1 | Repos, ou activité de course à J-1 en IXS | aucune séance | activation éventuelle (AR-5) |

**Application aux riders** (seulement sur un créneau compatible, une séance par jour) :
- **D1, course du samedi** : T-7 samedi vélo (Force non placée, DH d'affûtage conservée si AR-4 le décide) ; T-6 dimanche DH ; T-5 lundi endurance ; T-4 mardi et T-3 mercredi récupération ; jeudi et vendredi repos.
- **D2** : mardi T-4 récupération seulement, faute de créneau les autres jours ; le samedi 14 resterait sa dernière DH si AR-4 le décide.

**Formats sans protocole** : rien n'est placé tant qu'AR-2 et AR-3 ne sont pas tranchés. Aucun calendrier Swiss Cup ou UCI n'est supposé.

**Fatigue et santé** : inchangées. M1 adapte ou remplace la séance prévue (C3.3, `V2_SYSTEMIC_FLOOR`, douleur) ; Safety et P0-SAFE priment.

---

## 6. Tests et résultats

| Contrôle | Résultat |
|---|---|
| `sportRace01.integration.test.ts` (pile locale, chemins réels) | **7 / 7** exécutés et réussis |
| Typage `head-coach-engine` | 27 erreurs, **toutes préexistantes** : liste identique à celle du checkout de production ; 0 dans le nouveau fichier |
| Reproduction des six formats, de J-7 à fin+2 (runtime de production) | 6 riders et 68 décisions, conformes à SPORT-VALIDATION-01 |
| Scénarios D et E (10 riders) | 4 riders demandés, course ajoutée tard (2 formats), course proche, séance terminée puis nouveau `daily-run` ; aucun doublon : au plus 1 séance prévue par jour, au plus 1 prescription par décision, 1 exécution |
| Web de production à 375 px | Aujourd'hui et séance guidée pour 14 journées ; historique et détails techniques pour 3 |
| Suites étendues | **Non relancées** : aucun code exécutable modifié (un fichier de test ajouté, de la documentation) |

---

## 7. Effets

| Couche | Effet |
|---|---|
| V1 | aucun |
| V2 (génération, quotidien) | aucun |
| M1 | aucun (gelé, intact) |
| SQL | aucune migration |
| Edge | aucun bundle modifié ; `daily-run` v46 et `generate-training-plan` v29 restent la référence |
| Web | aucun |
| Données | locales seulement, riders fictifs |

---

## 8. Changements de canon proposés (non appliqués, sous condition d'AR-1 = option P)

**`docs/03` §6, politique de dose du plan V2**. Remplacer :

> `  - semaine de course : aucune séance normale.`

par :

> `  - semaine de course (SPORT-RACE-01) : pour une course au format doté d'un protocole T-X (HOT_TRAIL_2DAY, IXS_3DAY), le plan place, chaque jour de T-7 à T-1 qui n'a pas d'autre séance (semaine d'affûtage comprise), la séance du protocole lorsqu'elle a un modèle V2 : T-7 Force haut du corps légère 45 min ; T-6 DH légère 60 min, 4 passages ; T-5 endurance fondamentale légère 45 min ; T-4 et T-3 récupération active (recovery_active_v1). Seulement sur un créneau compatible (vélo pour la DH, physique pour la Force), une séance par jour au plus. Aucune séance un jour REST ou RACE_ACTIVITY du protocole, ni pendant ou après la course dans cette semaine. Format sans protocole : aucune séance (comportement conservateur), jusqu'à décision. Valeurs PROVISIONAL, à valider par un préparateur.`

Inchangé : « Un KEEP sans séance prévue […] n'a pas de prescription du jour : aucune séance n'est inventée. » Les séances viennent du plan, pas du quotidien.

**`docs/05`, progression V2** (ligne 253). Ajouter :

> `En semaine race (et les jours libres de T-7 à T-1 de la semaine taper), des séances d'avant-course du protocole T-X du format de la course s'ajoutent (SPORT-RACE-01) ; sessionCount d'une semaine race peut être positif. Les courses du snapshot V2 (input_snapshot.races) gagnent raceFormat (facultatif, JSON additif, aucune colonne ; absent = OTHER).`

**`docs/10`, nouveau T67**. Acceptation :
- semaine de course HOT_TRAIL et IXS : séances placées selon le protocole et la disponibilité, une par jour au plus, KEEP copiable le jour J ;
- formats sans protocole : aucune séance ;
- Safety, P0-SAFE et M1 prioritaires ;
- séance déjà réalisée intacte ;
- V1 inchangé ;
- contre-preuve : un plan sans course est identique à la production.

**`docs/04`** : aucun changement. Les tables T-X sont déjà canoniques ; leur validation sportive relève d'AR-2.

**Après accord, à prévoir** :
- code planning V2 : gabarit de semaine de course, format dans le snapshot ;
- `generate-training-plan` et `daily-run` redéployés (bundles) ; aucune migration ;
- effet seulement sur les nouveaux plans V2 (génération V2 OFF en production aujourd'hui).

---

## 9. Recommandation pour la bêta payante

1. **Ne pas inclure dans la bêta payante un rider qui a une course A ou B dans l'horizon de son programme**, tant qu'AR-1, AR-3 et AR-4 ne sont pas tranchés. Sinon, l'en informer explicitement : la semaine de course n'est pas coachée par des séances guidées, seulement l'affûtage de la semaine d'avant.
2. Les riders **sans course** dans l'horizon ne sont pas touchés par ce défaut. Les réserves SPORT-VALIDATION-01 et SPORT-SAFE-01 restent valables (B1, B3, B4, A2 à A5, doses PROVISIONAL).
3. **Priorité de décision** :
   - AR-1 (contrat) ;
   - AR-4 (dernière DH) ;
   - AR-3 (formats et données à demander) ;
   - AR-6 (« 4 h ») ;
   - puis le préparateur pour AR-2, AR-5 et AR-10.

## 10. Verdict : **BLOCKED**

Il n'y a aucune correction locale à livrer sans changer le contrat : la cause du défaut est dans le canon, pas dans le code. Le contrat actuel est fixé par des tests, et les décisions à prendre sont formulées avec leurs preuves.

Aucun push, déploiement, migration, secret ni flag. **STOP : revue HPM attendue.**
