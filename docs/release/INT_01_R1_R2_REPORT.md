# INT-01 — R1 FIX & R2 ROLLBACK COMPATIBILITY REPORT

**Date** : 2026-10-13 · **Pour** : HPM (via Louis) · **Statut** : local uniquement. Aucun push, merge vers main, déploiement, changement de flag ni écriture en production. A12 et P1-TXT-01 ne sont pas inclus.

## 1. Branches, HEAD et commits
| Branche | HEAD | Contenu |
|---|---|---|
| `int/int-01-v2-candidate` et `-r0` | `860f73d` | candidat INT-01 initial, conservé pour comparaison |
| `int/int-01-compat` (C) | `3a45543` | version de compatibilité, 6 commits sur la production `92937a9` (détail ci-dessous) |
| `int/int-01-v2-candidate-r1` | ce commit de doc, après `31ea0d4` | candidat final = `860f73d` + R1 + fusion de C |

**Commits de C :**
- `00cfef5` moteur ;
- `7ed548b` web ;
- `5b3161a`, `11067a3`, `b2f7dfd` : harnais de test seulement ;
- `3a45543` docs.

**Commits du candidat après `860f73d` :**
- `155e98c` : R1 (web) ;
- `31ea0d4` : fusion de C. Le code moteur reste celui du candidat ; le test propre à C n'est pas repris ; la règle web des terrains est gardée et son test adapté.
- La fusion ne change ni moteur, ni Edge, ni SQL : diff vide sur `planning-engine/src`, `head-coach-engine/src`, `supabase` par rapport à `155e98c`.

**Inventaire Edge (sha256 des graphes).** Les 7 autres fonctions sont identiques à la production dans les trois versions.

| Fonction | Production `92937a9` | C | Candidat final |
|---|---|---|---|
| `daily-run` | `6c26c286…` | `c9df7832…` | `e00f0011…` |
| `generate-training-plan` | `85339242…` | `b8815db1…` | `dbccafa4…` |
| `session-execution` | `0702b514…` | `0702b514…` | `aebd17b1…` |

**SQL.** C ne contient aucune migration (empreintes = production). Le candidat garde ses 3 migrations P0-3, aux empreintes inchangées depuis INT-01.

## 2. R1 — preuve de correction
**Correctif (`155e98c`, web seulement).**
- Une seule règle de suspension pour tout Aujourd'hui : `healthBlockOf` appliqué à la décision affichée, restaurée ou calculée.
- Sous suspension, le bloc « Après ta séance » :
  - séance du jour ouverte ou arrêtée → « Séance suspendue » et « Consulter la séance » ;
  - séance terminée avant le signal → consultable ;
  - débrief déjà enregistré → lisible, sans « Modifier » ;
  - rien d'enregistré → aucune invitation.
- La confirmation d'arrêt se referme par « Retour ».

**Navigateur (390 px, web et Edge candidats, rider R).** R démarre une séance DH et enregistre un passage, puis déclare une douleur traumatique au check-in.
- Transition dans la page : les deux blocs passent à « Séance suspendue / Consulter la séance ».
- Après rechargement : aucun lien ou bouton « Reprendre », « Continuer la séance », « Raconter ma séance », « Saisir » ou « Enregistrer le passage ». Les seuls liens vers la séance sont deux « Consulter la séance ».
- Navigation directe sur `/today/session` : bannière « Séance suspendue » ; seul « Arrêter la séance » est proposé ; la confirmation donne « Confirmer l'arrêt » / « Retour ».
- En pause sous suspension : toujours « Arrêter » seulement.
- Après l'arrêt : Aujourd'hui n'affiche que « Séance suspendue — Consulter la séance » ; l'historique affiche « Séance guidée arrêtée » et « 1 séance arrêtée (partielle) ».

**Serveur (JWT de R).**

| Action | Résultat |
|---|---|
| nouvelle série | 409 `health_suspended` |
| terminer | 409 `health_suspended` |
| reprise | 409 `health_suspended` |
| pause | 200 |
| arrêt | 200 |

Le résultat déjà enregistré est conservé.

**Tests.** Ajouts dans `AfterSessionEntry`, `TodayPage`, `DailyPlanPanel`, `historyRepo` et le parcours UI P0-3 de suspension. Échec d'abord (11 tests), puis vert.

**Conséquence produit à valider.** Sous suspension, Aujourd'hui ne propose plus le débrief historique « Raconter ma séance » (règle « aucun accès indirect »). L'API `completed-session` n'a pas de garde serveur santé ; c'est préexistant et hors périmètre.

