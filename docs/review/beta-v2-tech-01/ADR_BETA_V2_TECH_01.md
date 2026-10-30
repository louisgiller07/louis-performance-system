# ADR BETA-V2-TECH-01 — protection DH indépendante de la coupure, et accès bêta par affectation

**Statut** : **APPROUVÉE** (CANON-GATE CLOSED, 2026-10-30), telle qu'au commit `cbde474`. Le contrat est inchangé depuis.
- **Approbation** : Louis a explicitement approuvé les cinq décisions. La revue indépendante est acceptée comme **substitution architecturale exceptionnelle**, ratifiée par Louis : **le projet Architecte n'a pas signé** (`docs/11`, CANON-GATE CLOSED).
- **Décision HPM CANON-GATE-01 (2026-10-29)** :
  - T2 : APPROVE ;
  - B : APPROVE ;
  - exemptions V1 : MODIFY ciblé. L'option (b) est retenue : la migration additive actuelle est conservée, cette ADR décrit son comportement réel (§ 2.3) ;
  - S4 : APPROVE, sous condition de l'approbation du canon PR2.
- **Décision HPM CANON-GATE-03 (2026-10-29)** : corrections du verdict architectural indépendant appliquées :
  - § 1.3 : les trois cas, avec les champs exacts ;
  - S4 et le patch compagnon `docs/04` : priorité de T2 sur le contrôle de révocation ;
  - § 2.3 : régularisation, STOP jamais levé à la main, première application, délai ;
  - le contrôle de release vérifie aussi la définition de la contrainte de longueur.
- **Décision HPM CANON-GATE-02 (2026-10-29)** : corrections ciblées appliquées :
  - les deux corrections de S4 (§ 5) ;
  - les commentaires de code de T2 ;
  - les conditions de release de l'option (b) (§ 2.3).

  La revue qui les a proposées vient de la même session. Elle ne vaut pas approbation architecturale indépendante.
- **Approbations formelles** : voir le statut ci-dessus (CANON-GATE CLOSED).
- **Implémentation** : sur `beta/v2-tech-01`, depuis `origin/main` `a0a8921`. Elle comprend le contrôle des exemptions V1 : migration `20261027150000`, § 2.3.
  - La branche est publiée en Draft PR #3 (`076721f`, GO de Louis).
  - Les corrections CANON-GATE-01, 02 et 03 et l'intégration de PR2 (BETA-INTEGRATION-01) sont locales et non poussées.
- **Canon** : depuis BETA-INTEGRATION-01, S4 et son patch compagnon `docs/04` sont **appliqués sur cette branche**, après le canon de PR2 fusionné dans `main` (`40b1266`) (§ 5).
- **Interdits respectés** : aucun merge de BETA, aucune migration distante, aucun déploiement Edge, aucun changement d'interrupteur, aucune écriture de production.

## 1. T2 — l'exigence d'unité DH ne dépend d'aucun interrupteur

### Contrat

1. **Toute** exécution de `daily-run` exige l'unité DH signée d'un document V2 : constante gelée `DAILY_DH_UNIT_REQUIREMENT = { dhUnit: "required" }`.
2. **Aucun secret ni aucune requête** ne peut lever cette exigence.
3. **Jour DH d'un document V2 : trois cas distincts** (correction CANON-GATE-03, champs exacts du code).

   | Cas | Réponse de `daily-run` | Ce qui est écrit |
   |---|---|---|
   | **(a) Comptage DH sans unité fiable**, régi par T2 : comptage sans unité (programmes générés avant V2-DH-UNIT-01), ou nouveau comptage d'un exercice auquel les signatures n'attribuent aucune unité | **200**, statut `blocked`, code `final_prescription_adaptation_not_defined`, motif `detail.reason = "dh_repetition_unit_unknown"` | la décision M1, telle que M1 l'a prise (T2 ne touche pas M1) ; **aucune prescription finale** |
   | **(b) Unité déclarée, mais validation sportive retirée**, indépendant de T2 : prescription prévue dont l'unité n'est plus attribuée par les signatures (KEEP, ou MODIFY / REPLACE de la séance générée) | **409**, code `dh_validation_not_current` | **rien** : ni décision, ni prescription |
   | **(c) Exercice révoqué dans la prescription finale à écrire**, PR2 | **409**, code `dh_validation_not_current` : refus transactionnel `NX302` de `persist_daily_run_v2` | **rien** : aucune nouvelle décision |

   **Pour le cas (b)** :
   - le motif de validation est `dh_unit_not_attributed`, ou `dh_content_not_signed` (`validatePrescriptionV2.ts:297`) ;
   - `trustedPlannedStructure` lève alors `DhSportValidationNotCurrentError` (`buildKeepFinalPrescriptionV2.ts:117`, `:141-143`) ;
   - `daily-run/errorMapping.ts:55-57` le traduit en 409. Le motif n'est pas exposé.

   **Priorité** :
   - le cas (a) se décide avant toute écriture, sans prescription finale ;
   - le contrôle de révocation de `persist_daily_run_v2` ne s'exécute que si une prescription finale est à écrire (migration `20261027120000`, `if v_fp is not null`) ;
   - un comptage sans unité donne donc 200 `blocked`, avec la décision écrite, **même si son exercice est révoqué** ;
   - le cas (c) ne concerne que les prescriptions finales dont l'unité est signée.
