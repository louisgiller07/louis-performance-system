# V2_PHYS_INTEGRATION_01_REPORT — PHYS intégré localement, tous les flags OFF = production

**Date** : 2026-10-18 · **Pour** : HPM et Louis · **Statut** : local uniquement.

Rien n'a été touché hors du poste local :
- aucun push, aucune migration installée, aucun déploiement ;
- aucun flag activé ;
- aucune opération en production.

**Verdict : READY LOCAL** pour une release flags OFF. **L'activation de PHYS reste BLOCKED** (§ 7) : garde POWER, canon `docs/03` §10, validation sportive.

**Candidat local** : branche `int/v2-phys-integration-01`, depuis `863f3fb` ; SHA dans le message du commit final (§ 8).

## 1. Commits intégrés et conflits

- **Fusion `--no-ff`** de `91bb721` (`dab1f4d`). Les sept commits gardent leurs SHA :
  - `5ec0976` phys-01, `5466df3` phys-01.1 ;
  - `869d3c6` phys-02, `71007c7` phys-02.1, `433a5fe` phys-02.1 fix ;
  - `1bf0295` phys-03 ;
  - `91bb721` phys-04.
- **Un seul conflit** : `docs/11_DECISION_LOG.md`, où les deux côtés ajoutaient des ADR en fin de fichier. Résolu en gardant tout, dans l'ordre chronologique : ADR PHYS du 15, puis CONSISTENCY-01, CONSISTENCY-02 et PARTIAL-01.
- **Vérifié fichier par fichier** : chaque fichier changé par PHYS est identique à `91bb721`, chaque fichier changé par `main` depuis la base est identique à `863f3fb`. La fusion est l'union exacte.
- **Inchangés** :
  - aucune migration d'un côté ni de l'autre ;
  - dossiers gelés de M1 non touchés ;
  - prescription-engine et longitudinal-engine non touchés ;
  - CONSISTENCY-01/02, PARTIAL-01 et P0-SAFE intacts (aucun fichier commun).

## 2. Fichiers modifiés (en plus de la fusion)

**Code produit** : 7 fichiers modifiés, 2 nouveaux, soit environ 130 lignes.

| Fichier | Changement |
|---|---|
| `planning-engine/src/sessionModelV2/final/physSwitchesV2.ts` (nouveau) | type `PhysSwitchesV2`, `PHYS_SWITCHES_OFF_V2` |
| `planning-engine/.../final/buildFinalPrescriptionV2.ts` | entrée `phys` ; séance manuelle ou REPLACE POWER / AEROBIC_INTERVALS / MOBILITY seulement avec son interrupteur ; pré-contrôle des intervalles manuels idem |
| `planning-engine/.../final/todayTimeLimitV2.ts` | quotidien OFF : Force sous A10 en LIGHT et durée décidée (comme en production) ; minimum d'endurance hors grille seulement pour des intervalles |
| `planning-engine/.../daily.ts`, `index.ts` | exports |
| `head-coach-engine/src/supabase/dailyV2/physDailySwitches.ts` (nouveau) | lecture des secrets (`"true"` exact), noms des deux nouveaux secrets |
| `head-coach-engine/.../dailyV2/reconcileFinalPrescriptionV2.ts` | quotidien OFF : pas de `dailyMintId` (retour au calme), aucune lecture ni écriture de guidage ; guidage de charge et de répétitions derrière le flag de performance |
| `head-coach-engine/src/supabase/runDailyFor.ts` | dépendance `physSwitches` (absente = OFF), transmise à la réconciliation |
| `supabase/functions/daily-run/index.ts` | interrupteurs lus dans les secrets Edge, à chaque requête |

**Tests**

| Fichier | Changement |
|---|---|
| `planning-engine/tests/unit/a10TodayTime.test.ts`, `p0_3ManualFinalPrescription.test.ts` ; `head-coach-engine/tests/supabase/a10TodayTime.integration.test.ts`, `v2DailyIntegration.integration.test.ts` | **versions de production restaurées à l'identique** (diff vide avec `863f3fb`) |
| `*.physDaily.*`, `p0_3ManualFinalPrescription.phys.test.ts` | variantes PHYS, interrupteurs ON |
| `phys00FlagsOffEquivalence.test.ts` (nouveau) | différentiel contre le runtime compilé de `863f3fb` |
| `physSwitches.integration.test.ts`, `physDailySwitches.test.ts` (nouveaux) | base réelle et lecteur de secrets |
| tests PHYS existants (unitaires et intégration) | interrupteurs ON explicites ; contre-preuves OFF sur REPLACE ; assertions de guidage conditionnées à la configuration Edge servie |
| `v2CatalogBoundaries.test.ts` | ajout du nouveau fichier `physSwitchesV2.ts` à la liste du dossier `final` |
| `web/.../guidedRealisation.test.ts` | PARTIAL-01 sur une séance POWER |

