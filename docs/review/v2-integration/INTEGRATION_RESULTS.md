# Préparation de l'intégration V2 — PR2, BETA, SPORT (2026-10-29)

**Statut : STOP pour décision HPM et Louis.**
- **Branche jetable** : `local/v2-integration` (worktree `C:/nx/pr2sport`, sans branche amont), depuis `origin/main` `a0a8921`.
- **Branches sources** : intactes et séparées. PR2 `0f18f31` et SPORT `72ef231` sont inchangées ; BETA a reçu trois commits de développement, sans aucune fusion (§ 4 et 6).
- **Hors périmètre** : aucun push, merge, migration distante, déploiement, écriture de production ni activation V2 ; aucun vidage mémoire Windows.
- **Campagnes** : pile jetable `nalynt-dhunit01` uniquement, **par le garde-fou**, pile neuve à chaque étape.

## 1. Conflits S1 à S4

| # | Constat | Résolution (commit jetable, patch conservé) | Preuve |
|---|---|---|---|
| **S1** | Après la fusion SPORT, `a5P0Hardening` ne compile plus (`TS2304`, 29 erreurs pour 28 en base). Git ne l'a pas signalé : seul le bloc d'imports était en conflit textuel. | Imports unis dans la fusion ; le cas SPORT « no bypass » génère son second programme avec `generateSignedV2Plan` (`resolutions/S1.patch`). | Typage revenu à 28 ; partition V2 ON signée « test » 61/61, `a5P0Hardening` compris. |
| **S2** | `v2DhRevocationV1Http` (PR2) génère en V1 sans affectation, donc 403 après B. | Affectation `v1` tracée (motif, auteur « TEST ») dans la fixture ; assertions inchangées (`resolutions/S2.patch`). | 5/5 dans la suite V2 OFF Linux. |
| **S3** | `v2DhRevocationDailyRun` (PR2) appelait « production » un quotidien sans exigence d'unité. Après T2, la production l'exige toujours. | Le rider devient « legacy », les lignes antérieures à T2 ; ses preuves sont inchangées. Deux cas ajoutés au point d'entrée de production après T2 : document sans unité bloqué (`dh_repetition_unit_unknown`), rien de prescrit, avant et après la révocation. La preuve de révocation reste sur le rider à unités signées « test » (`resolutions/S3.patch`). | **6/6** sous Linux, pile neuve. Sous Windows, une mort de worker a laissé 2 tests sans résultat (4/4 réussis avant). |
| **S4** | Les sections `docs/05` de PR2 (`dh_drill_revocations`) et de BETA (`training_plan_model_assignments`) sont voisines. | Contrat fusionné **proposé, non appliqué** (`S4_DOCS05_MERGED.patch`, 8 lignes) : résolution B, colonne `decided_by`, interrupteur sans protection, et la phrase reliant la révocation et T2. | `git apply --check` : s'applique sur l'intégration (canon PR2 présent) et **échoue sur BETA seule**. Il passe donc après le canon de PR2. |

## 2. Intégration locale

**Commits de la branche jetable** :
1. `daf7913` : fusion de PR2 ;
2. `c649585` : fusion de BETA (docs 00 et 11 en conflit, les deux entrées gardées) ;
3. `6c46399` : S2 ;
4. `06159dc` : S3 ;
5. `9dc17d4` : fusion de SPORT (docs 00, 11, 12, imports de `a5P0Hardening`) ;
6. `8568470` : S1.

| Contrôle | Résultat |
|---|---|
| Builds (`build:release`, `verify:sport-approvals`, bundles Edge, web) | OK |
| Unitaires | `planning-engine` 1 186, `prescription-engine` 96, `longitudinal-engine` 683, `head-coach-engine` 1 111, Edge 67/67, web 2 498 : 0 échec |
| Typage `head-coach-engine` | 28 erreurs = base (29 avant S1) |
| Migrations depuis zéro | 80 appliquées, dernière `20261028120000` |
| Contrôles en lecture seule | PR2 : tout vrai, 0 révocation ; SPORT : tout vrai ; BETA : colonne, deux contraintes, contrainte validée, 0 ligne `v1` sans trace, aucune policy, aucun droit client |
| **Suite complète V2 OFF (Linux)** | **1 269 réussis, 0 échec, 0 mort de worker, 0 rechargement** (157 fichiers ; 90 ignorés, réservés aux autres partitions) |
| V2 ON, signée « test » (Windows) | 61/61 (10 fichiers) ; bundles réels restaurés à l'identique, garde de bundle 7/7 |
| V2 ON, bundles réels (Windows) | 8/8 |
| Web, intégration (Windows) | 75/75 |
| PR2, révocation (pile neuve) | 12/12 ; rollback PR2 **refusé** après 7 révocations, comme attendu |
| PR2, quotidien de révocation, avec S3 (pile neuve, Linux) | 6/6 |

**Non rejouées** : les suites propres aux runtimes PHYS et au « runtime précédent » (`phys0*Edge`, `phys0*PreviousRuntimeCompat`, `v2L2HistoryEdge`). Elles étaient déjà ignorées dans les campagnes précédentes, faute de partition dédiée.

## 3. Preuve V2 OFF hors de Windows

**Ce qui est fait** : la suite complète V2 OFF tourne dans un **conteneur Linux** sur ce poste. Son environnement :
- Node 24.15.0 ;
- un espace de travail sur le système de fichiers Linux de la VM Docker (volume nommé), hors du partage de fichiers Windows ;
- les fonctions servies depuis Linux par la CLI Supabase 2.114.0 ;
- la pile jetable démarrée et arrêtée par le garde-fou.