4. **Autres familles** du même document : servies. **Documents V1** : non concernés.
5. `NALYNT_V2_PLAN_GENERATION_ENABLED` commande **seulement** la création de nouveaux programmes V2.

### Option écartée

**A. Secret de protection dédié** : un secret pourrait encore lever une protection de sécurité, et un oubli au lancement suffirait.

### Conséquences

- **Production, au déploiement** :
  - tout programme V2 accepté sans unité signée a ses jours DH bloqués (cas (a)). C'est aujourd'hui le cas du compte de test V2 ;
  - **aucune régénération ne peut lever ce blocage tant qu'aucune unité n'est signée**. La génération est refusée : 503 `v2_generation_disabled` avec l'interrupteur OFF ; 422 `dh_repetition_unit_unknown` avec l'interrupteur ON (`generate-training-plan/index.ts:218`) ;
  - c'est voulu (fail-closed). Les jours DH V2 reprennent seulement avec des signatures sportives réelles.
- **Bibliothèque** : `runDailyFor` garde son défaut pour les appelants Node (tests, outils). Le seul point d'entrée de production est la fonction Edge `daily-run`, qui impose la constante (test unitaire).
- **Intégration avec PR2** : le scénario « production » de `v2DhRevocationDailyRun` ne reflète plus la production.
  - La résolution S3 a été acceptée par le HPM le 2026-10-29 : le rider devient « legacy ».
  - Elle ajoute deux cas T2 : un document sans unité est bloqué, avant comme après la révocation.
  - Voir `docs/review/v2-integration/INTEGRATION_RESULTS.md`.
- **Retour arrière** : revenir sur le commit, sans reprise de données.

### Preuves (faites)

- **Unitaires** : la constante ne lit aucun secret ; `daily-run` la passe et ne dérive rien de l'interrupteur.
- **HTTP**, en `off` et en `on_unsigned` : jour DH sans unité bloqué, sans prescription finale ; jour de Force servi ; rider V1 non concerné.
- **Contre-preuve** : sur l'ancien code, le même test échoue (jour DH servi).

## 2. B — l'affectation serveur est l'autorisation de générer

### 2.1 Contrat

| Affectation (`training_plan_model_assignments`) | Interrupteur V2 | Résultat |
|---|---|---|
| `v2` | ON | programme V2 |
| `v2` | OFF | **503** `v2_generation_disabled` (A09, inchangé) |
| `v1` | ON ou OFF | programme V1 : **exemption explicite, comptes de test seulement** (§ 2.3) |
| aucune | ON ou OFF | **403** `beta_access_not_granted`, rien n'est écrit : **jamais V1 par défaut** |
| illisible ou invalide | ON ou OFF | **503** `beta_access_check_unavailable`, rien n'est écrit |

- **Aucune conversion** entre V1 et V2.
- **Le navigateur ne décide de rien** :
  - la requête ne choisit jamais le modèle (toute clé inconnue, 400) ;
  - le client ne lit ni n'écrit aucune affectation (`service_role` seulement ; écriture du rider refusée, 42501).
- **Traces** :
  - chaque génération porte `rolloutReason` (`assigned_v1`, `assigned_v2`, `assigned_v2_disabled`) ;
  - un refus 403 produit `plan_generation_blocked` avec `beta_access_not_granted` et `not_assigned`, sans modèle.

### 2.2 Messages web

| Code | Message | Bouton « Réessayer » |
|---|---|---|
| 403 `beta_access_not_granted` | « Ton accès à la bêta n'est pas encore activé. Ton programme pourra être créé dès qu'il le sera. » | non |
| 503 `beta_access_check_unavailable` | « La création du programme est momentanément indisponible. Réessaie dans un instant. » | oui |

Aucun programme V1 n'est proposé à la place, et aucun canal de contact n'est inventé. À arbitrer : ajouter ou non un canal réel au 403.

