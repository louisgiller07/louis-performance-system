# ADR BETA-V2-TECH-01 — protection DH indépendante de la coupure, et accès bêta par affectation

**Statut** : **PRÊTE POUR APPROBATION** (contrat final).
- Revue finale HPM (2026-10-29) : T2 et B **approuvés sur le principe**. L'approbation formelle de cette ADR et du canon reste due par l'architecte et Louis.
- Implémentation locale sur `beta/v2-tech-01` (depuis `origin/main` `a0a8921`), sauf le contrôle des exemptions V1 (§ 2.3), qui est **proposé, non développé**.
- Le canon (`docs/05`) n'est **pas** modifié : les extraits du § 5 sont proposés.
- Aucun push, merge, migration, déploiement, changement d'interrupteur ni écriture de production.

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
- **Intégration avec PR2** : le scénario « production » de `v2DhRevocationDailyRun` ne reflète plus la production. Voir `INTEGRATION_PLAN.md`, S3 : décision de l'architecte.
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

### 2.3 Exemptions V1 : contrôle serveur minimal (option A développée localement, candidate)

**Ce qui est déjà garanti** :
- aucune exemption ne vient du navigateur (§ 2.1) ;
- aucune V1 implicite (403 sans ligne) ;
- refus sûr en cas d'erreur de lecture (503).

**Ce qui manque** : une ligne `v1` peut exister **sans motif** (`note` facultative) ni **auteur**. La liste des comptes exemptés n'est donc pas traçable.

**Option A (retenue pour la préparation de l'intégration, HPM 2026-10-29)** : une migration additive, sans changement de code. Développée localement : migration `20261027150000` (entre PR2 et SPORT), rollback, inventaire et contrôle en lecture seule, suite dédiée. Les lignes `v1` existantes ne reçoivent jamais d'auteur inventé : la contrainte reste `NOT VALID` tant qu'il en existe sans trace (`docs/review/v2-integration/INTEGRATION_RESULTS.md` § 5).

```sql
alter table public.training_plan_model_assignments
  add column decided_by text,
  add constraint training_plan_model_assignments_decided_by_length
    check (decided_by is null or (length(trim(decided_by)) > 0 and char_length(decided_by) <= 200)),
  add constraint training_plan_model_assignments_v1_exemption_traced
    check (planning_model <> 'v1' or (note is not null and decided_by is not null)) not valid;
alter table public.training_plan_model_assignments validate constraint training_plan_model_assignments_v1_exemption_traced;
```

- **Garantie** : toute exemption `v1` porte un motif (« compte de test : … ») et un auteur. `created_at` et `updated_at` existent déjà. Même forme que `dh_drill_revocations` (`reason`, `decided_by`).
- **Traçabilité** :
  - requête de suivi en lecture seule (`planning_model = 'v1'` : compte, motif, auteur, dates) ;
  - `rolloutReason: assigned_v1` sur chaque génération V1.
- **Ordre** :
  1. contrôle préalable en lecture seule (0 ligne `v1` sans motif ni auteur, sinon la migration échoue : fail-closed) ;
  2. migration ;
  3. écritures des affectations (GO Louis) ;
  4. déploiement de `generate-training-plan`.
- **Tests** :
  - `v1` sans `note` ou sans `decided_by` refusé (23514) ; `v1` complet accepté ; `v2` sans eux accepté ;
  - `anon` et `authenticated` toujours sans accès ;
  - table de résolution inchangée.
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
  - `v2` pour chaque pilote.
- **Intégration avec PR2** : `v2DhRevocationV1Http` doit recevoir une affectation `v1` (`INTEGRATION_PLAN.md`, S2).
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

## 5. Canon : extraits proposés (non appliqués)

**`docs/05_DATA_MODEL.md`, section `training_plan_model_assignments`** (à appliquer après le canon de PR2, qui insère sa section juste en dessous). Remplacer « Aucune ligne créée par la migration : table vide → tout le monde en V1. Résolution : interrupteur inactif → V1, … ; actif sans ligne → V1 ; `v1` → V1 ; `v2` → V2. » par :

> Aucune ligne créée par la migration : table vide → aucune génération possible. Résolution (BETA-V2-TECH-01 B) : l'affectation est l'autorisation de générer.
> - Sans ligne : refus 403 `beta_access_not_granted`, quel que soit l'interrupteur, rien n'est écrit (jamais V1 par défaut).
> - `v1` : V1, quel que soit l'interrupteur. Exemption explicite réservée aux comptes de test, avec motif (`note`) et auteur (`decided_by`) obligatoires (contrainte `training_plan_model_assignments_v1_exemption_traced`, si l'option A est retenue).
> - `v2` : V2 si l'interrupteur est actif, sinon refus 503 `v2_generation_disabled` (A09).
> - Affectation illisible ou invalide : refus 503 `beta_access_check_unavailable`, rien n'est écrit.
>
> Aucune conversion entre V1 et V2.

**Même section, colonnes** (option A) : ajouter `decided_by` (texte, 1 à 200 caractères, obligatoire pour `v1`).

**Table des interrupteurs serveur V2**, ligne `NALYNT_V2_PLAN_GENERATION_ENABLED`, colonne « Ouvre (ON) » :

> éligibilité V2 des athlètes affectés `v2` (`training_plan_model_assignments`) ; **ne commande aucune protection** : l'exigence d'unité DH du quotidien est permanente pour tout document V2 (BETA-V2-TECH-01 T2)

**`docs/11_DECISION_LOG.md`** : une entrée ADR, une fois approuvée.
