# V2_PHYS_RELEASE_GATE_01_REPORT — release intégrée, nouveaux secrets absents

**Date** : 2026-10-18 · **Pour** : HPM et Louis · **Statut** : préparation locale.

Rien n'a été fait en production :
- aucun push, aucun déploiement, aucune migration distante ;
- aucun secret lu ni modifié ;
- `origin/main` vérifié en lecture seule : toujours `863f3fb`.

**Verdict : READY FOR GATE** pour une release dont tous les nouveaux secrets sont absents. L'activation de chacun reste BLOCKED (§ 11).

## 1. Candidat intégré

| | |
|---|---|
| Branche | `int/v2-phys-integration-01`, descendante de `863f3fb` (fast-forward possible) |
| **Candidat** | **`27e0a67`** : code et canon de la release |
| Commit du rapport | ce rapport et la requête SQL de la gate, au-dessus de `27e0a67` (documentation seule ; SHA donné à la livraison). C'est lui que `main` recevra |
| Écart de code avec `f801263` (V2-L2-01a, suites complètes) | **aucun** ; seuls des documents ont changé depuis |
| M1 (`src/{types,engine,rules,domains,mapping}`) | **identique à `863f3fb`** (diff vide) |

Historique depuis `863f3fb` (première parenté) :

| Commit | Contenu |
|---|---|
| `dab1f4d` | fusion des sept commits PHYS (`5ec0976` … `91bb721`) |
| `36b0b3f` | isolation de PHYS derrière les interrupteurs serveur |
| `b5230d5` | POWER-GUARD-01, migration `20261018120000` et script de retour arrière |
| `05fe664`, `d91dbaf` | contrat V2-L2-01, puis canon `docs/05` de V2-L2-01a |
| `f801263` | V2-L2-01a (adaptateur de génération, flag OFF) |
| `0baa065` | fusion de la branche documentaire `7c180a8` (V2-PHYS-READINESS-01, PARTIAL-01 CLOSED) |
| `27e0a67` | canon approuvé (`docs/04`, `docs/05`, T65), ADR, backlog, statut, requêtes de readiness |

**Conflits résolus** :
- `docs/12` (fusion `7c180a8`) : PARTIAL-01 prend son entrée CLOSED de production, et les entrées du candidat sont conservées après elle. Aucune ADR écrasée.
- Fusion PHYS (`dab1f4d`, mission précédente) : un conflit en fin de `docs/11`. Toutes les ADR ont été gardées, dans l'ordre chronologique.

## 2. Contenu exact de la release

| Couche | Change | Ne change pas |
|---|---|---|
| SQL | `20261018120000` : une condition de `record_session_execution` (F-6C étendue à `power`). Aucune table, aucune donnée, mêmes droits | les 75 migrations de production |
| Edge | `daily-run` (graphe 81 → 92 fichiers) et `generate-training-plan` (bundle) | `session-execution`, `completed-session`, `accept-training-plan`, `abandon-training-plan`, `health-flag-resolution`, `get-insights`, `refresh-longitudinal`, `submit-review` : empreintes de production |
| Web | modules PHYS : décodage des familles `power` / `mobility`, guidages, module mobilité, résumé puissance. Ils ne sont utilisés que si une prescription PHYS existe | aucune variable d'environnement ; PARTIAL-01, CONSISTENCY-01 et -02 inchangés |
| Secrets | **aucun** | `NALYNT_V2_PLAN_GENERATION_ENABLED` et `NALYNT_WRITES_SUSPENDED` gardent leur valeur |
| Canon | `docs/05` (garde POWER, interrupteurs), `docs/04` (interrupteurs du chemin quotidien), `docs/10` T65, ADR `docs/11`, `docs/12`, `docs/00` | `docs/03`, `docs/07`, règles sportives PHYS (propositions non appliquées) |

**Numérotation T65.** Les propositions PHYS numérotaient T64 à T67, et deux rapports proposaient chacun un T65. Or T64 est déjà PARTIAL-01. T65 regroupe donc la release ; les scénarios PHYS seront numérotés à leur approbation.

