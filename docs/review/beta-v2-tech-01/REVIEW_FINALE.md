# BETA-V2-TECH-01 — revue finale HPM : réponses (2026-10-29)

**Statut : STOP pour revue HPM et Louis.**
- Branche locale `beta/v2-tech-01`, sans branche distante.
- Aucun push, merge, migration distante, déploiement, changement d'interrupteur ni écriture en production.
- Campagnes : pile jetable `nalynt-dhunit01` uniquement, **par le garde-fou**.

## 1. Verdict V2 OFF (mission 1)

**Passage complet propre obtenu** : s18-2, pile neuve, aucun test ni aucune assertion modifiés.
- 1 254 réussis sur 1 254 non ignorés (69 ignorés : autres partitions) ;
- 0 échec, 0 test sans résultat, 0 erreur ;
- 0 worker mort, 0 rechargement du runtime ;
- code de sortie 0.

**Il ne s'obtient pas à coup sûr sur ce poste** : 2 passages sur 7 se terminent normalement le 29.10. Deux obstacles de l'environnement Windows sont isolés, sans échec d'assertion :
- **Morts de workers** : 5 passages sur 7. Le processus Node 24 est arrêté par le système (`0xC0000409`), sans exception, sans module natif chargé, sans trace Windows. Le module fautif ne peut être identifié qu'avec un vidage mémoire (GO de Louis : clé de registre machine temporaire).
- **Rechargements parasites du runtime Edge** (`functions serve`) : 2 passages sur 7, au premier chargement d'une fonction, sans aucun fichier modifié. Deux hypothèses testées et écartées (date d'accès NTFS, délai de 60 min après écriture). Origine probable : la couche de partage de fichiers Windows–conteneurs.

**Garde-fou de preuve** : un passage n'est retenu que s'il est sans rechargement et sans mort de worker. Les autres sont rejoués.

**Correction** : le rapport précédent annonçait une confirmation par la CI. Elle ne lance aucune suite d'intégration.

**Ma propre erreur de méthode** : quatre témoins (s14 R1/R2, s15 R3/R4) ont envoyé leur requête avant que le runtime servi soit monté. Ils sont invalides, écartés, et refaits correctement en s16.

Détail : `V2_OFF_STABILITY.md`.

## 2. Contrat final B et T2, prêt pour approbation (missions 2 et contrat)

`ADR_BETA_V2_TECH_01.md`, statut « prête pour approbation » :
- **T2** : l'exigence d'unité DH du quotidien est une constante, aucun interrupteur ne la lève. Contrat limité à ce que les tests prouvent : réponse 200, statut `blocked`, trace `dh_repetition_unit_unknown`, aucune prescription finale, M1 non touché.
- **B** : table de résolution ; le navigateur ne décide de rien ; jamais de V1 implicite ; 503 sûr en cas d'erreur de lecture ; messages web 403 (non réessayable) et 503.
- **Exemptions V1, contrôle minimal proposé (option A, non développé)** :
  - une migration additive : colonne `decided_by` et contrainte « `v1` exige un motif et un auteur » ;
  - aucun changement de code ;
  - options écartées : secret, marqueur « compte de test », règle seule.
- **Canon `docs/05`** : extraits exacts, non appliqués, à poser après le canon de PR2 (sections voisines).

## 3. Spécification minimale T4 (mission 3)

`T4_SUSPENSION_DESIGN.md`, **non développée** :
- **Cibles** : une version de programme ou une séance du programme, toutes familles.
- **Données** : une table `prescription_suspensions` (motif, auteur, date, levée unique). Ni suppression, ni modification hors levée.
- **Contrôles serveur** dans la transaction de l'écriture : `daily-run` (prescription bloquée, statut existant `blocked` / `prescription_suspended`, jamais `REST`), `session-execution` (séance ouverte comprise : seulement pause ou abandon), `completed-session`, `accept-training-plan`. Refus 503 si la lecture échoue.
- **Message au pilote**, audit, et 16 cas de test qui forment le contrat exécutable.

## 4. Plan d'intégration (mission 4)

`INTEGRATION_PLAN.md`. **Aucune fusion faite**, conflits calculés par `git merge-tree`.
- **Conflits textuels** : seulement `docs/00`, `docs/11`, `docs/12`, et les imports de `a5P0Hardening` (SPORT × BETA).
- **Conflits sémantiques**, que git ne signale pas :
  - S1 : le test SPORT fusionné ne compile plus (import retiré par BETA) ;
  - S2 : un test HTTP de PR2 génère en V1 sans affectation, donc 403 après B ;
  - S3 : le scénario « production » du test de révocation de PR2 n'est plus la production après T2 ;
  - S4 : les extraits `docs/05` de PR2 et de BETA sont voisins.
- **Migrations** : PR2 `20261027120000`, puis SPORT `20261028120000`. Aucun objet commun (validé en REVIEW 1).
- **Ordre recommandé** : PR2, puis BETA, puis SPORT. Tests à rejouer listés pour chaque étape.
- **La CI GitHub ne lance aucune suite d'intégration** : elle ne peut pas confirmer la suite V2 OFF.

## 5. Décisions nécessaires pour ouvrir les Draft PR

**Architecte et Louis** :
1. Approuver l'ADR BETA-V2-TECH-01 (T2, B) et ses extraits `docs/05`.
2. Exemptions V1 : option A (migration additive, à développer localement avant la PR) ou règle d'exploitation seule.
3. S3 : accepter que le rider « production » du test de révocation de PR2 tourne avec l'exigence d'unité, ses jours DH sans unité devenant `blocked`.
4. Ordre d'intégration : PR2, BETA, SPORT (recommandé), ou BETA avant PR2.
5. Canon de PR2 (réserve R1) : préalable à sa fusion, donc à l'empilement.
6. Preuve V2 OFF : accepter la preuve locale avec l'obstacle Windows documenté, ou exiger une preuve hors de ce poste (WSL, ou job CI avec pile : nouvelle infrastructure).

**Louis seul** :

7. Autoriser les push : branche BETA en Draft PR, et les 5 commits locaux de PR2. SPORT peut rester locale jusqu'aux signatures.
8. Diagnostic de la mort des workers, si voulu : vidage mémoire Windows (clé de registre machine, temporaire) ou passage avec les piles protégées arrêtées.

**Pas nécessaires pour ouvrir les Draft PR**, mais avant le déploiement ou les invitations externes :
- écritures de production (affectations, régénération du compte de test V2) ;
- déploiements ;
- décisions T4 et GO de son développement ;
- inscriptions publiques.