### 2.3 Exemptions V1 : contrôle serveur minimal (option A, migration `20261027150000` ; comportement : option (b), HPM CANON-GATE-01)

**Ce qui est déjà garanti** :
- aucune exemption ne vient du navigateur (§ 2.1) ;
- aucune V1 implicite (403 sans ligne) ;
- refus sûr en cas d'erreur de lecture (503).

**Ce qui manque** : une ligne `v1` peut exister **sans motif** (`note` facultative) ni **auteur**. La liste des comptes exemptés n'est donc pas traçable.

**Option A (retenue, HPM 2026-10-29)** : une migration additive, sans changement de code.
- Migration `20261027150000`, placée entre PR2 et SPORT, avec son rollback.
- Contrôles en lecture seule : inventaire, contrôle après migration, contrôle de release.
- Suite dédiée.

```sql
alter table public.training_plan_model_assignments
  add column if not exists decided_by text;
alter table public.training_plan_model_assignments
  add constraint training_plan_model_assignments_decided_by_length
    check (decided_by is null or (length(trim(decided_by)) > 0 and char_length(decided_by) <= 200)),
  add constraint training_plan_model_assignments_v1_exemption_traced
    check (planning_model <> 'v1' or (note is not null and decided_by is not null)) not valid;
-- puis, dans la même migration : VALIDATE seulement si aucune ligne v1 n'est sans motif ou sans auteur ;
-- sinon la contrainte reste NOT VALID et la migration le signale (NOTICE), sans échouer.
```

**Comportement de la migration : option (b), choix HPM CANON-GATE-01 (2026-10-29)**
- **La migration peut réussir avec des affectations V1 historiques non tracées.**
  - **À la première application**, `decided_by` est une nouvelle colonne : juste après la migration, **toute** ligne `v1` existante est sans auteur. La contrainte n'est donc validée dans la migration que si la base n'a **aucune** ligne `v1`.
  - **Après un rollback**, le rollback garde la colonne et ses valeurs. Une réapplication ne valide la contrainte que si aucune ligne `v1` n'est sans motif ou sans auteur.
- **La contrainte `NOT VALID` protège toutes les nouvelles écritures et mises à jour.**
  - Une nouvelle ligne `v1` sans motif ou sans auteur est refusée (23514).
  - Une mise à jour qui laisse une ancienne ligne `v1` sans motif ou sans auteur est refusée aussi : la règle porte sur la ligne résultante.
- **Les anciennes affectations non tracées peuvent subsister.**
  - Elles autorisent toujours la génération V1, car l'Edge ne lit que `planning_model`.
  - Aucun auteur n'est jamais inventé : chaque ligne reçoit la vraie décision (GO Louis), voir « Ordre », étape 3.
- **La release s'arrête avant le déploiement de `generate-training-plan` tant que la contrainte n'est pas `VALID`.**
  - Le contrôle exécutable en lecture seule `V1_EXEMPTION_RELEASE_GATE_READONLY.sql` répond GO ou STOP.
  - Il vérifie notamment `pg_constraint.convalidated` et la définition exacte des deux contraintes (trace et longueur de `decided_by`), l'absence de ligne `v1` non conforme et l'accès inchangé.
  - Toute erreur vaut STOP.
- **Option (a), écartée** : faire échouer la migration en présence d'une ligne `v1` non tracée.
  - Comme le traçage suppose la colonne, il faudrait deux migrations.
  - Le comportement actuel protège déjà les écritures, et le contrôle de release bloque le déploiement.

- **Garantie** : toute exemption `v1` porte un motif (« compte de test : … ») et un auteur.
  - Une fois la contrainte `VALID`, c'est vrai aussi des lignes historiques.
  - `created_at` et `updated_at` existent déjà.
  - Même forme que `dh_drill_revocations` (`reason`, `decided_by`).
- **Traçabilité** :
  - requêtes de suivi en lecture seule (`planning_model = 'v1'` : compte, motif, auteur, dates) ;
  - `rolloutReason: assigned_v1` sur chaque génération V1.
- **Ordre** :
  1. inventaire en lecture seule `V1_EXEMPTION_PREFLIGHT_READONLY.sql` (GO Louis) : lignes `v1`, toutes sans auteur après la migration, et athlètes sans affectation ;
  2. migration ; à la première application, la contrainte n'est `VALID` d'emblée que s'il n'existe aucune ligne `v1` ;
  3. écritures des affectations (GO Louis) :
     - chaque ligne `v1` historique reçoit la vraie décision :
       - **compte de test** : motif et auteur réels ;
       - **vrai rider** : jamais exempté artificiellement en `v1`. La décision explicite est une affectation `v2` ou la suppression de l'affectation : sans ligne, 403 ;
     - puis `VALIDATE` ;
     - affectation `v2` pour chaque pilote ;
  4. contrôle de release `V1_EXEMPTION_RELEASE_GATE_READONLY.sql` : **GO obligatoire** ;
  5. déploiement de `generate-training-plan`.
