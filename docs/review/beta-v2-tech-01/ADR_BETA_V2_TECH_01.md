# ADR BETA-V2-TECH-01 — protection DH indépendante de la coupure, et accès bêta par affectation

**Statut** : **PRÊTE POUR APPROBATION** (contrat final, corrigé par la décision HPM CANON-GATE-01).
- **Décision HPM CANON-GATE-01 (2026-10-29)** :
  - T2 : APPROVE ;
  - B : APPROVE ;
  - exemptions V1 : MODIFY ciblé. L'option (b) est retenue : la migration additive actuelle est conservée, cette ADR décrit son comportement réel (§ 2.3) ;
  - S4 : APPROVE, sous condition de l'approbation du canon PR2.
- **Décision HPM CANON-GATE-02 (2026-10-29)** : corrections ciblées appliquées :
  - les deux corrections de S4 (§ 5) ;
  - les commentaires de code de T2 ;
  - les conditions de release de l'option (b) (§ 2.3).

  La revue qui les a proposées vient de la même session. Elle ne vaut pas approbation architecturale indépendante.
- **Approbations formelles** : celles de l'architecte et de Louis sont dues. Aucune n'est présumée.
- **Implémentation** : sur `beta/v2-tech-01`, depuis `origin/main` `a0a8921`. Elle comprend le contrôle des exemptions V1 : migration `20261027150000`, § 2.3.
  - La branche est publiée en Draft PR #3 (`076721f`, GO de Louis).
  - Les corrections CANON-GATE-01 et CANON-GATE-02 sont locales et non poussées.
- **Canon** : `docs/05` n'est pas modifié sur cette branche. Le contrat fusionné est le patch S4, appliqué après le canon de PR2 (§ 5).
- **Interdits respectés** : aucun merge, aucune migration distante, aucun déploiement, aucun changement d'interrupteur, aucune écriture de production.

## 1. T2 — l'exigence d'unité DH ne dépend d'aucun interrupteur

### Contrat

1. **Toute** exécution de `daily-run` exige l'unité DH signée d'un document V2 : constante gelée `DAILY_DH_UNIT_REQUIREMENT = { dhUnit: "required" }`.
2. **Aucun secret ni aucune requête** ne peut lever cette exigence.
3. **Jour DH d'un document V2 sans unité signée** :
   - la décision du jour est persistée telle que M1 l'a prise : T2 ne touche pas M1 ;
   - **aucune prescription finale** n'est créée ;
   - réponse 200, statut `blocked`, trace `dh_repetition_unit_unknown`.
4. **Autres familles** du même document : servies. **Documents V1** : non concernés.
5. `NALYNT_V2_PLAN_GENERATION_ENABLED` commande **seulement** la création de nouveaux programmes V2.

### Option écartée

**A. Secret de protection dédié** : un secret pourrait encore lever une protection de sécurité, et un oubli au lancement suffirait.

### Conséquences

- **Production, au déploiement** :
  - tout programme V2 accepté sans unité signée a ses jours DH bloqués (aujourd'hui le compte de test V2, à régénérer) ;
  - c'est voulu (fail-closed).
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
  - `decided_by` est une nouvelle colonne : juste après la migration, **toute** ligne `v1` existante est sans auteur.
  - La contrainte n'est donc validée dans la migration que si la base n'a **aucune** ligne `v1`.
- **La contrainte `NOT VALID` protège toutes les nouvelles écritures et mises à jour.**
  - Une nouvelle ligne `v1` sans motif ou sans auteur est refusée (23514).
  - Une mise à jour d'une ancienne ligne `v1` qui ne pose pas les deux est refusée aussi.
- **Les anciennes affectations non tracées peuvent subsister.**
  - Elles autorisent toujours la génération V1, car l'Edge ne lit que `planning_model`.
  - Aucun auteur n'est jamais inventé : chaque ligne est tracée avec la vraie décision (GO Louis).
- **La release s'arrête avant le déploiement de `generate-training-plan` tant que la contrainte n'est pas `VALID`.**
  - Le contrôle exécutable en lecture seule `V1_EXEMPTION_RELEASE_GATE_READONLY.sql` répond GO ou STOP.
  - Il vérifie notamment `pg_constraint.convalidated`, la définition de la contrainte, l'absence de ligne `v1` non conforme et l'accès inchangé.
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
  2. migration ; la contrainte n'est `VALID` d'emblée que s'il n'existe aucune ligne `v1` ;
  3. écritures des affectations (GO Louis) :
     - chaque ligne `v1` historique est tracée avec la vraie décision, puis `VALIDATE` ;
     - affectation `v2` pour chaque pilote ;
  4. contrôle de release `V1_EXEMPTION_RELEASE_GATE_READONLY.sql` : **GO obligatoire** ;
  5. déploiement de `generate-training-plan`.
- **Conditions de release de l'option (b)** (revue CANON-GATE-02, à reprendre telles quelles dans le plan de release BETA, qui n'existe pas encore) :
  1. **Migration par `db push`** : elle est ainsi enregistrée dans `supabase_migrations.schema_migrations`, ce que le contrôle vérifie. Une migration appliquée autrement donne STOP.
  2. **Contrôle bloquant après `VALIDATE`** : c'est une étape numérotée et obligatoire, entre l'étape 3 et le déploiement Edge.
     - Toute erreur vaut STOP, jamais GO.
     - On ne consigne que les compteurs, aucun identifiant de rider.
     - Ce blocage est procédural : rien n'empêche techniquement de déployer sans le contrôle. L'étape ne se saute donc jamais.
  3. **Vérification stricte de la définition** : le contrôle compare la définition rendue par PostgreSQL au texte attendu.
     - Si le rendu de la production diffère, c'est STOP. On compare alors à la main.
     - La vérification n'est jamais affaiblie ni retirée sans décision d'architecture.