## 3. État attendu après la release

**SQL** : 76 migrations, la dernière étant `20261018120000`. `record_session_execution` :
- une seule fonction, `SECURITY DEFINER`, `search_path=public`, propriétaire `postgres` ;
- `EXECUTE` à `postgres` et `service_role` seulement ;
- empreinte du corps (sans retours chariot) :
  - avant : `dd3c0a6826854f85452478eb131a6e46` (= `20261013160000`) ;
  - après : `c271b8836a05a6b896469b081ee3105c`.
- Ces valeurs ont été mesurées sur la pile locale ; l'état 75 est obtenu dans une transaction annulée.

**Edge**, graphes (sha256, fins de ligne normalisées) :

| Fonction | Production `863f3fb` | Release |
|---|---|---|
| `daily-run` | 81 fichiers, `e00f0011…` | 92 fichiers, **`1b31e2be…`** |
| `generate-training-plan` | 4 fichiers, `dbccafa4…` | 4 fichiers, **`de40112e…`** |
| les 8 autres | `932d95a2`, `c1a807ca`, `b1b067cf`, `8259c1b0`, `147d5da9`, `5bd6746a`, `aebd17b1`, `8519406f` | identiques |

**Secrets** : inchangés. Les six nouveaux noms sont absents, ou leur empreinte diffère de sha256(`true`) = `b5bea41b…e12b`.

**Données** : aucune donnée PHYS. Toutes les valeurs PHYS de la requête d'état restent à 0.

## 4. Tests et preuves