## 3. R2 — cause exacte du 500
- **`daily-run`** : `buildKeepFinalPrescriptionV2` → `trustedPlannedStructure` → `validatePrescriptionV2` (stage planned).
  - Le validateur refuse `unknown_drill` (`cornering_advanced_line_exit`), `unknown_text` (cue et critère) et `unknown_intent` (`dh_corner_line_control`).
  - L'agrégat déclaré (v2.6) égale celui du runtime, donc le cas n'est pas classé `final_prescription_catalog_mismatch` mais `SessionModelV2ContractError` → 500 `internal_error`.
  - C'est de la validation de catalogue, ni la reconstruction ni la réconciliation. Cela touche toute décision (KEEP, MODIFY, A10) d'un jour portant le drill.
- **Second danger, trouvé pendant l'étude : `generate-training-plan`.**
  - `assertValidTerrainAccess` refuse `off_camber_section` (« Virages en dévers », P0-2) → 500 à toute régénération.
  - Le web de production retire en plus ce terrain du profil à l'enregistrement (`filterKnown`).
- **Dégradation sans 500.** La prod bloque (`no_light_dh_drill`) la régression LIGHT d'un drill « allure de course » accordé sur terrain compatible. Le rider n'a alors pas de séance adaptée.

## 4. R2 — version de compatibilité (C)
**Ce que fait C** (construite sur la production, livrable seule) :
- connaît le drill v2_only, ses textes et son intent, mais ne les sélectionne jamais (`canonicalDhDrill` exclut les alternatives ; intent non sélectionnable) ;
- utilise `compatibleTerrains` en lecture seule, pour la régression LIGHT ;
- accepte `off_camber_section` dans le snapshot ;
- côté web : libellé et textes du drill ; un terrain enregistré mais non proposé est conservé.

**Ce que C ne change pas** : ni SQL, ni flag, ni règle sportive. P0-SAFE est intact (aucun fichier santé touché).

**Génération et adaptations identiques à la production** (différentiel sur les builds) :
- 32 256 constructions DH (7 compétences × 3 niveaux × 512 ensembles de terrains × 3 charges) ;
- 588 plans complets ;
- 264 000 adaptations quotidiennes (KEEP / MODIFY / REPLACE vers 8 types / REST × 5 temps × vélo disponible ou non ; 156 960 créées, 83 040 bloquées, 24 000 sans prescription) ;
- **0 différence**, manifeste identique.

**Composants qui doivent être compatibles avant toute génération du drill** :
- Edge `daily-run` (KEEP, MODIFY, REPLACE, A10 ; validation) ;
- Edge `generate-training-plan` (terrain déclarable) ;
- web (miroir des textes, libellé du drill, profil).

Les autres composants sont neutres :
- `session-execution` ne dépend pas des ids de catalogue (exécution vérifiée sous C) ;
- `accept-training-plan` a un graphe identique ;
- l'historique lit les exécutions.

## 5. Matrice de compatibilité
Données produites par chaque version, lues par chaque version (Edge et web servis réellement, JWT des riders) :

| Lecteur ↓ / données → | Plan généré par la production | Plan candidat avec drill v2_only | Drill « allure de course » sur terrain compatible | Profil avec `off_camber_section` |
|---|---|---|---|---|
| **Production** | OK | `daily-run` **500** ; web « non prise en charge » | MODIFY / REPLACE LIGHT bloqué `no_light_dh_drill` | régénération **500** ; terrain retiré à l'enregistrement |
| **C** | OK, identique à la production | KEEP / MODIFY / REPLACE / A10 `created` ; exécution OK ; web affiche | régression `braking_late_entry` `created` | régénération 200 ; terrain conservé |
| **Candidat** | OK | OK (génère) | OK | OK |

Croisements Edge × SQL (ordre P0-3) :

