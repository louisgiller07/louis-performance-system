# SPORT_RACE_01_INTEGRATION_REPORT — intégration locale et gate de publication

**Pour** : HPM et Louis · **Date** : 2026-10-19 · **Production** : `79b4d19` · **Verdict** : **READY TO DEPLOY** pour le web puis `daily-run`, après un GO HPM, l'autorisation de Louis et le contrôle de dérive P1. `generate-training-plan` est prêt mais reportable.

Aucun push, déploiement, migration ni changement de flag.

---

## 1. HEAD final

- **Branche d'intégration** : `integration/sport-race-01`, créée depuis `79b4d19` (`origin/main`, vérifié par `git ls-remote` et par la référence locale), puis `fix/sport-race-01` fusionnée en **avance rapide**. Historique linéaire : 11 commits au-dessus de `79b4d19`, plus le commit de ce rapport.
- **Arbre validé** (builds et tests ci-dessous) : `344d9c5`. Le commit de ce rapport n'ajoute que de la documentation (`docs/00`, `docs/11`, `docs/12`, ce fichier). Son SHA est le HEAD final, donné dans le message de livraison.
- `fix/sport-race-01` reste sur `344d9c5`.

## 2. Amendement canonique appliqué (`344d9c5`)

Texte exact du § 5.3 de `SPORT_RACE_01P4_INTEGRATION_GATE_REPORT`, extrait du rapport (3 lignes), rien d'autre :
- **`docs/05` §race_calendar, *Compatibilité des courses existantes*** : ajout de « Aujourd'hui (dès qu'elle est la prochaine course, à moins de 120 jours), la liste et le formulaire invitent le rider à préciser la compétition par le formulaire existant (Profil › Affiner ton profil › Tes courses) ; aucune migration ni correction automatique. »
- **`docs/10` T67, puce Aujourd'hui** : les anciennes courses « 2 / 3 jours » sortent du bandeau générique, et l'invitation à préciser la compétition est ajoutée.
- **`docs/10` T67, puce « Tes courses »** : les textes de la liste et du formulaire pour l'ancien « 2 jours » sont ajoutés.

**Cohérence vérifiée** entre canon, code et tests :

| Écran | Code | Canon |
|---|---|---|
| Aujourd'hui | `CLARIFY_COMPETITION_SENTENCE`, compte à rebours si `days < 120` | « dès qu'elle est la prochaine course à moins de 120 jours » |
| Liste | « Préparation spécifique non définie tant que la compétition n'est pas précisée » | même texte |
| Formulaire | « Compétition à préciser : choisis-la dans la liste… » | « Compétition à préciser » |

Les tests correspondants sont `sportRace01p.test.tsx` et `RacesSection.test.tsx`.

M1, les doses et le schéma SQL ne changent pas : aucun fichier de `head-coach-engine/src/{types,engine,rules,domains,mapping}`, de `supabase/` ou de `package*.json` n'est modifié entre `79b4d19` et HEAD.

## 3. Merge local

Avance rapide de `79b4d19` vers `344d9c5`, sans conflit : 68 fichiers, +5117 / −118. `ROLL_OUT_CHECKLIST.md` n'est pas versionné. Aucune modification locale ne reste, une fois annulées les réécritures CRLF des snapshots par Vitest.

## 4. Tests (branche d'intégration, pile locale isolée)

