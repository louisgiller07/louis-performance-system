# BETA-V2-TECH-01 — prérequis techniques de la bêta V2 (rapport local)

**Statut : STOP pour revue HPM et Louis.**
- Branche locale `beta/v2-tech-01`, partie de `origin/main` (`a0a8921`) : indépendante de PR2 (aucun fichier commun) et de SPORT (un fichier de test commun, `a5P0Hardening`).
- Aucun push, merge, migration, déploiement, écriture de production, fausse signature sportive ni activation V2.
- Piles : uniquement la pile jetable `nalynt-dhunit01`, **par le garde-fou** (installé hors dépôt, liste blanche limitée à cette pile, arrêt toujours par `--project-id`).

## 1. Livrables

| # | Livrable | Où |
|---|---|---|
| 1 | Tests V2 ON au vert, avec preuves | § 2 |
| 2 | Correction T2 et tests de non-contournement | commit `294bf94`, § 2 et 3 |
| 3 | Règle d'accès bêta fonctionnelle localement | commit `efeb28f`, § 2 et 3 |
| 4 | ADR à faire approuver | `ADR_BETA_V2_TECH_01.md` |
| 5 | Décisions restantes avant intégration | § 4 |
| — | T4, conception seulement (non développée) | `T4_SUSPENSION_DESIGN.md` |

**Commits** :
- `8d93e99` (T1) ;
- `294bf94` (T2) ;
- `efeb28f` (B) ;
- `8b2161f` : suites adaptées à T2.

## 2. Résultats (pile jetable, fonctions Edge servies)

| Partition | Runtime | Résultat |
|---|---|---|
| **V2 ON, signatures de test** | interrupteur ON, bundles reconstruits avec les signatures TEST, puis bundles réels restaurés à l'identique (garde de bundle 7/7) | **58/58**, 4 ignorés (tests propres à un autre runtime) ; `p0_3KeptDayRerun` **2/2** (les deux échecs T1 sont corrigés) |
| **V2 ON, bundles réels** (rien de signé) | interrupteur ON | **8/8**, 4 ignorés |
| **Contre-preuve T2** | ancien code T2 (`8d93e99`), interrupteur OFF | le test T2 **échoue** comme attendu : jour DH sans unité servi `created` |
| **Web, intégration** | OFF | **75/75** (14 fichiers) |
| **Suite complète V2 OFF**, 153 fichiers, 1 323 tests | OFF | voir ci-dessous |

**Détail de la suite complète V2 OFF** :
- **Premier passage** : 15 échecs, tous dans des suites qui menaient des séances DH sur des programmes V2 générés **sans unité**. C'est l'effet voulu de T2. Ces suites génèrent désormais avec le bundle signé « test » et tournent dans la partition signée, assertions inchangées (`8b2161f`).
- **Passage suivant** : 1 218 réussis, **0 échec**, mais **2 workers vitest morts**. Il n'est donc pas déclaré réussi.
- **Passage d'après** : 1 252 réussis, **2 échecs** dans `v2DhSportGate01c`, sans worker mort.
  - Le runtime a rechargé `session-execution` sur de fausses détections d'écriture : sources inchangées, dates de modification identiques.
  - Isolé, le fichier passe **3 fois sur 3** (7/7).
- **Troisième passage** : 1 248 réussis, **0 échec**, mais **1 worker mort** (6 tests de `phys04MobilityBodyweight` sans résultat) : il n'est pas déclaré réussi non plus.

**Bilan des trois passages** : sur 1 323 tests, **les 1 254 tests non ignorés ont tous réussi dans au moins un passage** ; les 69 autres sont ignorés partout (réservés à d'autres partitions). Aucun échec déterministe.

**Réserve** : aucun passage complet n'est sorti sans incident de l'environnement local (workers vitest, rechargement du runtime). La CI devra le confirmer.

**Unitaires et build** : `head-coach-engine` 1 107 réussis (716 ignorés : intégration), Edge 67/67, `planning-engine` 1 163 réussis, web 2 497 réussis ; build web OK ; typecheck identique aux bases (`head-coach-engine` 28 erreurs, web 38), 0 nouvelle erreur.

## 3. Ce qui est prouvé

**T1** :
- le premier programme du test de jour conservé est généré par le bundle même du runtime, refusé si la marque de test manque ;
- aucune signature n'est inventée et le moteur n'est pas modifié.

**T2** :
- l'exigence d'unité DH du quotidien est une constante qui ne lit aucun secret (test unitaire) ;
- sur HTTP, en `off` comme en `on_unsigned` : un programme V2 accepté sans unité a son jour DH **bloqué** (`dh_repetition_unit_unknown`, aucune prescription finale) et son jour de Force servi ; un rider V1 n'est pas concerné ;
- contre-preuve faite sur l'ancien code.

**B**, sur HTTP, sur la fonction Edge, dans les trois runtimes :
- sans affectation : 403 `beta_access_not_granted`, rien d'écrit, trace `not_assigned` sans modèle ;
- un rider ne peut pas s'accorder l'accès : écriture refusée (42501), clés forgées refusées (400), toujours 403 ;
- `v1` : programme V1 ;
- `v2` : 503 en OFF, 422 `dh_repetition_unit_unknown` en ON non signé, programme V2 en ON signé « test » ;
- affectation illisible (droit retiré **sur la pile jetable seulement**, puis remis) : 503 `beta_access_check_unavailable`, rien d'écrit.

## 4. Décisions restantes avant intégration

1. **ADR** (architecte et Louis) :
   - T2 : option B, exigence permanente ; ou option A, secret de protection dédié ;
   - règle B ;
   - extraits `docs/05`.
2. **« V1 réservée aux comptes de test »** : règle d'exploitation seule, ou contrainte (note obligatoire sur toute affectation `v1`, ou marqueur de compte de test), à arbitrer.
3. **Écritures de production avant déploiement**, GO de Louis à chaque fois :
   - affectations `v1` explicites pour les comptes de test qui gardent V1 ;
   - `v2` pour les pilotes ;
   - régénération du programme V2 du compte de test (ses jours DH seront bloqués par T2).
4. **Ordre d'intégration** :
   - PR2 et cette branche ne partagent aucun fichier ;
   - SPORT partage `a5P0Hardening`, et ses tests ajoutés qui génèrent en Node devront passer par la génération signée.
5. **Déploiement**, GO distincts : `daily-run`, `generate-training-plan`, web (messages).
6. **T4** : granularité, valeur invalide, message, terme `suspended_by_nalynt` ; puis GO de développement avant toute invitation externe.
7. **Inscriptions publiques** (couche A) : non touchées, décision séparée.