- **Conditions de release de l'option (b)** (revue CANON-GATE-02, à reprendre telles quelles dans le plan de release BETA, qui n'existe pas encore) :
  1. **Migration par `db push`** : elle est ainsi enregistrée dans `supabase_migrations.schema_migrations`, ce que le contrôle vérifie. Une migration appliquée autrement donne STOP.
  2. **Contrôle bloquant après `VALIDATE`** : c'est une étape numérotée et obligatoire, entre l'étape 3 et le déploiement Edge.
     - Toute erreur vaut STOP, jamais GO.
     - On ne consigne que les compteurs, aucun identifiant de rider.
     - Ce blocage est procédural : rien n'empêche techniquement de déployer sans le contrôle. L'étape ne se saute donc jamais.
  3. **Vérification stricte des définitions** : le contrôle compare la définition rendue par PostgreSQL des deux contraintes (trace et longueur) au texte attendu.
     - **Un STOP ne se lève jamais par une simple comparaison manuelle.** Si le rendu de PostgreSQL diffère, le déploiement reste bloqué.
     - Il faut alors enquêter, adapter formellement le contrôle si nécessaire (commit, revue), le retester sur une pile jetable, puis obtenir son GO.
     - La vérification n'est jamais affaiblie ni retirée sans décision d'architecture.
  - **Délai** : le contrôle n'arme aucun `statement_timeout` propre. Un `SET` exécuté dans l'instruction en cours ne s'applique pas à elle. C'est le délai de la session qui vaut : celui de l'éditeur SQL ou du rôle, ou un `set statement_timeout` lancé avant le contrôle avec psql.
- **Tests** :
  - `v1` sans `note` ou sans `decided_by` refusé (23514) ; `v1` complet accepté ; `v2` sans eux accepté ;
  - `anon` et `authenticated` toujours sans accès ;
  - table de résolution inchangée ;
  - contrôle de release (CANON-GATE-03), sur pile jetable neuve (garde-fou, fixtures TEST) : **11 verdicts sur 11 conformes**, avec les motifs exacts :
    - **GO** : base neuve ; après traçage et `VALIDATE` ; après chaque restauration ;
    - **STOP** : rollback ; ligne `v1` historique non tracée (`NOT VALID`) ; ligne tracée sans `VALIDATE` ; contrainte de trace affaiblie sous le même nom ; **contrainte de longueur affaiblie sous le même nom** ; droit client accordé ;
    - le contrôle met sa transaction en lecture seule : une écriture tentée après lui est refusée ;
    - portée du délai : un `SET LOCAL statement_timeout` exécuté dans le bloc DO ne s'applique pas à lui (2 s de pause terminées sous une valeur de 1 s), alors que le même réglage posé avant l'instruction l'interrompt.
  - erratum : la preuve CANON-GATE-01 comptait 9 verdicts du contrôle, plus 1 preuve de lecture seule, et non « 10 verdicts ».
- **Limite** : le schéma ne sait pas ce qu'est un « compte de test ». Le motif et l'auteur rendent chaque exemption vérifiable, sans la prouver.

**Options écartées** :

| Option | Écartée parce que |
|---|---|
| B. Secret listant les comptes V1 | double source, aucune trace de l'auteur, redéploiement à chaque changement |
| C. Marqueur « compte de test » sur `athletes`, avec contrainte croisée | nouvelle notion administrative, trigger inter-tables ; plus lourd que le besoin |
| D. Règle d'exploitation seule | rien n'empêche une ligne `v1` sans motif |

### 2.4 Conséquences

- **Tout compte de production sans affectation** est refusé à sa prochaine génération. Ses programmes actuels continuent au quotidien.
- **Avant le déploiement**, GO de Louis à chaque fois :
  - `v1` pour chaque compte de test qui garde V1 (motif et auteur) ;
  - `v2` pour chaque pilote ;
  - puis le contrôle de release (§ 2.3), qui doit répondre GO.
- **Intégration avec PR2** : `v2DhRevocationV1Http` reçoit une affectation `v1` tracée dans sa fixture. C'est la résolution S2, acceptée par le HPM le 2026-10-29.
- **Inscriptions publiques** : non touchées. Un non-invité peut s'inscrire, pas générer.