| Passage (pile neuve à chaque fois) | Réussis | Échecs | Morts de workers | Rechargements | Durée |
|---|---|---|---|---|---|
| s21-L2 | 1 269 | 0 | 0 / 157 | 0 | 239 s |
| s22-L1 | 1 269 | 0 | 0 / 157 | 0 | 239 s |
| s22-L2 | 1 269 | 0 | 0 / 157 | 0 | 237 s |
| s22-L3 | 1 269 | 0 | 0 / 157 | 0 | 236 s |

**Lecture** :
- **Sous Linux** : 4 passages sur 4 sont propres. Il n'y a eu aucune mort sur 628 workers instrumentés, aucun rechargement, et chaque passage a duré environ 240 s.
- **Sous Windows**, pour comparaison : 5 morts sur 1 071 workers, 2 passages sur 7 avec rechargement, environ 470 s par passage.
- **Hasard exclu à environ 1 sur 20** : au taux observé sous Windows, 628 workers sans aucune mort n'arriveraient qu'environ une fois sur vingt.

**Ce que cela montre** : sur Linux, ni mort de worker, ni rechargement du runtime. Les deux obstacles sont propres à l'exécution sous Windows (processus Node, partage de fichiers Windows–conteneurs), pas aux tests ni au code.

**Ce qui reste** :
- **Ce n'est pas une preuve hors du poste** : même machine, même moteur Docker.
- **La preuve hors du poste est prête** : job CI `integration-v2-off` (`.github/workflows/integration-v2-off.yml`, branche BETA). Il tourne sur Linux GitHub avec une pile Supabase jetable dans le runner, et échoue sur tout rechargement.
- **Obstacle exact** : ce job ne s'exécute qu'après un **push autorisé par Louis**, sur une PR vers `main` ou à la main.

**Deux erreurs de méthode corrigées en route** :
- le `/tmp` de la VM Docker est `noexec` : `npm ci` échouait (esbuild, `EACCES`) ; je l'ai remplacé par un volume nommé ;
- un script de campagne écrasait ses propres résultats ; je l'ai arrêté avant tout démarrage de pile, corrigé et relancé.

## 4. État des migrations

| Migration | Branche | État |
|---|---|---|
| 77 premières (dernière `20261021200000`) | `main` | appliquées en production |
| `20261027120000` révocation DH (+ rollback) | PR2 | non déployée ; canon en attente (réserve R1) |
| `20261027150000` exemptions V1 tracées (+ rollback) | **BETA (nouvelle)** | candidate, locale |
| `20261028120000` catégorie professionnelle commotion (+ rollback) | SPORT | candidate, locale ; GO distinct |

- **Ordre** : l'horodatage BETA est placé entre PR2 et SPORT pour l'ordre recommandé PR2, BETA, SPORT. Si SPORT passait avant BETA, il faudrait renommer la migration BETA avant de la publier.
- **Indépendance** : aucun objet commun entre les trois migrations.
- **Rollbacks** :
  - BETA : sûr, garde la colonne `decided_by` et ses valeurs, puis se ré-applique ;
  - PR2 : refusé dès qu'une révocation existe ;
  - SPORT : validé en REVIEW 1.

## 5. Contrôle des exemptions V1 (BETA, commit `83ff111`)

- **Migration additive** : colonne `decided_by` ; contrainte « `v1` exige `note` (motif) et `decided_by` (auteur) ». Aucun changement de code ; la table reste `service_role` seulement.
- **Lignes existantes** : jamais réécrites, jamais d'auteur inventé. La contrainte est ajoutée `NOT VALID`, puis validée dans la même migration s'il n'existe aucune ligne `v1` sans trace. Sinon la migration le signale et la release s'arrête.
- **Prouvé sur pile jetable** :
  - une ligne `v1` existante sans trace laisse la contrainte `NOT VALID` (1 ligne signalée) ;
  - une nouvelle ligne sans trace est refusée ;
  - après traçage, `VALIDATE` réussit ;
  - la suite dédiée passe 5/5 : opérateur, propriétaire, mises à jour, `v2` inchangé, pilote sans accès.
- **Inventaire en lecture seule**, à lancer avec un GO : `V1_EXEMPTION_PREFLIGHT_READONLY.sql`. Il donne les lignes `v1`, celles sans motif, et les **athlètes sans affectation**, qui ne pourront plus générer après B.
- **Aucune V1 implicite** : inchangé (403 sans ligne).

## 6. Draft PR préparées, non publiées

- BETA : `DRAFT_PR_BETA.md`.
- SPORT : `DRAFT_PR_SPORT.md`.

Pour PR2, rien n'est préparé ici : la Draft PR #2 existe déjà.

## 7. Décisions formelles restant nécessaires

1. **Architecte et Louis** : ADR BETA-V2-TECH-01 (T2, B, exemptions V1) et contrat `docs/05` fusionné (S4).
2. **Architecte et Louis** : canon de PR2 (réserve R1), préalable à sa fusion, donc à l'empilement.
3. **HPM** : cohérence des contrats après intégration, en particulier S3 (le « production » de PR2 devient « legacy », plus deux cas T2).
4. **Architecte** : le job CI `integration-v2-off`, contrôle requis ou non.
5. **Louis** : GO de push des branches (Draft PR BETA et SPORT, commits locaux de PR2), puis un GO par merge.
6. **Professionnels** : signatures sportives de SPORT. Aucune signature automatique.
7. **Plus tard, GO distincts** : inventaire de production, migrations, écritures d'affectations, déploiements, régénération du compte de test V2.