| Combinaison | Résultat |
|---|---|
| `daily-run` C × SQL candidat | 200 |
| Edge C × SQL production | 200 |
| `daily-run` candidat × SQL production (jour manuel) | 500 `persistence_failed` (jamais avant 120000) |
| `session-execution` production / C × RSE candidat sous suspension | 500 (garder le `session-execution` candidat jusqu'au rollback de 160000) |

## 6. Simulation réelle d'un rollback après génération
Une stack locale unique, Edge et web servis tour à tour.

| Phase | Versions | Ce qui a été joué | Résultat |
|---|---|---|---|
| 1 | production | rider P (plan prod) : check-in, séance DH guidée, 4 passages, terminée | 200 partout |
| 2 | C (SQL prod) | P : `daily-run` du 17 ; web C (Aujourd'hui, séance terminée) | `created`, affichage normal |
| 3 | candidat (3 migrations, Edge et web) | — S2 (drill v2_only) : check-in et séance DH guidée par l'UI, 4 passages, terminée<br>— S3 (`braking_marked_zone_at_speed` sur piste DH seule) : séance démarrée, 1 passage, **laissée ouverte**<br>— S4 : profil avec dévers | 200 partout |
| 4 | rollback vers C | Edge `daily-run` → C, puis SQL 160000 → 140000 → 120000 (empreintes = production), Edge C, web C | — |
| 5 | C | voir le détail ci-dessous | **0** erreur 500 dans le journal Edge C |

**Détail de la phase 5 :**
- **S2**, toutes les décisions `created` :
  - relance du jour (KEEP) et KEEP du 17 ;
  - REPLACE DH léger sur fatigue (même drill, 4 passages) ;
  - A10 60 min (5 passages) et A10 30 min (récupération) ;
  - nouvelle séance guidée avec le drill v2_only : 3 passages, terminée ;
  - web C : séance consultable (nom, textes, résultats), historique.
- **S3** :
  - la séance ouverte avant le rollback se termine sous C ;
  - REPLACE léger → `braking_late_entry` `created` ; A10 `created`.
- **S4** : régénération 200 ; enregistrement du profil dans le web C → `off_camber_section` conservé.
- **Données** : tout ce qui existait avant le rollback est intact (événements et résultats identiques) ; seuls des ajouts.
- **Web C sur les données du candidat** : séance arrêtée sous suspension (R) → « Repos aujourd'hui : pas de séance guidée », aucun démarrage possible.

**Contre-épreuve** : même données, Edge et web de **production** :
- S2 : `daily-run` **500** (KEEP et A10) ;
- S3 : bloqué `no_light_dh_drill` ;
- S4 : `generate-training-plan` **500** ;
- web : « Cette séance n'est pas prise en charge par cette version de l'application ».

## 7. Tests exécutés
- **C** :
  - planning-engine 842/842 (dont `int01CompatLaterPlans`) ;
  - prescription-engine 96/96 ;
  - head-coach-engine 1295/1295 (DB et Edge C) ;
  - web 2130/2130 (intégrations comprises), build OK ;
  - longitudinal-engine 873/873 ;
  - build release OK ;
  - contre-preuve : le test des plans stockés échoue sur le code de production.
- **Candidat final** :
  - planning-engine 883/883, prescription-engine 96/96 ;
  - head-coach-engine 1354/1354 (DB et Edge candidat) ;
  - configs Edge : session-execution 24/24, completed-session 147/147, edge 57/57 ;
  - longitudinal-engine 873/873 ;
  - web 2230/2230 (intégrations comprises), build OK ;
  - build release OK, inventaire inchangé.

## 8. Conséquences du maintien de l'étiquette v2.6
Voir l'ADR INT-01 R2 :
1. L'étiquette ne garantit plus la lisibilité (contenus lisibles : production ⊂ C ⊆ candidat).
2. Une fois le drill généré, la production `92937a9` n'est plus une cible de rollback sûre ; la cible devient C. Les données concernées se comptent par requête avant toute décision.
3. C doit être en production avant toute génération par le candidat.
4. Les plans de production restent lus à l'identique.
5. Être lisible n'approuve pas les textes PROVISIONAL.
6. Règle de gouvernance proposée : tout ajout de contenu sous une étiquette existante passe d'abord par une version de compatibilité déployée. À défaut : monter l'agrégat avec un lecteur multi-version.

## 9. Dépendances et points ouverts
1. **Ordre de release** :
   - C (Edge `daily-run`, `generate-training-plan`, web) ;
   - puis le candidat selon le plan P0-3 ;
   - rollback du candidat vers C (`docs/release/INT_01_COMPAT_RELEASE_PLAN.md` §4). Le §5 du plan P0-3 dit « release précédente » : avec C déployée, c'est C.
2. **docs/10, non modifié (proposition)** : T59 « Compatibilité de rollback du catalogue V2 », avec :
   - les différentiels C / production ;
   - KEEP / MODIFY / REPLACE / A10 sur un plan stocké contenant le drill v2_only ;
   - régénération avec `off_camber_section` ;
   - la séquence production → C → candidat → C.
3. **Décisions HPM** : règle de gouvernance (§8, point 6) ; débrief historique non proposé sous suspension (§2).
4. **Inchangé depuis INT-01** :
   - R3 : activation V2, A12 exclu ;
   - textes PROVISIONAL ;
   - limite de concurrence santé P0-3 ;
   - après un rollback vers C, l'historique détaillé P0-4 disparaît de l'affichage (les données restent).
5. **Environnement** : après le redémarrage de Docker Desktop, les conteneurs locaux INT-01 ont dû être redémarrés pour retrouver leurs ports. Données conservées ; sans effet sur le code.

## 10. Verdict
**READY INTEGRATION** (local), à la condition de l'ordre de release ci-dessus (C d'abord, C cible de rollback).

R1 est corrigé et prouvé, côté navigateur comme côté serveur. R2 est traité par une version de compatibilité minimale, sans nouveau contrat critique. La simulation complète d'un rollback après génération réelle ne produit ni 500 ni perte de résultat.
