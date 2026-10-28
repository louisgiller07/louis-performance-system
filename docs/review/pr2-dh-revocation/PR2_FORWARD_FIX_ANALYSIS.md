# PR2-DH-REVOCATION — correction en avant après une révocation (analyse, HPM 2026-10-28)

**Question.** La correction en avant prévue (« retirer l'exercice des signatures côté code, puis redéployer ») suffit-elle à rétablir le service sans réautoriser l'exercice révoqué ?

**Réponse : non.** En production, elle ne change rien : les tables de signatures sont vides. Ailleurs, elle maintient le refus mais ne rétablit pas la décision du jour. Le refus fail-closed reste sûr ; c'est le rétablissement du service qui n'est pas démontré, et aucun mécanisme existant ne le démontre aujourd'hui.

Aucune révocation n'a été exécutée, en production ni ailleurs, pour cette analyse : elle repose sur le code de la branche et sur les preuves S4 déjà validées.

## Ce que contrôlent les signatures

- **Les signatures ne contrôlent que l'unité DH** (le comptage, par exemple `SECTION`), jamais la présence d'un exercice dans une prescription (`planning-engine/src/sessionModelV2/dhSportGateV2.ts`, en-tête et `dhRepetitionUnitAttributionV2`).
- **En production, les tables de signatures sont vides** : `DH_SPORT_SIGNOFFS_V2 = {}` (`planning-engine/src/catalog/dhRepetitionUnitCatalogV2.ts:51`), et `verify:sport-approvals` compte 0 exercice signé. Retirer l'exercice des signatures n'y change donc rien.
- **Les exercices sont choisis dans le catalogue** `SESSION_DRILL_CATALOG_V2`, que la correction ne modifie pas :
  - la sélection est déterministe : `selectDhDrill` (`builders/dhPrescriptionV2.ts:198`) donne le même exercice pour une compétence, un niveau et des terrains donnés ;
  - le validateur n'exige que la présence de l'exercice dans ce catalogue (`unknown_drill`, `validatePrescriptionV2.ts:265`).

## Les quatre cas demandés (V2 OFF, après la correction prévue)

| Cas | Ce qui se passe | Service rétabli ? |
|---|---|---|
| **Rider avec un programme V2 enregistré** | Le chemin quotidien suit la version de plan courante, V2, quel que soit l'interrupteur (`docs/05`, « Chemin quotidien V1 / V2 »). Le rider ne peut pas régénérer : affecté `v2` avec V2 OFF, il est refusé (503 `v2_generation_disabled`, garde A09, `planningModelRollout.ts:49`). Son programme reste en place. | Non |
| **Prescription future contenant l'exercice** | Elle reste stockée telle quelle. Son jour venu, un KEEP la copie mot pour mot (`buildKeepFinalPrescriptionV2.ts:197`). Un MODIFY reprend ses exercices. Un REPLACE ou une séance manuelle DH resélectionne le même exercice. Résultat : `NX302`, puis 409, et rien n'est écrit. Le refus revient à chaque jour concerné, jusqu'à la fin du programme. | Non |
| **Décision du jour déjà enregistrée** | Elle reste la décision courante (ajout seul ; seule une décision plus récente la remplace). Son exécution est refusée (`dh_validation_not_current`). Un nouveau daily-run ce jour-là est refusé pour la même raison. Le rider voit : « La séance technique prévue aujourd'hui n'est plus validée : aucune séance n'est proposée pour aujourd'hui. » (`web/src/features/dailyPlan/dailyRunErrors.ts:46`) | Non pour ce jour |
| **V2 OFF en général** | Aucun effet de l'interrupteur sur les plans déjà persistés. Les jours REST, Force ou sans l'exercice sont servis normalement. | Partiel : seuls les jours sans l'exercice |

**Preuve exécutée.** S4 (`v2DhRevocationDailyRun.integration.test.ts:225`), rider « production » aux tables de signatures vides, c'est-à-dire l'état exact qu'atteint la correction prévue en production :
- après la révocation, KEEP, MODIFY, REPLACE et manuel sont refusés, rien n'est écrit, jamais un REST ;
- la décision antérieure du jour reste et son exécution est refusée ;
- Force, REST et V1 ne sont pas touchés.

Résultat : 4/4.

**Sous V2 ON**, une prescription enregistrée avec une unité dont la signature a été retirée lève `DhSportValidationNotCurrentError`, qui donne aussi un 409 (`trustedPlannedStructure`). Le résultat est le même : refus, pas de rétablissement.

## Limites du périmètre de la révocation (constatées dans le code)

- **V1 prescrit les mêmes exercices.**
  - Le catalogue V1 (`planning-engine/src/catalog/drillCatalog.ts`, 21 exercices) partage ses 21 identifiants avec le catalogue V2 (22 exercices, seul `cornering_advanced_line_exit` est propre à V2).
  - La génération V1 prescrit des exercices DH : `generationEngine.ts`, domaine `dh_technical`, `prescriptionEngine`, puis `selectDrill` (`prescription-engine/src/dh/drillSelection.ts:42`). La sélection est déterministe : le premier exercice compatible compétence × niveau × terrain.
  - Le chemin V1 ne lit jamais `dh_drill_revocations`. **Une révocation ne protège donc pas les riders V1** dont le programme prescrit le même exercice.
  - Le catalogue V1 a un drapeau `deprecated` qui exclut l'exercice des nouvelles générations V1, mais pas des programmes V1 déjà enregistrés. Aucun exercice n'est marqué aujourd'hui.
- **Affichage.** La page Plan lit et décode les prescriptions V2 prévues (`web/src/features/trainingPlanReview/trainingPlanReviewRepo.ts:205`). L'exercice révoqué reste visible dans le programme. La révocation n'empêche que l'écriture de la prescription du jour et l'exécution guidée.

## Mécanismes : ce qui protège et ce qui rétablit

Aucun n'est implémenté par la PR2.

| Mécanisme | Effet | Statut |
|---|---|---|
| **Suspension contrôlée** (comportement livré par la PR2) | Les entraînements contenant l'exercice sont refusés jour par jour (fail-closed), sans décision ce jour-là ; les autres jours sont servis. À compléter par une information du rider par l'opérateur. | **Seule procédure sûre aujourd'hui**, jusqu'à la correction. Protection seulement, pas de rétablissement. |
| **B. Basculement V2 → V1 du rider** | 1. Un opérateur passe l'affectation du rider à `v1`. 2. Le rider génère et accepte un programme V1. 3. Le chemin V1 n'atteint jamais la révocation. | **Pas une procédure sûre.** Le programme V1 peut réintroduire le même exercice (mêmes identifiants, sélection déterministe), sans que la révocation s'applique. Il ne pourrait être qualifié de sûr qu'après une démonstration : l'exercice exclu de la génération V1 (`deprecated`, décision sportive et déploiement), puis la preuve que le programme V1 du rider ne le contient pas. S'y ajoutent l'écriture en production (accord distinct) et la sortie de la bêta V2 (décision produit, garde A09). |
| **C. V2-DH-WITHDRAWAL (neutralisation côté code, à concevoir)** | Une liste d'exercices retirés, lue par le chemin quotidien V2, les builders, la génération et l'affichage. Une prescription enregistrée qui en contient un donne `blocked` avec un code dédié : la décision du jour est écrite, mais rien n'est exécutable. Les builders ne choisissent plus l'exercice. | `blocked` est **une protection, pas une restauration** : la séance concernée reste perdue. Il faut aussi un **remplacement ou une replanification sûre** des séances neutralisées, sans réécrire l'historique. Par exemple, une alternative validée sportivement pour la même compétence, ou une replanification des jours futurs par les builders, l'exercice étant exclu. À concevoir par ADR, avec décisions sportives. Doit aussi couvrir V1 (`deprecated` et programmes V1 enregistrés) et l'affichage. Ne pas développer maintenant. |
| **A. Retrait de l'exercice du catalogue** | Les prescriptions enregistrées qui le contiennent donnent `blocked` / `final_prescription_catalog_mismatch`. | Décision sportive, changement de version d'agrégat, tout MODIFY de document antérieur `blocked` (§9), lecteur web limité aux manifestes `v2.5` et `v2.6`. Le plus lourd ; même limite que C (protection, pas restauration). |

Ce qui n'est **jamais** acceptable : supprimer la révocation (impossible, la table est en ajout seul), lancer le rollback (refusé dès qu'une révocation existe), ou réécrire des prescriptions ou des décisions historiques.

## Recommandation

1. **Merge de la PR2** : non bloqué. Le comportement est fail-closed et sûr. Il faut seulement que le canon dise vrai, ce que font les diffs corrigés : le retrait des signatures ne rétablit pas le service, et la révocation ne couvre que V2.
2. **Avant la première révocation réelle**, une décision HPM sur :
   - la procédure de suspension contrôlée et l'information du ou des riders V2 concernés ;
   - le traitement des riders V1 dont le programme prescrit le même exercice (hors du périmètre de la PR2).

   Le basculement V2 → V1 n'est pas une procédure sûre tant que la démonstration ci-dessus n'est pas faite.
3. **Avant l'activation de V2** : V2-DH-WITHDRAWAL (item P0), c'est-à-dire neutralisation, puis remplacement ou replanification sûre, couverture de V1 et de l'affichage.