**Docs**
- ADR V2-PHYS-INTEGRATION-01 (`docs/11`), backlog, statut.
- `POWER_GUARD_01_PROPOSAL.md`, `PERFORMANCE_GUIDANCE_CANON_NOTE.md`, ce rapport.
- Non modifiés (gouvernance) : `docs/03`, `04`, `05`, `10`. Diffs proposés au § 5.

## 3. Stratégie de flags

Tous les secrets sont lus côté serveur uniquement. Seule la valeur exacte `"true"` active. **Absent = OFF = production.**

| Secret | Où | Ouvre |
|---|---|---|
| `NALYNT_V2_PHYS_DAILY_ENABLED` (nouveau) | `daily-run` | retour au calme de Force, Force sous A10 à dose égale (PHYS-01.1) ; guidage d'endurance (PHYS-02) |
| `NALYNT_V2_PHYS_PERFORMANCE_GUIDANCE_ENABLED` (nouveau, n'agit qu'avec le précédent) | `daily-run` | guidage de charge (PHYS-01) et de répétitions (PHYS-04) : **ne pas activer** (`docs/03` §10) |
| `NALYNT_V2_ENDURANCE_INTERVALS_ENABLED` | `generate-training-plan` + `daily-run` | placement des intervalles ; séance manuelle et REPLACE d'intervalles |
| `NALYNT_V2_POWER_ENABLED` | idem | placement de POWER ; manuel et REPLACE. **Seulement après POWER-GUARD-01** |
| `NALYNT_V2_MOBILITY_ENABLED` | idem | placement de la mobilité ; manuel et REPLACE |

**Choix d'interprétation à valider**
1. **Deux secrets pour A1–A5 au lieu d'un.** Le flag général du HPM, `NALYNT_V2_PHYS_DAILY_ENABLED`, couvre A1, A2 et A4. A3 et A5 (progression sur la performance réelle) ont un second verrou. Ainsi, activer le retour au calme n'active jamais un guidage interdit par le canon (consigne E).
   - Les noms suivent la convention existante (`NALYNT_V2_*_ENABLED`, `"true"` exact) ; aucune collision.
2. **Un même secret par famille**, pour la génération et pour les séances manuelles ou REPLACE : une seule bascule ouvre ou ferme la famille partout.
3. **OFF ne retire rien de ce qui est accepté.** Une séance POWER, intervalles ou mobilité déjà présente dans le programme accepté reste servie : KEEP, A10, maintien en cas de fatigue, repli LIGHT. Seules les nouvelles entrées se ferment (scénario D). Sinon, éteindre un flag casserait un programme en cours.

## 4. Résultats des tests

**Pile locale identique à la production** : 75 migrations, fonctions Edge servies depuis le candidat.

| Suite | Résultat |
|---|---|
| planning-engine (unitaires + différentiel) | **1038/1038** (51 fichiers). `v2CatalogBoundaries` 9/9 au rejeu, après des dépassements de délai sous charge |
| — dont différentiel OFF contre `863f3fb` | 73 profils de plan identiques ; **47 970** cas quotidiens planifiés (KEEP, MODIFY, REPLACE vers 16 cibles, 6 limites de temps) identiques, dont 27 474 documents et 20 496 refus ; **11 088** cas manuels identiques ; contre-épreuve ON : différences trouvées |
| head-coach-engine, Edge OFF, avec la compatibilité de retour arrière contre `863f3fb` | **163 fichiers, 1576 tests, tous verts** : 152 fichiers verts au premier passage, les 11 autres 188/188 au rejeu (voir la note ci-dessous) |
| head-coach-engine, tests Edge PHYS, Edge OFF (`SERVED=false`) | 6/6, plus PHYS-01 via l'Edge : aucun guidage persisté |
| head-coach-engine, tests Edge PHYS, Edge ON (tous les secrets `"true"`) | **7/7** |
| head-coach-engine, `physSwitches` (base réelle) | 4/4 : A production = candidat sur les mêmes jours ; B quotidien OFF / ON / performance ; C manuel OFF → ON → OFF ; D programme POWER accepté, flag OFF |
| head-coach-engine, lecteur de secrets | 12/12 |
| web (unitaires + intégrations, Edge OFF) | **2371/2371** (176 fichiers) |
| TypeScript | planning 0 erreur (= production) ; head-coach mêmes 27 erreurs préexistantes qu'en `863f3fb` (tests et CLI, liste comparée) ; web build OK, mêmes 17 fichiers de test qu'en `863f3fb` |
| Build | `build:release:all` OK ; web OK |
| Lint web | code 0 ; +4 avertissements `only-export-components` dans `MobilitySessionModule.tsx` (code PHYS-04 inchangé) |
| Graphes Edge | `daily-run` (81 → 92 fichiers) et `generate-training-plan` changent ; **les 8 autres fonctions ont l'empreinte de production** (`session-execution`, `completed-session`, `accept-training-plan`…) |