**Réutilisés** (le code n'a pas changé depuis ces passages) :

| Preuve | Résultat | Sur |
|---|---|---|
| head-coach complet, pile à 76 migrations, Edge servies avec les flags de production | **1648/1648** (170 fichiers ; 4 tests de 3 fichiers sans lien rejoués 19/19 après surcharge locale) | `f801263` |
| — dont différentiel OFF contre le runtime réel de `863f3fb` (V2-L2) et compatibilité de retour arrière `phys011` à `phys04` | vert | `f801263` |
| — dont P0-SAFE (`p0SafeHealthContinuity`, `p0SafeHealthEdge`), CONSISTENCY-01 (`consistency01TodayProgramme`), POWER-GUARD-01 (`powerGuard01`, mode `installed`) | vert | `f801263` |
| planning-engine, unitaires et différentiel OFF contre `863f3fb` : 73 profils de plan, 47 970 cas quotidiens, 11 088 cas manuels identiques ; contre-épreuve ON : différences | **1038/1038** | `36b0b3f` (aucun changement depuis) |
| web, unitaires et intégrations (CONSISTENCY-02, PARTIAL-01 compris) | **2371/2371**, à 75 puis à 76 migrations | `36b0b3f` / `b5230d5` (aucun changement web depuis) |
| POWER-GUARD-01 avant / après, exercice de retour arrière | 8/8 à 75 (défaut reproduit), 11/11 à 76, retour arrière vérifié | `b5230d5` |
| V2-L2-01a | unitaires 47/47 ; intégration 13/13 ; Edge OFF 1/1 et ON 1/1 | `f801263` |
| TypeScript | head-coach : mêmes 27 erreurs préexistantes qu'en production (liste comparée) ; planning : 0 ; build web OK | `f801263` / `36b0b3f` |

**Nouvelles dans cette mission** (aucune suite à relancer : seuls des documents ont changé) :
- **Graphes Edge** : production calculée sur le checkout compilé de `863f3fb`, comparée à la release. Seuls `daily-run` et `generate-training-plan` diffèrent.
- **Diffs** : M1 identique à la production ; aucun fichier hors `docs/` modifié depuis `f801263`.
- **Empreintes SQL** 75 et 76 de `record_session_execution`, avec ses droits.
- **Requête d'état** de la gate, exécutée sur la pile locale : syntaxe et colonnes valides.
- **Docs lus par des tests** : les seuls fichiers de `docs/` lus par des tests (`docs/release/phys0*-rollback`) sont inchangés.

## 5. Sécurité des interrupteurs

**Liste exhaustive des secrets PHYS et V2-L2.** Tous sont lus côté serveur, avec `parseV2PlanGenerationFlag` : seule la valeur exacte `"true"` active.

| Secret | Lu par | Effet si `"true"` |
|---|---|---|
| `NALYNT_V2_PHYS_DAILY_ENABLED` | `daily-run` | ajouts quotidiens PHYS-01.1 (Force) et PHYS-02 (guidage d'endurance) |
| `NALYNT_V2_PHYS_PERFORMANCE_GUIDANCE_ENABLED` | `daily-run`, actif seulement avec le précédent | conseils de charge et de répétitions (**interdit**, `docs/03` §10) |
| `NALYNT_V2_ENDURANCE_INTERVALS_ENABLED` | `generate-training-plan` et `daily-run` | fractionné dans les nouveaux plans ; séance manuelle et REPLACE |
| `NALYNT_V2_POWER_ENABLED` | `generate-training-plan` et `daily-run` | puissance ; **jamais avant la migration 76** |
| `NALYNT_V2_MOBILITY_ENABLED` | `generate-training-plan` et `daily-run` | mobilité |
| `NALYNT_V2_L2_HISTORY_ENABLED` | `generate-training-plan` | historique V2 de la génération |

Le web ne lit aucun interrupteur. Aucun autre nom `NALYNT_*` n'a été ajouté : inventaire du code des Edge, de head-coach et de planning-engine.

**Valeurs absentes ou différentes de `"true"` = OFF.** C'est prouvé par :
- les tests du lecteur de secrets (`physDailySwitches`, 12/12) ;
- le test de l'analyse du flag V2-L2 : `""`, `"TRUE"`, `"1"`, `"yes"`, `" true"` donnent tous OFF.

**Chemins couverts**, tous OFF = production :
- **Séances manuelles** : 11 088 cas identiques au différentiel ; `physSwitches` C, manuel OFF → ON → OFF ; POWER-GUARD cas 8, puissance manuelle OFF sans document.
- **REPLACE** : 16 cibles identiques au différentiel.
- **Prescriptions historiques** :
  - une séance PHYS déjà dans un programme accepté reste servie, flag OFF (`physSwitches` D ; POWER-GUARD cas 9) ;
  - les prescriptions persistées ne sont jamais réécrites ;
  - le web de production lit les documents PHYS en mode tolérant (`docs/release/phys0*-compat`).

**Aucune activation au seul déploiement** :
- `functions deploy` ne crée ni ne modifie de secret ;
- les secrets restent ceux de la production ;
- l'étape 5 le vérifie par les noms et les empreintes, contrôlés par Louis, sans afficher de valeur.

## 6. Compatibilité des états intermédiaires

| État | Compatible | Preuve |
|---|---|---|
| SQL 76 + Edge et web de production | oui : la garde ne touche que la famille `power`, que la production ne produit jamais | POWER-GUARD cas 7 : Force, DH et mobilité identiques ; `session-execution` inchangée ; requête d'état `power_executions = 0` |
| SQL 75 + nouvelles Edge OFF (inversion d'ordre) | oui, sans risque POWER puisque le flag est absent ; mais ce n'est pas l'ordre prévu | suites head-coach à 75 migrations sur `36b0b3f` (1576/1576) ; V2-L2 ne dépend d'aucun objet SQL nouveau |
| nouveau `daily-run` + ancien `generate-training-plan` (entre 3a et 3b), ou l'inverse | oui : plans et documents identiques à la production avec les flags OFF | différentiels planning et head-coach |
| nouvelles Edge + ancien web | oui : documents identiques à ceux de la production | différentiel : 27 474 documents identiques |
| anciennes Edge + nouveau web | oui : le nouveau web lit les documents de production | suite web (manifestes v2.6 et v2.5) ; chemins PHYS inertes sans prescription PHYS |
| retour arrière des Edge vers `863f3fb` avec SQL 76 conservé | oui | `phys011` à `phys04` PreviousRuntimeCompat sur la pile à 76 |

## 7. Procédure de gate

**Règles**
- Avant chaque étape : un **GO HPM distinct**, puis la confirmation de Louis.
- **STOP** dès qu'une vérification n'est pas conforme ; jamais de nouvel essai à l'aveugle.
- Jamais `--include-all`, `migration repair`, `db reset`, `--prune`, `--no-verify-jwt`, `--use-api` ; jamais de force push.
- Louis exécute le SQL de production, une instruction par requête.
- Aucune valeur de secret n'est affichée.
- Aucune écriture métier, aucun smoke écrivant des données.

| GO | # | Action | Vérification | Si non conforme |
|---|---|---|---|---|
| **1 Précontrôles** | P1 | Checkout propre de la release (`C:\Users\Louis\nalynt-rc-<sha>`), lié à `uvolpldwwyvadlamulvr` ; `npm ci` (racine et 5 paquets) ; `npm run build:release:all`, puis `-- --verify-only` | sortie 0 ; graphes du § 3 : `daily-run` `1b31e2be…`, `generate-training-plan` `de40112e…`, les 8 autres = production | STOP |
| | P2 | `npx supabase migration list --linked` | 75 appliquées, dernière `20261016120000` ; seule `20261018120000` en attente ; aucune migration distante inconnue | STOP |
| | P3 | `npx supabase functions list --project-ref uvolpldwwyvadlamulvr` | noter version et `ezbr_sha256` de `daily-run` et `generate-training-plan` (références de retour arrière) ; `verify_jwt = true` partout | STOP |
| | P4 | SQL (Louis), quatre requêtes séparées : `V2_PHYS_RELEASE_GATE_01_STATE_READONLY.sql` ; `V2_PHYS_READINESS_01_INVENTORY_READONLY.sql` ; `V2_PHYS_READINESS_02_SIM_ACCOUNT_READONLY.sql` ; `phys04-rollback/ROLLBACK_TO_D_PRECONDITION.sql` | état : 75, `power_guard_applied = 0`, corps `dd3c0a68…`, droits du § 3, **tous les compteurs PHYS à 0** dont `power_executions = 0` ; inventaire relevé ; READINESS-02 : verdict `all_v2_signals_on_simulation_account` relevé ; précondition : 0 / 0 / 0 | STOP et rapport au HPM |
| | P5 | Retour arrière prêt : `C:\Users\Louis\nalynt-rc-863f3fb` | graphes `e00f0011…` et `dbccafa4…` (vérifiés le 2026-10-18) | STOP |
| | P6 | `npx supabase secrets list --project-ref uvolpldwwyvadlamulvr`, lu par Louis seul : noms et empreintes, jamais les valeurs | aucun des six nouveaux noms, ou empreinte ≠ `b5bea41b…e12b` | STOP |
| **2 Migration** | 2a | `npx supabase db push --linked --dry-run` | **exactement** `20261018120000` | STOP |
| | 2b | `npx supabase db push --linked` ; `migration list` ; requête d'état (Louis) | 76/76 ; `power_guard_applied = 1` ; corps `c271b883…` ; mêmes droits ; compteurs PHYS à 0 | STOP ; voir § 9 |
| **3 Edge** | 3a | `npx supabase functions deploy daily-run --project-ref uvolpldwwyvadlamulvr` (**jamais avant 2b**) | version +1, ACTIVE, `verify_jwt = true`, aucune autre fonction changée ; POST sans JWT → 401 ; journaux de démarrage sans erreur (Louis) | redéployer `daily-run` depuis P5 |
| | 3b | `npx supabase functions deploy generate-training-plan --project-ref uvolpldwwyvadlamulvr` | idem | redéployer `generate-training-plan` depuis P5 |
| **4 Web** | 4 | `git log --oneline origin/main..<sha>` = exactement les 17 commits de `863f3fb..<sha>` (§ 1, avec les sept commits PHYS et `7c180a8` fusionnés) ; push fast-forward de `main` (Vercel) | déploiement READY / Current sur `<sha>` ; le bundle servi contient « Dernier mouvement : termine la séance quand tu as fini. » (module mobilité, absent de la production) et toujours « Partiellement réalisée » | promotion Vercel de `EtPdCZGxCUPBcgJHE2DeF4JcKiEm` (`863f3fb`) |
| **5 Flags OFF** | 5 | `secrets list` (Louis) comme en P6 ; requête d'état | secrets inchangés ; état identique à 2b | STOP ; aucun secret n'est retiré ou ajouté sans GO |
| **6 Contrôles** | 6 | sans écriture : `functions list` (deux versions +1 seulement) ; OPTIONS et POST sans JWT → 401 ; Vercel ; journaux de `daily-run`, `generate-training-plan` et `session-execution` sur 48 h (5xx, `persistence_failed`, `plan_generation_failed`) ; inventaire READINESS-01 relu | aucune hausse ; compteurs PHYS à 0 | décision HPM |

La migration (GO 2) précède tout déploiement Edge. **`NALYNT_V2_POWER_ENABLED` ne peut être envisagé qu'après 2b conforme**, et seulement par une décision ultérieure.

## 8. Risques et STOP

| Risque | Probabilité | Contrôle |
|---|---|---|
| Un secret PHYS ou V2-L2 déjà présent à `"true"` en production | faible : jamais créé | P6, puis 5 ; STOP avant tout déploiement |
| Une donnée PHYS en production (`power_executions > 0`…) | très faible : jamais déployé | P4 ; STOP |
| Graphe différent au build propre (fichier non versionné, `dist` périmé) | faible | P1 ; STOP |
| Migration distante inconnue, ou plusieurs en attente | faible | P2, 2a |
| Échec de 2b | faible : une instruction `create or replace` dans sa transaction | la transaction est annulée et l'état reste 75 ; STOP, analyse |
| Démarrage de `daily-run` en erreur (92 fichiers non bundlés) | faible : graphe vérifié en P1 et servi localement | 3a ; redéploiement depuis P5 |
| Échecs 409 / 422 attendus après la release | voulu | `strength_set_required` ne peut pas viser la puissance sans séance de puissance ; rien d'autre ne change |
| Activation globale par erreur (un secret ajouté) | moyen si une manipulation est faite hors gate | aucune activation dans cette release ; un GO HPM par secret |

## 9. Retour arrière technique et limites

**Release OFF (aucune donnée PHYS écrite)** : retour complet toujours possible.

| Composant | Retour arrière |
|---|---|
| Edge | redéployer `daily-run` puis `generate-training-plan` depuis `C:\Users\Louis\nalynt-rc-863f3fb`, une fonction à la fois ; empreinte = valeur relevée en P3 |
| Web | promotion Vercel du déploiement de `863f3fb`, puis éventuellement `git revert` sur `main` (jamais de force push) |
| SQL 76 | **conserver** (recommandé). La garde ne vise que `power`, sans effet sans séance de puissance |
| SQL, exceptionnel | seulement si la fonction elle-même est en cause, et seulement si `NALYNT_V2_POWER_ENABLED` est absent. Le script `supabase/rollbacks/power-guard-01/20261018120000_rollback_power_guard_01.sql` est appliqué comme **nouvelle** migration. Il réinstalle le corps de `20261013160000` sans toucher aux données, et rouvre le défaut POWER |

**Limites de récupération des données** (après une activation future seulement) :
- **Éteindre un interrupteur ne restaure aucun programme déjà généré** ni aucune prescription persistée.
  - Les séances de fractionné, de puissance et de mobilité acceptées restent dans les plans et restent servies.
  - Les conseils écrits restent dans les prescriptions finales.
  - Les snapshots V2-L2 gardent leurs valeurs ; leur effet sur les doses du plan est définitif pour ce plan.
- **Retour de `daily-run` vers `863f3fb` après une activation** : la précondition `phys04-rollback` doit valoir 0 / 0 / 0 (séances à venir). Sinon :
  - un fractionné baissé à LIGHT donne une erreur de contrat ce jour-là, rien de persisté ;
  - la puissance est servie sans la retenue de fatigue, et l'ancien web ne peut pas la terminer ;
  - la mobilité s'ouvre en lecture seule dans l'ancien web.
- **Remède** : attendre la fin des séances concernées, ou une nouvelle génération sur décision du rider ou du HPM. Aucune réécriture de données n'est prévue.
- **Séances de puissance terminées sous la garde** : elles le restent ; il n'y a rien à restaurer.

## 10. Points bloquants pour la release OFF

Aucun bloqueur technique ouvert. Avant le GO 1 ou pendant celui-ci :
1. **GO HPM et confirmation de Louis** pour chacune des six étapes.
2. **P1 à P6 conformes**, en particulier :
   - aucun secret nouveau à `"true"` ;
   - `power_executions = 0` et tous les compteurs PHYS à 0 ;
   - graphes du build propre égaux à ceux du § 3.
3. **Résultat encore manquant : READINESS-02** (requête d'identification du compte de simulation, fournie, non exécutée).
   - Il ne bloque pas une release OFF, puisque le comportement est celui de la production.
   - Il doit être relevé en P4. Une anomalie (signal V2 hors du compte de simulation, exécutions futures d'un autre compte) est rapportée au HPM avant le GO 2.

## 11. Points bloquants pour l'activation

1. **Portée globale** : chaque secret vaut pour **tous les riders V2** à la fois ; il n'existe aucune activation par rider.
   - Quotidien PHYS : effet dès le jour suivant sur les programmes en cours.
   - Familles : nouveaux plans, séances manuelles et REPLACE.
   - V2-L2 : prochaine génération de chaque rider V2, avec une hausse de dose possible.
   - Prérequis : READINESS-02 confirme que seul le compte de simulation est en V2, ou une décision d'exposer d'autres riders.
2. **Seuils V2-L2** : 180 min sur 8 jours et 2 séances manquées sont PROVISIONAL, calibrés sur des débriefs V1. Ils sont à valider pour la fréquence V2. Les séances partielles comptent 0 (V2-L2-01b).
3. **Paramètres PHYS PROVISIONAL**, à faire valider par un préparateur qualifié :
   - Force : retour au calme, estimation des durées, échelle A10 ;
   - endurance : semaines de fractionné, repli LIGHT, guidage ;
   - puissance : exercices, séries, placement, retenue ;
   - mobilité : semaine de consolidation, 30 min, minimum 22 min.
4. **Conflits de canon PHYS non résolus** :
   - `docs/03` §5, §6, §7 et §10 : propositions non appliquées ;
   - le guidage fondé sur la performance réelle reste interdit (§10) ;
   - la règle des intervalles contredit l'ADR UX-11A.5a.3 §5 (exception proposée) ;
   - `docs/04` (Force à dose égale sous A10, puissance, mobilité) et `docs/07` (glossaire) : non appliqués.
5. **Décisions sportives ouvertes** :
   - puissance un jour LIGHT non définie ;
   - aucun exercice explosif pour les débutants ;
   - M1 sans branche POWER (la retenue V2 la remplace) ;
   - aucune variante au poids du corps ;
   - volume ajouté en semaine de consolidation (+30 min).
6. **POWER** : la migration 76 doit être en production et vérifiée (2b) avant tout `NALYNT_V2_POWER_ENABLED`.
7. **Limites connues avant la bêta V2** :
   - PARTIAL-01-L1 : M1 compte une séance V2 partielle comme faite ;
   - PARTIAL-01-L2 : le moteur longitudinal ne lit pas les résultats V2. La génération V2 est couverte par V2-L2-01a quand son flag est actif.

## 12. Verdict

**READY FOR GATE** : candidat `27e0a67` ; `main` recevra le commit de ce rapport, au-dessus de lui. La release a tous ses nouveaux secrets absents.
- Comportement de production prouvé ; M1 inchangé.
- Seuls `daily-run`, `generate-training-plan`, le web et une migration changent.
- Procédure à six GO, avec contrôles et STOP.

**STOP. Décision HPM attendue.**
