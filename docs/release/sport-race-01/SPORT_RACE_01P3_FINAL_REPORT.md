# SPORT_RACE_01P3_FINAL_REPORT — contrat des formats et séries de compétition

**Pour** : HPM et Louis · **Date** : 2026-10-19 · **Branche** : `fix/sport-race-01` (depuis `79b4d19`, production) · **Verdict** : **MERGE READY** sous réserve de l'approbation des diffs canoniques (§ 5) ; activation sportive non prête.

Aucun push, merge, déploiement, migration, SQL de production ni activation. Tout a tourné sur la stack locale isolée `nalynt-gate01`, avec des riders fictifs.

---

## 1. Contrat final des formats et séries

Trois informations distinctes sur une course (`race_calendar`), sans migration :

| Information | Colonne | Règle |
|---|---|---|
| Compétition (circuit, organisateur) | `series` (existante, inutilisée jusqu'ici) | code d'une liste fermée, jamais un libellé ; **aucune valeur par défaut**, le rider choisit |
| Format d'événement | `race_format` | dérivé de la compétition ; désigne un format pour lequel un protocole T-X existe, jamais une durée |
| Durée | `start_date` … `end_date` | fixée seulement pour les deux formats à protocole (2 et 3 jours), libre sinon ; aucun jour officiel déduit ni stocké |

| Code `series` | Option du formulaire | `race_format` écrit | Protocole |
|---|---|---|---|
| `HOT_TRAIL_SERIES` | Hot Trail Series (Swiss DH Cup) — 2 jours : entraînements et chrono, puis finale | `HOT_TRAIL_2DAY` | Hot Trail |
| `IXS` | iXS (European Cup, DHC) — 3 jours, practice officielle la veille | `IXS_3DAY` | iXS |
| `SWISS_OTHER` | Autre course en Suisse | `OTHER` | aucun |
| `UCI_WORLD_CUP` / `UCI_WORLD_CHAMPS` | Coupe / Championnats du monde UCI | `OTHER` | aucun |
| `FR_COUPE_DE_FRANCE_DH` | Coupe de France DH / DHI | `OTHER` | aucun |
| `FR_CHAMPIONNAT_DE_FRANCE_DH` | Championnats de France DH / DHI | `OTHER` | aucun |
| `FR_REGIONAL_DH` | Coupe ou championnat régional DH (France) | `OTHER` | aucun |
| `FR_OTHER_DH` | Autre course DH en France | `OTHER` | aucun |
| `OTHER` | Autre compétition | `OTHER` | aucun |

**Sélection du protocole** : une seule règle, dans l'adapter (`head-coach-engine/src/supabase/mapping/raceProtocolSelection.ts`, `selectRaceProtocolFormat`). Elle sert à la fois au contexte quotidien de M1 (`mapRaceCalendarRow`) et au snapshot de génération V2 (`raceFormat`) :
- protocole **seulement** pour (`HOT_TRAIL_2DAY`, `HOT_TRAIL_SERIES`) et (`IXS_3DAY`, `IXS`) ;
- `HOT_TRAIL_2DAY` ou `IXS_3DAY` sans la série correspondante (NULL, texte libre, variante de libellé, autre code) : ambigu ; M1 et le planificateur reçoivent `OTHER`, avec un avertissement d'adapter ;
- `SWISS_CUP`, `UCI_WC`, `UCI_WORLDS`, `OTHER` : inchangés ; NULL : `OTHER` avec l'avertissement existant ;
- une série seule ne crée jamais de protocole.

Le web applique la même règle (`web/src/features/races/raceProtocol.ts`, `raceProtocolOf`) ; un test miroir l'aligne sur l'adapter. Aucun protocole générique, aucune dose modifiée.

## 2. Compétitions françaises

| Point vérifié | Résultat |
|---|---|
| Saisie | Options « Coupe de France DH / DHI », « Championnats de France DH / DHI », « Coupe ou championnat régional DH (France) », « Autre course DH en France ». Dates libres. Aide sous le champ : « Préparation spécifique non définie pour cette compétition : NALYNT ne planifie pas de séance les jours qui la précèdent. » |
| Enregistrement | `series` = le code (`FR_…`), `race_format` = `OTHER`. Ligne acceptée sans avertissement par l'adapter (test de contrat). |
| Schéma | Compétition (`series`), format (`race_format`) et durée (dates) sont distincts. L'organisateur réel n'est pas modélisé à part : le code de compétition le couvre. Aucun programme officiel n'est stocké. |
| V2 et M1 | `OTHER` : aucune séance d'avant-course dans le plan, aucun T-X au quotidien (INFERENCE_FALLBACK), course visible par M1. |
| Coupe de France sur 2 jours | **Aucun protocole Hot Trail**, qu'elle soit saisie avec le nouveau formulaire (`OTHER`) ou stockée en `HOT_TRAIL_2DAY` (ancien défaut, ou couple incohérent). |
| Championnats de France sur 3 jours | **Aucun protocole iXS**, en `OTHER` comme en `IXS_3DAY`. |
| Variantes de libellés | « Hot Trail Series (Swiss DH Cup) » en texte libre, `ixs`, `hot_trail_series`, « iXS European Cup », espace en tête : aucun protocole, avertissement. |
| Manches d'une même série | Aucune hypothèse de programme commun : rien n'est déduit pour une manche. |
| Sans protocole | Course enregistrable et visible ; formulaire, liste (« Préparation spécifique non définie ») et Aujourd'hui (7 jours avant) le disent. |

## 3. Compatibilité des anciens événements

**Le schéma distingue les anciennes et les nouvelles lignes sans changement** : une ligne écrite avant ce contrat a `series` NULL (ou un texte libre saisi à la main) ; une ligne du nouveau formulaire a toujours un code. Pas de STOP sur ce sous-périmètre, aucune migration.

**M1 n'est pas modifié** : il reçoit déjà un `RaceFormat` ; l'adapter lui transmet le format sélectionné. Aucune ADR M1 n'est nécessaire.

Résultats réels, moteur compilé, même rider et même plan (`evidence/SPORT_RACE_01P3_FORMATS_BEFORE_AFTER.txt`). « Avant » = runtime de production `79b4d19` ; « après » = cette branche. Jours J-7 à J-1 :

| Cas (ligne `race_calendar`) | Avant : plan / quotidien | Après : plan / quotidien |
|---|---|---|
| Ancien « 2 jours », défaut (`HOT_TRAIL_2DAY`, NULL) | rien / T-X Hot Trail 7 jours (J-7 : DH prévue remplacée par Force haut) | rien / aucun T-X, avertissement ; J-7 garde la DH prévue |
| Ancien « 3 jours » (`IXS_3DAY`, NULL) | rien / T-X iXS 7 jours | rien / aucun T-X, avertissement |
| Hot Trail explicite (`HOT_TRAIL_2DAY`, `HOT_TRAIL_SERIES`) | rien / T-X 7 jours | DH J-6 LIGHT 60, récupération J-4 et J-3 / T-X 7 jours, 3 jours exécutables |
| iXS explicite (`IXS_3DAY`, `IXS`) | rien / T-X 7 jours | Force haut J-7, DH J-6, récupération J-4 et J-3 / T-X 7 jours, 4 jours exécutables |
| Swiss Cup 2 jours (`OTHER`, `SWISS_OTHER` ; et `SWISS_CUP` legacy en test) | rien / rien | identique |
| UCI 3 jours (`OTHER`, `UCI_WORLD_CUP` ; et `UCI_WC` legacy en test) | rien / rien | identique |
| Coupe de France DH 2 jours (`OTHER`, `FR_COUPE…`) | rien / rien | identique |
| Coupe de France DH stockée `HOT_TRAIL_2DAY` | rien / T-X Hot Trail 7 jours | rien / aucun T-X, avertissement |
| Championnats de France DH 3 jours (`OTHER`, `FR_CHAMPIONNAT…`) | rien / rien | identique |
| Championnats de France stockés `IXS_3DAY` | rien / T-X iXS 7 jours | rien / aucun T-X, avertissement |
| Régionale d'un jour (et de trois jours en test) | rien / rien | identique |
| Série en texte libre « Hot Trail Series (Swiss DH Cup) » | rien / T-X 7 jours | rien / aucun T-X, avertissement |
| Compétition inconnue (`OTHER`, `OTHER`) | rien / rien | identique |

**Changement de comportement en production (à décider en connaissance de cause)** :
- toute course existante en `HOT_TRAIL_2DAY` / `IXS_3DAY` sans code de série perd le T-X au quotidien dès le déploiement de `daily-run`, **riders V1 compris**, et n'en a pas dans un plan généré ensuite ;
- le rider le récupère en choisissant explicitement « Hot Trail Series » ou « iXS » dans « Tes courses » ;
- c'est voulu (conservateur : ces lignes ont pu être saisies avec le défaut « 2 jours ») ;
- `docs/02` §11 cite des séries écrites en texte libre pour les courses 2026 de Louis (« Hot Trail Series (Swiss DH Cup) », « iXS European Cup ») ; si de telles lignes existent, elles n'ont pas de protocole avant précision.

Pour mesurer l'ampleur sans données personnelles, une requête agrégée en lecture seule est prête pour Louis : `SPORT_RACE_01P3_LEGACY_RACES_COUNT.sql` (une instruction ; comptes par format, état de la série, à venir ou non, statut). Non exécutée.

**Historique** : rien n'est migré ni réécrit. Les décisions, prescriptions figées, exécutions et versions de plan existantes sont inchangées ; un snapshot v2 persisté garde son `raceFormat`. Les anciennes décisions T-X restent lisibles dans l'historique avec leurs libellés d'origine. Une course existante enregistrée sans changement garde son couple stocké, jamais converti.

## 4. Corrections et commits

| Commit | Contenu |
|---|---|
| `0672050` | SPORT-RACE-01 : diagnostic et preuves |
| `d7dce8d`, `ad5d759` | 01P : option P (planificateur), docs |
| `87da636`, `a8b9158` | 01P.2 : AR-A, AR-C, AR-D, docs |
| **`ab117c5`** | **01P.3 : sélection du protocole (adapter, M1 et V2), formulaire « Compétition », bandeau Aujourd'hui, tests** |
| commit docs suivant | 01P.3 : ce rapport, diffs canoniques rév. 01P.3, requête agrégée, preuves, `docs/00`, `docs/11` (addendum 01P.3), `docs/12` |

Changements de 01P.3 :
- **adapter** :
  - `raceProtocolSelection.ts`, nouveau ;
  - `mapRaceCalendarRow`, qui applique la sélection ;
  - `raceCalendarRepo`, qui lit `series` ;
  - `buildPlanInputSnapshotV2`, où `raceFormat` = format sélectionné ;
- **web** :
  - `raceProtocol.ts`, nouveau ;
  - formulaire « Compétition » sans défaut ;
  - validation : compétition de la liste ou couple stocké conservé ;
  - `series` écrite et relue ;
  - liste avec préparation ;
  - bandeau Aujourd'hui (compétition, phrase « préparation non définie »).

Libellé d'erreur de durée : « Cette compétition dure N jours : ajuste les dates. »

AR-A, AR-B, AR-C et AR-D sont inchangés. Aucune dose modifiée.

## 5. Diffs canoniques exacts

Texte normatif final : `SPORT_RACE_01P_CANON_DIFFS.md`, révision 01P.3, proposé et **non appliqué** :
- **`docs/03` §6** : jours d'avant-course pour une course explicitement identifiée (Hot Trail Series, iXS). La liste de toutes les autres courses (suisses, UCI, françaises, régionales, anciens « 2 / 3 jours ») ne reçoit aucune séance d'avant-course et voit « préparation non définie ». Aucun protocole déduit d'une durée, d'un nom ou d'un texte libre. Phrase normative : `daily-run` n'invente jamais de séance d'avant-course.
- **`docs/05`** :
  - § 2.1 snapshot v2 : `raceFormat` = format sélectionné ;
  - § 2.3 : une compétition précisée après la génération exige une régénération explicite ;
  - **§ 2.4 nouveau `race_calendar`** : compétition, format, durée ; liste des codes ; règle de sélection ; compatibilité des anciennes lignes ; « sans protocole » ; cinq invariants.
- **`docs/10` T67** :
  - unitaires de sélection ;
  - matrice d'intégration (anciens événements, Swiss, UCI, Coupe et Championnats de France, régionales, inconnue, sans format) ;
  - fixtures à série explicite ;
  - tests web du formulaire, du miroir et d'Aujourd'hui.

`docs/04`, `docs/07` et les doses sont inchangés.

## 6. Tests

| Suite | Résultat |
|---|---|
| head-coach-engine, unitaires | 90 fichiers, **1042 passés** (dont `raceProtocolSelection.test.ts`, nouveau ; `raceCalendarRow.test.ts`, mis à jour) |
| `sportRace01.integration.test.ts` (chemins réels V2 et quotidien) | **12 / 12**, dont la matrice 01P.3 de 16 cas (snapshot, semaine de course, décision M1, avertissements) |
| Intégrations touchées : `buildRawContext`, `computeDailyFor` (+ matrice d'équivalence), `a04`, `p0UpwardModify`, `committedActivityFamily`, `a09RaceCalendarRls`, `raceCalendarRepo`, `generatedPlanFlow`, `t17`, `v2L2History`, `v2Persistence` | **132 passés**, 6 ignorés (fichier P0-3 ignoré sans Edge, puis lancé ci-dessous) |
| `p0_3HealthSuspendedExecution` avec Edge local | **5 / 5** |
| Génération V2 OFF et rollout : `v2RolloutFlag`, `planningModelRollout`, `v2HistoryFlag`, `physDailySwitches`, `generatedPlanFlow` | **41 / 41** |
| planning-engine, unitaires | **1077 passés**, 4 ignorés (V1 et catalogue inchangés) |
| web, complet | 173 fichiers, **2388 passés**, 61 ignorés |
| web : lint (oxlint), `tsc -b tsconfig.build.json` ; head-coach `build:release` | OK |
| web `tsc -b tsconfig.app.json` | 33 erreurs, **identiques en production `79b4d19`** (fichiers de test non touchés) |

**Preuves avant / après**, sorties réelles :
- `evidence/SPORT_RACE_01P3_FORMATS_BEFORE_AFTER.txt` : 13 cas × 2 runtimes ;
- `evidence/SPORT_RACE_01P3_VISIBLE_TEXTS_375.txt` : Playwright 375 px, sans débordement horizontal. Avant : une « Coupe de France DH » enregistrée avec le défaut s'affiche « Hot Trail, 2 jours » sans avertissement, et le formulaire présélectionne « Course sur 2 jours ». Après : « Course sur 2 jours — compétition à préciser » avec « Préparation spécifique non définie », et le formulaire affiche « Choisis la compétition ».

Captures PNG dans le scratchpad local, non versionnées.

## 7. Impacts SQL, M1, Edge, web

- **SQL** : aucune migration, aucune écriture. Une requête agrégée en lecture seule est proposée, non exécutée.
- **M1** : code gelé intact. Seule l'entrée change : l'adapter transmet `OTHER` pour un format à protocole ambigu.
- **Edge `daily-run`** : **change** par rapport à 01P.2, car l'adapter fait partie de son bundle. Effets :
  - perte du T-X pour les anciennes lignes ambiguës ;
  - un avertissement par run, enregistré comme événement pilote `daily_run_warning` (texte avec le nom de la course, comme l'avertissement NULL existant). Les requêtes de surveillance qui comptent `daily_run_warning` verront cette hausse.
- **Edge `generate-training-plan`** : snapshot `raceFormat` sélectionné. La génération V2 reste OFF.
- **Web** : formulaire « Compétition », lecture et écriture de `series`, liste et Aujourd'hui.
- **Ordre de déploiement conseillé** (le jour d'un GO, non demandé ici) : web, puis `daily-run`, puis `generate-training-plan`. Tout ordre reste sûr, mais le web d'abord laisse les riders préciser leur compétition avant que `daily-run` retire le protocole des lignes ambiguës.

## 8. Éléments sportifs encore provisoires

- Doses et placements `race-protocol-plan-v1` (Force J-7, DH J-6 LIGHT 60 / 4 passages, récupération J-4 et J-3 à 20 min, rien à J-5) : PROVISIONAL.
- Application du protocole Hot Trail à **toutes** les manches de la Hot Trail Series, et du protocole iXS à toutes les manches iXS (European Cup, DHC) : à valider manche par manche. Rien n'est supposé pour une manche au programme différent.
- Assimilation « Swiss DH Cup » = Hot Trail Series (`docs/02`) : reprise dans le libellé. Une « Autre course en Suisse » n'a pas de protocole.
- Aucun protocole pour l'UCI, les compétitions françaises et régionales : la préparation spécifique reste non définie tant qu'aucun protocole n'est validé.
- Communication aux riders ayant une ancienne course « 2 / 3 jours » : à décider (§ 3).
- AR-B (« Mettre à jour mon programme ») : toujours bloqué, il faut un contrat de capacité serveur en lecture seule.

## 9. Verdict

**MERGE READY**, sous réserve de l'approbation et de l'application des diffs canoniques `docs/03`, `docs/05` et `docs/10` (révision 01P.3). Code, tests et preuves sont prêts sur `fix/sport-race-01` :
- M1 inchangé ;
- aucune migration ;
- doses inchangées ;
- AR-A à AR-D conservés.

Le déploiement est hors de ce verdict. Il demande un GO HPM distinct, parce que `daily-run` change le comportement des anciennes courses ambiguës (§ 3, § 7).

Aucun merge automatique. STOP pour revue HPM.
