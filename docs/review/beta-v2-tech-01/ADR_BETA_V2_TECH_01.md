# ADR BETA-V2-TECH-01 — protection DH indépendante de la coupure, et accès bêta par affectation

**Statut** : **PROPOSÉE**. Elle attend l'approbation de l'architecte (HPM) et de Louis avant intégration.
- Implémentation locale sur `beta/v2-tech-01` (depuis `origin/main` `a0a8921`, indépendante de PR2 et de SPORT).
- Aucun push, merge, migration, déploiement ni activation V2.
- Le canon (`docs/05`) n'est **pas** modifié : les extraits du § 4 sont proposés.

## 1. T2 — l'exigence d'unité DH ne dépend plus de l'interrupteur de génération

### Contexte

- Le quotidien exigeait une unité DH signée **exactement tant que** `NALYNT_V2_PLAN_GENERATION_ENABLED` valait `"true"` (`dhUnitRequirementFromEnv`).
- Couper la génération (la coupure d'urgence) **levait donc la protection** des programmes V2 déjà acceptés : un compte DH sans unité (`pass` historique) redevenait exécutable.

### Options examinées

| Option | Principe | Pour | Contre |
|---|---|---|---|
| A. Secret de protection dédié (`NALYNT_V2_DH_PROTECTION`) | l'exigence vaut si la génération **ou** la protection est ON | réversible par configuration | un secret peut encore lever une protection de sécurité ; oubli possible au lancement |
| **B. Exigence permanente** (retenue, candidate) | le quotidien exige **toujours** l'unité pour un document V2 | aucun réglage ne peut la lever ; plus simple | un programme V2 accepté sans unité voit ses jours DH refusés, ON comme OFF |

### Décision proposée (option B)

- `DAILY_DH_UNIT_REQUIREMENT = { dhUnit: "required" }`, constante gelée, passée à **chaque** exécution de `daily-run`.
- L'interrupteur ne commande plus que l'autorisation de **nouveaux** programmes V2.
- Les documents V1 ne sont pas concernés : l'exigence n'est lue que par la réconciliation V2.

### Conséquences

- **Production**, au déploiement :
  - tout programme V2 accepté sans unité signée (aujourd'hui, le compte de test V2) a ses jours DH bloqués (`dh_repetition_unit_unknown`), ses autres jours servis ;
  - c'est voulu (fail-closed) : ce compte doit de toute façon être régénéré.
- **Bibliothèque** : `runDailyFor` garde son défaut (sans exigence) pour les appelants Node existants. **La fonction Edge `daily-run` est le seul point d'entrée de production, et elle impose la constante.**
- **Tests** :
  - cinq suites qui mènent des séances DH par le runtime Edge en V2 OFF (`a5P0Hardening`, `int01DebriefHealthGuard`, `p0_3HealthSuspendedExecution`, `p0_3ManualSessions` partie Edge, `p0_4HistoryRepro`) généraient leurs programmes sans unité : 15 tests échouaient (jour DH `blocked`) ;
  - elles génèrent désormais avec le bundle signé « test » du runtime et tournent dans la partition V2 ON signée « test » ;
  - leurs assertions sont inchangées.
- **Retour arrière** : revenir sur le commit. Aucune donnée à reprendre.

### Preuves

- **Unitaires** : la constante ne lit aucun secret (aucun `import`) ; `daily-run` lui passe la constante et ne dérive rien de l'interrupteur.
- **HTTP**, runtimes `off` et `on_unsigned` : programme V2 sans unité, jour DH bloqué sans prescription finale, jour de Force servi ; rider V1 non concerné.
- **Contre-preuve** : avec l'ancien code T2, le même test échoue en `off` : le jour DH est servi.

## 2. B — l'affectation serveur est l'autorisation de générer

### Décision proposée

| Affectation (`training_plan_model_assignments`) | Interrupteur V2 | Résultat |
|---|---|---|
| `v2` | ON | programme V2 |
| `v2` | OFF | refus **503** `v2_generation_disabled` (A09, inchangé) |
| `v1` | ON ou OFF | programme V1 : **exemption explicite, réservée aux comptes de test** |
| aucune | ON ou OFF | refus **403** `beta_access_not_granted`, rien n'est écrit : **jamais V1 par défaut** |
| illisible ou invalide | ON ou OFF | refus **503** `beta_access_check_unavailable`, rien n'est écrit |

- **Aucune conversion** entre V1 et V2, dans un sens comme dans l'autre.
- **La requête ne choisit jamais le modèle** : toute clé inconnue → 400.
- **Le client ne lit ni n'écrit aucune affectation** (`service_role` seulement, inchangé).
- **Traces** : événement pilote `plan_generation_blocked` avec `beta_access_not_granted` et `rolloutReason: not_assigned`, sans modèle.
- **Web** : messages pour les deux nouveaux codes, l'un non réessayable (« accès à la bêta pas encore activé »), l'autre réessayable.

### Conséquences

- **Tout compte de production sans affectation** est refusé à sa **prochaine génération**. Ses programmes actuels continuent au quotidien.
- **Avant le déploiement** : écrire une affectation `v1` explicite (avec `note`) pour chaque compte de test qui doit garder V1, et `v2` pour chaque pilote. **Ce sont des écritures de production : GO de Louis requis.**
- **« Réservée aux comptes de test »** est une règle d'exploitation : le schéma ne distingue pas un compte de test. Voir les décisions restantes.
- **Les inscriptions publiques ne sont pas touchées** (couche A du ticket). Un non-invité peut s'inscrire, mais ne peut pas générer.

### Preuves

- **Unitaires** : table de résolution (6 cas) ; aiguillage (refus sans aucun appel de génération, exemption V1 dans les deux états, erreur de lecture) ; correspondance d'erreur Edge (503) ; messages web.
- **HTTP** sur la fonction Edge, runtimes `off`, `on_unsigned` et `on_test_signed` :
  - sans affectation, 403 ;
  - un rider qui tente de s'accorder l'accès : écriture refusée (42501), clés forgées refusées (400), toujours 403 ;
  - `v1` : programme V1 ;
  - `v2` : 503, 422 ou programme V2 selon le runtime ;
  - affectation illisible : 503, rien d'écrit.
- **Tests existants adaptés** : les riders V1 de test reçoivent une exemption `v1` explicite ; la répétition HTTP du déploiement ajoute un rider sans affectation.

## 3. T1 — partition V2 ON

- `p0_3KeptDayRerun` générait son premier programme en Node, sans unité et avec la table de signatures réelle, qui est vide. Le runtime V2 ON (bundle signé « test ») bloquait donc la journée.
- Ce programme est désormais généré par **le bundle même que sert le runtime** (`generateTrainingPlanForAthlete` : affectation, interrupteur ON, `dhUnit: "required"`), refusé si la marque de test manque.
- Aucune signature n'est inventée ; le moteur n'est pas modifié.
- **Changement de test, pas de canon.** Les trois suites qui exigent V2 ON ne tournent plus que dans la partition V2 ON, au lieu d'échouer en 503 dans la partition OFF.

## 4. Canon : extraits proposés (non appliqués)

**`docs/05_DATA_MODEL.md`, section `training_plan_model_assignments`.** Remplacer la phrase « Résolution : interrupteur inactif → V1, sauf athlète affecté `v2` … ; actif sans ligne → V1 ; `v1` → V1 ; `v2` → V2. » par :

> Résolution (BETA-V2-TECH-01 B) : l'affectation est l'autorisation de générer.
> - Sans ligne : refus 403 `beta_access_not_granted`, quel que soit l'interrupteur, rien n'est écrit (jamais V1 par défaut).
> - `v1` : V1, quel que soit l'interrupteur (exemption explicite, comptes de test).
> - `v2` : V2 si l'interrupteur est actif, sinon refus 503 `v2_generation_disabled` (A09).
> - Affectation illisible ou invalide : refus 503 `beta_access_check_unavailable`, rien n'est écrit.
>
> Aucune conversion entre V1 et V2.

**Même section** : remplacer « table vide → tout le monde en V1 » par « table vide → aucune génération possible ».

**`docs/05_DATA_MODEL.md`, table des interrupteurs serveur V2**, ligne `NALYNT_V2_PLAN_GENERATION_ENABLED`, colonne « Ouvre (ON) » :

> éligibilité V2 des athlètes affectés `v2` (`training_plan_model_assignments`) ; **ne commande aucune protection** : l'exigence d'unité DH du quotidien est permanente pour tout document V2 (BETA-V2-TECH-01 T2)

**`docs/11_DECISION_LOG.md`** : une entrée ADR, une fois approuvée.

## 5. Hors de cette ADR

- T4 : suspension générale (conception séparée, `T4_SUSPENSION_DESIGN.md`).
- Fermeture des inscriptions publiques (couche A).
- Les affectations de production.