- **Tests** :
  - `v1` sans `note` ou sans `decided_by` refusé (23514) ; `v1` complet accepté ; `v2` sans eux accepté ;
  - `anon` et `authenticated` toujours sans accès ;
  - table de résolution inchangée ;
  - contrôle de release, sur pile jetable neuve (garde-fou, fixtures TEST) : 10 verdicts sur 10 conformes, avec les motifs exacts :
    - **GO** : base neuve ; après traçage et `VALIDATE` ; après chaque restauration ;
    - **STOP** : rollback ; ligne `v1` historique non tracée (`NOT VALID`) ; ligne tracée sans `VALIDATE` ; contrainte affaiblie sous le même nom ; droit client accordé ;
    - le contrôle met sa transaction en lecture seule : une écriture tentée après lui est refusée.
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

## 5. Canon : contrat `docs/05` fusionné (patch S4)

Le texte canonique est le patch `docs/review/v2-integration/S4_DOCS05_MERGED.patch`. Il s'applique sur le `docs/05` de PR2 et remplace les extraits proposés auparavant ici.

**Décisions HPM** :
- CANON-GATE-01 : APPROVE, sous condition de l'approbation du canon PR2 ;
- CANON-GATE-02 : deux corrections appliquées, issues d'une revue de la même session. Cette revue ne vaut pas approbation architecturale indépendante.

S4 est appliqué au merge de BETA, après celui de PR2.

Contenu :
- **Section `training_plan_model_assignments`** :
  - l'affectation est l'autorisation de générer ; sans ligne, 403, jamais V1 par défaut ;
  - `v1` est une exemption tracée (`note` et `decided_by` obligatoires). Correction CANON-GATE-02 : S4 énonce la condition complète de l'option (b) :
    - la contrainte s'applique à toute ligne nouvelle ou modifiée ;
    - la migration ne la valide que s'il n'existe aucune ligne `v1` ;
    - les lignes historiques non tracées peuvent subsister et autorisent encore V1 ;
    - `generate-training-plan` n'est déployée qu'une fois chaque ligne tracée, la contrainte `VALID` et le contrôle de release à GO ;
  - `v2` avec l'interrupteur OFF : 503 (A09) ;
  - affectation illisible : 503 ;
  - aucune conversion ;
  - nouvelle colonne `decided_by`.
- **Chemin V2 de la prescription du jour** (correction CANON-GATE-02) : une puce dédiée à l'unité DH signée exigée (T2).
  - Le statut est `blocked`, avec le code `final_prescription_adaptation_not_defined` et le motif `dh_repetition_unit_unknown`.
  - La décision M1 est persistée ; aucune prescription du jour n'est créée.
  - L'exigence est imposée par `daily-run`, quel que soit l'interrupteur.
- **Section `dh_drill_revocations` (PR2)** : une phrase T2 ajoutée, car l'unité DH est toujours exigée.
- **Table des interrupteurs serveur V2** : `NALYNT_V2_PLAN_GENERATION_ENABLED` ne commande aucune protection (T2).

**`docs/11_DECISION_LOG.md`** : une entrée ADR, une fois approuvée par l'architecte et Louis.