### 2.5 Preuves (faites)

- **Unitaires** : table de résolution (6 cas) ; aiguillage (refus sans appel de génération, exemption V1, erreur de lecture) ; correspondance d'erreur Edge ; messages web.
- **HTTP** sur la fonction Edge, runtimes `off`, `on_unsigned` et `on_test_signed` :
  - sans affectation, 403 ;
  - rider qui s'accorde l'accès, 42501, et clés forgées, 400, toujours 403 ;
  - `v1`, programme V1 ;
  - `v2`, 503, 422 ou V2 selon le runtime ;
  - affectation illisible, 503, rien d'écrit.

## 3. T1 — partition V2 ON (changement de test, pas de canon)

- `p0_3KeptDayRerun` génère son premier programme avec le bundle même du runtime, refusé si la marque de test manque.
- Aucune signature inventée, moteur inchangé.

## 4. Hors de cette ADR

- T4, la suspension d'une séance ou d'une version : `T4_SUSPENSION_DESIGN.md`.
- Les inscriptions publiques (couche A).
- Les écritures de production des affectations.

## 5. Canon : contrat `docs/05` fusionné (patch S4) et patch compagnon `docs/04`

**Textes canoniques**, tous deux appliqués au merge de BETA, après celui de PR2 (`83013c6`) :
- `docs/review/v2-integration/S4_DOCS05_MERGED.patch` (`docs/05`) ;
- `docs/review/v2-integration/S4_DOCS04_COMPANION.patch` (`docs/04`).

Ils remplacent les extraits proposés auparavant ici. Leur application conjointe sur PR2 `83013c6` est vérifiée par `git apply --check`.

**Décisions HPM** :
- CANON-GATE-01 : S4 APPROVE, sous condition de l'approbation du canon PR2 ;
- CANON-GATE-02 : deux corrections, issues d'une revue de la même session (sans valeur d'approbation architecturale indépendante) ;
- CANON-GATE-03 : corrections du verdict indépendant (3 bloquantes, plus les complémentaires).

**Contenu de S4 (`docs/05`)** :
- **Section `training_plan_model_assignments`** :
  - l'affectation est l'autorisation de générer ; sans ligne, 403, jamais V1 par défaut ;
  - `v1` est une exemption tracée (`note` et `decided_by` obligatoires), avec la condition complète de l'option (b) :
    - la contrainte s'applique à toute ligne nouvelle ou modifiée ;
    - à la première application, la migration ne la valide que s'il n'existe aucune ligne `v1` ;
    - les lignes historiques non tracées peuvent subsister et autorisent encore V1 ;
    - `generate-training-plan` n'est déployée qu'une fois chaque ligne tracée, la contrainte `VALID` et le contrôle de release à GO ;
  - `v2` avec l'interrupteur OFF : 503 (A09) ;
  - affectation illisible : 503 ;
  - aucune conversion ;
  - nouvelle colonne `decided_by`.
- **Chemin V2 de la prescription du jour**, puce « Unité DH signée exigée (T2) » : les cas (a) et (b) du § 1.3, avec les champs exacts.
  - (a) Comptage sans unité fiable : 200, `blocked`, code `final_prescription_adaptation_not_defined`, motif `dh_repetition_unit_unknown` ; décision M1 écrite, aucune prescription du jour.
  - (b) Unité déclarée mais non attribuée (`dh_unit_not_attributed`) : 409 `dh_validation_not_current`, rien n'est écrit.
- **Section `dh_drill_revocations` (PR2)** :
  - priorité de T2 : `persist_daily_run_v2` ne contrôle la révocation que si une prescription du jour est à écrire, donc `NX302` ne concerne que les prescriptions dont l'unité est signée ;
  - verrou `SHARE` : pris à chaque lot par `record_session_execution`, et par `persist_daily_run_v2` seulement si la prescription à écrire contient un exercice DH ;
  - `TRUNCATE` : réservé au seul propriétaire de la table.
- **Table des interrupteurs serveur V2** : `NALYNT_V2_PLAN_GENERATION_ENABLED` ne commande aucune protection (T2).

**Patch compagnon (`docs/04`, diff n° 5 de PR2)** : il ajoute une phrase.
- Depuis T2, un comptage DH sans unité fiable donne 200 `blocked`, avec la décision M1 écrite, exercice révoqué ou non, sans 409.
- Le refus transactionnel et sa persistance ne concernent que les comptages dont l'unité est signée.

**`docs/11_DECISION_LOG.md`** : une entrée ADR, une fois approuvée par l'architecte et Louis.