| Suite | Résultat |
|---|---|
| `npm run build:release:all` (moteurs, bundles Edge, web) | OK, rien déployé |
| head-coach-engine, unitaires | 1042 passés |
| planning-engine, unitaires | 1077 passés (catalogue V1 inchangé) |
| web, complet | 2389 passés, 61 ignorés |
| Intégrations ciblées : `sportRace01`, `buildRawContext`, `computeDailyFor` (+ matrice d'équivalence), `a04`, `p0UpwardModify`, `committedActivityFamily`, `a09RaceCalendarRls`, `raceCalendarRepo`, `generatedPlanFlow`, `t17`, `v2L2History`, `v2Persistence`, `v2RolloutFlag`, `planningModelRollout`, `v2HistoryFlag`, `physDailySwitches` | 160 passés au premier passage ; 2 délais dépassés à 5 s avec un worker Vitest arrêté, alors que la suite web tournait en parallèle. Relancés seuls : `sportRace01` 12/12, `generatedPlanFlow` 2/2. Total : **162 / 162** (1 ignoré) |

Les intégrations qui exigent l'Edge local (P0-3) n'ont pas été relancées : le graphe de `daily-run` est identique à celui testé en 01P.3 (5/5).

## 5. Composants à publier (graphes Edge confirmés contre le checkout `79b4d19`)

| Composant | Changement | Empreintes (production → HEAD) | Actif |
|---|---|---|---|
| **Web** (Vercel) | formulaire « Compétition », liste, Aujourd'hui (compétition, « non définie », « Compétition à préciser »), jours de conseil (01P, 01P.2) | `dpl_EthC4s2e…` → nouveau déploiement | V1 et V2 |
| **`daily-run`** | 3 fichiers de l'adapter : `raceCalendarRow.js`, `raceProtocolSelection.js` (nouveau), `raceCalendarRepo.js` | graphe `cc83c059…` → `01e3062c35842903209300df59f2e91c19e9b8a003443064ed700e9b467abba9` ; `dailyRunV2.bundle.js` **inchangé** `8202edc5…` | V1 et V2 : protocole seulement pour une Hot Trail Series ou un iXS explicites |
| **`generate-training-plan`** | `generateTrainingPlan.bundle.js` seul | graphe `de40112e…` → `3a0e6d90a179b85a924b8558b7ae74c424f0014661a60df8dbd2910594c0b93f` ; bundle `e7944713…` → `af3b655f4710cfa409460d0e076acb10090889b3bd70e0757ac42cbb8dbf1440` | aucun effet V1 (snapshot V1 identique 13/13) ; changements V2 inactifs (génération V2 OFF) |
| 8 autres fonctions | aucun | graphes identiques | — |
| SQL | aucun (colonne `series` existante, RLS existante) | — | — |

## 6. Plan de déploiement (gate court, rien d'exécuté)

| Étape | Action | Contrôles avant de passer à l'étape suivante | Arrêt si |
|---|---|---|---|
| **G0** | GO de publication HPM, puis confirmation de Louis | — | l'un des deux manque |
| **P1, dérive (lecture seule), juste avant** | `git ls-remote origin refs/heads/main` ; checkout de release propre `nalynt-rc-<HEAD final>`, `npm ci`, `npm run build:release:all` | `origin/main` = `79b4d19` ; SQL 76 migrations ; `daily-run` v46 (ezbr `7eb69719f773…`) ; `generate-training-plan` v29 (ezbr `2868800a…`) ; autres fonctions inchangées ; Vercel production `dpl_EthC4s2ekPAUfcnHyZ9jD3FL5py5`. Louis vérifie les noms de secrets seulement : `NALYNT_V2_PLAN_GENERATION_ENABLED` absent ou différent de `"true"`, flags PHYS et V2-L2 absents. Build local : graphes et bundles du § 5 | tout écart, ou toute empreinte locale différente |
| **P2, web** | Avance rapide de `main` de `79b4d19` vers HEAD final (jamais de force) → déploiement Vercel | déploiement READY sur le SHA ; nouveaux assets ; `/login` s'affiche ; aucune erreur de build ni dans les logs. Smoke éventuel uniquement sur un compte de test fictif de Louis et avec GO : « Compétition » sans valeur par défaut, ancienne course fictive « compétition à préciser » | échec Vercel, erreur |
| **P3, `daily-run`** (quelques minutes après P2) | `supabase functions deploy daily-run --project-ref uvolpldwwyvadlamulvr` depuis le checkout de release. Une seule fonction ; jamais `--prune`, `--no-verify-jwt` ni `--use-api` | v47 ; empreinte cohérente avec le graphe `01e3062c…` ; logs sans erreur (Louis) ; `generate-training-plan` toujours v29 | échec, erreur, version ou empreinte inattendue |
| **P4, `generate-training-plan`** (facultatif) | Recommandé : **reporter** au GO d'activation V2. Il n'apporte rien tant que la génération V2 est OFF, et le reporter réduit la fenêtre. Si l'HPM le veut : même commande, seule cette fonction | v30 ; flag V2 toujours OFF ; aucune génération déclenchée | idem |
| **P5, surveillance** | Requêtes agrégées en lecture seule exécutées par Louis, une à la fois : erreurs `daily-run`, volume de décisions, `daily_run_warning` | `daily_run_warning` limités aux 4 courses fictives entre J-14 et J+2 ; aucune erreur | anomalie → retour arrière sur décision HPM |

**Retour arrière (préparé, non exécuté)** :
- **Web** : instant rollback Vercel vers `dpl_EthC4s2ekPAUfcnHyZ9jD3FL5py5` (`79b4d19`), jamais de force push.
- **`daily-run`** : redéploiement depuis `D:/nx/nalynt-rc-79b4d19` (contenu de v46 : ezbr `7eb69719…`, graphe `cc83c059…`).
- **`generate-training-plan`**, s'il a été publié : redéploiement depuis le même checkout (bundle `e7944713…`).
- **SQL et données** : rien à restaurer. Les codes `series` écrits restent valides et l'ancien code les ignore. Les décisions écrites dans la fenêtre restent, en ajout seul.

**Effets transitoires** :
- **Web P2 avant `daily-run` P3** : pour une ancienne course ambiguë, Aujourd'hui dit « Compétition à préciser » alors que l'ancien `daily-run` applique encore le T-X. Seules les 4 courses fictives sont concernées.
- **Onglet resté sur l'ancien web après P3** : une course saisie avec l'ancien défaut « 2 jours » n'a plus de protocole, sans que l'ancien web l'annonce.
- **Toutes combinaisons** : aucune erreur, aucune perte de donnée.

## 7. Risques restants

- **`daily-run` touche aussi V1** : les anciennes lignes « 2 / 3 jours » sans compétition perdent le T-X. D'après l'inventaire, seules 4 courses futures sont concernées, toutes fictives (comptes de test de Louis) ; changement accepté par l'HPM.
- **Nouvelles séries** : le protocole n'existe que si le rider choisit explicitement Hot Trail Series ou iXS. Une course mal identifiée n'a pas de préparation spécifique, ce qui est le comportement prudent voulu.
- **Protocole provisoire** :
  - les textes nouveaux disent « protocole Hot Trail » ou « iXS » sans le présenter comme validé, et doses et placements restent PROVISIONAL (`race-protocol-plan-v1`, aucun effet en production tant que V2 est OFF) ;
  - le texte déjà en production du T-X de M1 (« … — protocole de préparation standard. ») reste inchangé et ne s'affiche plus que pour les courses explicitement identifiées. Le mot « standard » est à arbitrer par l'HPM s'il doit éviter toute lecture de validation (hors périmètre).
- **Plans existants** : une compétition précisée après génération ne replace pas de séances sans régénération (AR-B bloqué, V2 OFF). Au quotidien, le T-X s'applique dès le run suivant.
- **Tests d'intégration** : ils sont sensibles à la charge (délai de 5 s). Lancer les suites lourdes séparément.
- **Validation sportive** du protocole et de son application à toutes les manches Hot Trail et iXS : à faire.

## 8. Verdict

**READY TO DEPLOY** : le web, puis `daily-run` dans la même fenêtre ; `generate-training-plan` est reportable. Conditions :
1. nouveau GO HPM et autorisation explicite de Louis ;
2. contrôle de dérive P1 conforme, juste avant ;
3. publication depuis un checkout de release propre de HEAD final.

STOP.
