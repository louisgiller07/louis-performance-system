# PR2-DH-REVOCATION — correction en avant après une révocation (analyse, HPM 2026-10-28)

**Question.** La correction en avant prévue (« retirer l'exercice des signatures côté code, puis redéployer ») suffit-elle à rétablir le service sans réautoriser l'exercice révoqué ?

**Réponse : non.** En production, elle ne change rien : les tables de signatures sont vides. Ailleurs, elle maintient le refus mais ne rétablit pas la décision du jour. Le refus fail-closed reste sûr ; c'est le rétablissement du service qui n'est pas démontré.

Aucune révocation n'a été exécutée, en production ni ailleurs, pour cette analyse : elle repose sur le code de `0c9f332` et sur les preuves S4 déjà validées.

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

Résultat : 4/4, sur la PR2 avant puis après la correction des droits.

**Sous V2 ON**, une prescription enregistrée avec une unité dont la signature a été retirée lève `DhSportValidationNotCurrentError`, qui donne aussi un 409 (`trustedPlannedStructure`). Le résultat est le même : refus, pas de rétablissement.

## Mécanismes qui retirent ou neutralisent sans réautoriser

Aucun n'est implémenté par la PR2.

| Mécanisme | Effet | Coût, limites |
|---|---|---|
| **B. Remplacement du programme du rider (données, aucun code)** | 1. Un opérateur passe l'affectation du rider à `v1` (`training_plan_model_assignments`). 2. Le rider génère un programme V1 et l'accepte. 3. La version courante devient V1, et le chemin quotidien, choisi par cette version, passe en V1, qui n'atteint jamais la révocation. L'historique V2 est conservé. Service complet rétabli dès l'acceptation. Établi par lecture du code, pas encore par un test : à prouver en local avant la première révocation. | Écriture en production : accord distinct. Décision produit : c'est une sortie explicite de la bêta V2, que la garde A09 interdit de faire en silence. Le rider doit agir lui-même (générer, accepter). Utilisable seulement tant que V2 est OFF, et rider par rider. |
| **C. Neutralisation côté code (à concevoir)** | Une liste d'exercices retirés, lue par le chemin quotidien V2 et par les builders. Une prescription enregistrée qui en contient un donne `blocked`, avec un code dédié : la décision du jour est écrite, mais rien n'est exécutable. Les builders ne choisissent plus l'exercice (alternative explicite ou blocage). | Nouvelle règle : ADR, `docs/04` et `docs/05` (nouveau code de blocage), tests, redéploiement de `daily-run` et `generate-training-plan`. Ni catalogue, ni version d'agrégat, ni lecteur web, ni historique ne changent. La révocation en base reste le filet transactionnel. |
| **A. Retrait de l'exercice du catalogue** | Les prescriptions enregistrées qui le contiennent ne passent plus la validation et donnent `blocked` / `final_prescription_catalog_mismatch` (décision écrite). Les builders ne le choisissent plus. | Décision sportive (catalogue). Changement de version d'agrégat obligatoire. Effets de bord : tout MODIFY d'un document antérieur devient `blocked` (§9) ; le lecteur web ne lit que les manifestes `v2.5` et `v2.6`, et l'historique contenant l'exercice doit rester lisible ; la sélection canonique compétence × niveau doit être réattribuée. Le plus lourd. |

Ce qui n'est **jamais** acceptable : supprimer la révocation (impossible, la table est en ajout seul), lancer le rollback (refusé dès qu'une révocation existe), ou réécrire des prescriptions ou des décisions historiques.

## Recommandation

1. **Merge de la PR2** : non bloqué. Le comportement est fail-closed et sûr. Il faut seulement que le canon dise vrai, ce que font les diffs corrigés : le retrait des signatures ne rétablit pas le service.
2. **Avant la première révocation réelle** : exiger un plan de rétablissement prêt. Aujourd'hui (V2 OFF, 1 rider V2 en production d'après l'inventaire PR1), c'est le mécanisme B, avec un accord distinct pour l'écriture de l'affectation, et une décision produit sur la sortie de la bêta V2.
3. **Avant l'activation de V2** : concevoir et livrer le mécanisme C, parce que B ne passe pas à l'échelle et n'existe plus une fois V2 ON. Nouvel item de backlog P0 proposé, « V2-DH-WITHDRAWAL ».