**Note sur l'environnement**
- Pendant la suite head-coach finale, ma propre vérification des graphes (`build:release:all --verify-only`) a réécrit `head-coach-engine/dist`. L'Edge locale a rechargé et redémarré en pleine exécution.
- Sur cette machine, `docker exec` mesure 3 à 4 s par appel : 54 conteneurs actifs, dont des piles d'autres sessions, non touchées.
- 42 tests de 11 fichiers ont alors échoué par délai dépassé ou `STACK_TRACE_ERROR`. Aucun ne concerne PHYS : `buildRawContext`, `p0Sec*`, `ux11r9*`, `p0SafeHealthEdge`, etc.
- Rejoués seuls avec des délais vitest élargis (60 s par test, 180 s par hook), sans changer leur logique : **188/188**.
- Le premier passage complet, sur le même code de production, n'avait que l'échec attendu de PHYS-01 via l'Edge, ensuite corrigé.

**Contre-épreuve des tests de production** : les quatre fichiers de test de production que PHYS avait modifiés, **restaurés à l'identique**, passent sur le candidat flags OFF.

## 5. Écarts constatés et propositions

1. **Comportements PHYS sans flag dans les commits d'origine** : A1–A5 et les séances manuelles ou REPLACE de familles PHYS. Corrigé (§ 3).
2. **Changement non signalé** : PHYS-02 étendait la grille d'endurance sous A10 à toutes les séances d'endurance de base. Il est désormais limité aux intervalles (ou intervalles ouverts).
3. **Tests PHYS** : écrits pour un PHYS toujours actif. Ils sont passés en interrupteurs ON explicites, avec contre-preuves OFF.
4. **Compatibilité de retour arrière** : les commits la prouvaient contre D ; elle est reprouvée contre `863f3fb` (compatibilité 011 à 04, incluse dans la suite head-coach).
5. **Diffs canoniques proposés** (non appliqués, sur accord HPM) :
   - `docs/05` : les cinq secrets et leur portée ;
   - `docs/04` : interrupteurs du chemin quotidien V2 ;
   - `docs/10` : scénario T65 (§ 4 de ce rapport).
6. **Branche docs séparée** : `7c180a8` (statut PARTIAL-01 CLOSED, rapport de readiness) n'est pas dans ce candidat. À fusionner au moment de la release ; conflit trivial sur `docs/00` et `docs/12`.

## 6. Préparation POWER

`POWER_GUARD_01_PROPOSAL.md` propose :
- d'étendre F-6C à la famille `power`, par un diff d'une condition dans `record_session_execution` ;
- de réutiliser `strength_set_required` : aucune fonction Edge ni web à changer ;
- les tests, la requête de précondition (attendu 0), le retour arrière et l'ordre de livraison.

**Aucune migration n'est installée.** Le contrat attend l'accord HPM.

## 7. Risques de release et de retour arrière

**Release flags OFF**
- À redéployer : `daily-run`, `generate-training-plan`, le web. Aucune migration.
- Comportement :
  - prouvé identique à la production par le différentiel et le test base réelle ;
  - le web PHYS n'emprunte ses nouveaux chemins (mobilité, puissance, guidage) que si une prescription PHYS existe, ce qui est impossible flags OFF ;
  - la suite web complète passe.
- Le compte de simulation, seul en V2, ne voit aucun changement flags OFF.

**Retour arrière vers `863f3fb`**
- Flags OFF : aucune donnée PHYS n'est écrite. Retour toujours possible.
- Après une activation : un programme contenant des intervalles, POWER ou mobilité bloque le retour sous ce niveau. Les requêtes SQL de précondition existent (`docs/release/phys02-rollback`, `phys03-rollback`, `phys04-rollback`). Les guidages écrits sont ignorés par l'ancien web (décodeur tolérant, prouvé).

**Secrets**
- Les cinq secrets doivent rester absents en production jusqu'aux décisions HPM.
- Précontrôle de release : empreinte ≠ sha256(`true`) pour chacun.

**Blocages d'activation**
1. **POWER** : garde serveur à installer avant `NALYNT_V2_POWER_ENABLED`.
2. **Guidage de performance** : canon `docs/03` §10 et validation qualifiée.
3. **Paramètres PHYS PROVISIONAL** : validation sportive.
4. **Mobilité** : variantes au poids du corps absentes du catalogue (PHYS-04).
5. Conflit de canon des intervalles (UX-11A.5a.3 §5), à arbitrer.

## 8. Commit local

Branche `int/v2-phys-integration-01` : fusion `dab1f4d`, puis le commit d'isolation (SHA donné à la livraison). Aucun push.

**STOP. Décision HPM attendue.**
