# PHYS-02 — ENDURANCE COACHING REPORT

**Pour** : HPM et Louis. **Date** : 2026-10-15.
**Branche** : `feat/phys-02-endurance` (worktree `D:\nx\phys02`), partie de PHYS-01.1 `5466df3`.
**Périmètre** : local uniquement. Aucun push, merge, déploiement, migration ni activation. REL-01 C / D, le site marketing et le moteur DH ne sont pas touchés. M1 n'est pas modifié.

## Verdict

**READY LOCAL**, avec l'option fractionné **désactivée par défaut**.

Deux points demandent une décision HPM :
1. **Conflit canonique.** « Fractionné adapté au niveau » contredit l'ADR UX-11A.5a.3 §5 (« aucun sélecteur 4 / 6, aucune règle de fatigue, de niveau ou de phase »). Ce point n'est donc **pas livré** au-delà de l'intensité au RPE et du guidage par l'historique.
2. **Fractionné un jour LIGHT.** Aucune séance du jour n'est proposée : c'est le cas « non défini » du canon.

## 1. Existant réutilisé (non reconstruit)

- **Endurance fondamentale complète.** Protocole `endurance_base_continuous` et son builder (inchangés), plan, progression +15 min par cycle, MODIFY LIGHT 45 min, A10 par paliers de 15 min.
- **Module guidé et résultats.** Le module guidé endurance enregistre l'activité réalisée dans `session_activity_results` (activité, durée réelle, distance, RPE ; correction unique).
- **Fractionné du catalogue v2.6.** Le protocole `endurance_intervals_3min` (6 × 3 min à RPE 8, 2 min faciles, échauffement 15 min, retour au calme 10 min) et ses textes existaient déjà. Ils sont repris tels quels.
- **Activités et règle hors terrain.** Mêmes activités, même règle « hors terrain sans créneau vélo » (BUG-V2-1).
- **Cadres existants.** A04 (MODIFY / REPLACE), A10, la progression de bloc, le décodeur et la carte web, l'enregistrement d'exécution.
- **Méthode PHYS-01.1.** Ajouts quotidiens tracés, et preuve de compatibilité sur le code réel de D.

## 2. Parcours implémentés

### Plan
- **Avec l'option** (`NALYNT_V2_ENDURANCE_INTERVALS_ENABLED=true`) :
  - la séance d'endurance de chaque semaine de surcharge (`build_plus`) devient le fractionné : 53 min, MODERATE ;
  - la semaine l'indique : raison `endurance_intervals`, phrase traduite au web, `targets.aerobicSessionKind`, `intervalsPolicy`.
- **Sans l'option** : plan identique à D, octet pour octet.
- **Encodage, sans nouveau format.** Un bloc `main` par répétition (3 min, RPE 8, consigne de travail), un bloc `main` par récupération (2 min, consigne facile), `items: []`.

### Le jour
| Situation | Résultat |
|---|---|
| Normal | KEEP : fractionné prévu, à l'identique |
| Nuit courte / jambes / douleur (M1 → LIGHT) | décision conservée, pas de prescription du jour, raison `intervals_load_not_supported` (aucun plantage) |
| Mental RED (docs/10 T1.3) | endurance fondamentale, 53 min, activités prévues (`v2.modify.intervals_to_base`) |
| Famille engagée (M1 → fondamentale LIGHT) | endurance fondamentale, 45 min |
| 50 min disponibles | fractionné jamais coupé → endurance fondamentale 45 min |
| 40 min disponibles | récupération active |
| Douleur traumatique | REST, aucune séance (P0-SAFE inchangé) |
| Séance manuelle / REPLACE fractionné | séance du catalogue en MODERATE ; autre charge refusée avec un message précis |

### Guidage et résultats
- **Pendant la séance (web)** :
  - l'échauffement s'affiche, puis « Fractionné · 28 min » : « 6 × 3 min à RPE 8, 2 min faciles entre les répétitions », le déroulé répétition par répétition et les consignes, puis le retour au calme ;
  - chaque RPE d'endurance est traduit en mots (ex. RPE 8 : « Difficile : tu ne peux dire que quelques mots »).
- **Saisie du résultat** :
  - activité, durée réelle, distance, RPE ;
  - pour un fractionné, l'aide précise : « RPE 8 pendant les répétitions — note ton ressenti sur toute la séance ».
- **Séance suivante** (`enduranceGuidance`) :
  - rappel de la dernière séance terminée du même protocole (28 jours), telle qu'enregistrée ;
  - en endurance fondamentale, si le RPE noté dépassait la cible : « garde aujourd'hui un rythme où tu peux parler en phrases complètes ».
- **Ce qui n'est jamais utilisé** : fréquence cardiaque, FTP, zone.

## 3. Progression et adaptations (plan de 6 semaines, rider sans historique)

| Semaine | Rôle | Endurance (sans option) | Endurance (avec option) |
|---|---|---|---|
| 1 | introduction | fondamentale 45 min LIGHT | identique |
| 2 | build | fondamentale 45 min | identique |
| 3 | build+ | fondamentale 60 min | **fractionné 53 min** |
| 4 | consolidation | — | — |
| 5 | build (cycle 2) | fondamentale 60 min | identique |
| 6 | build+ (cycle 2) | fondamentale 75 min | **fractionné 53 min** |

- **Lecture de la progression.** Le volume d'endurance fondamentale monte par cycle. La semaine de surcharge apporte l'intensité, à dose fixe. La consolidation retire l'endurance. Aucune hausse automatique tirée des résultats : le guidage montre, il ne change rien.
- **Retenue.** Séances manquées (build+ retenue) → pas de fractionné cette semaine-là. Semaines spécifique course et affûtage : endurance fondamentale.
- **Disponibilité.** Sans créneau de 53 min, endurance fondamentale 45 min (`adapted_to_availability`). La même règle s'applique au temps du jour (A10).

## 4. Tests

| Suite | Résultat |
|---|---|
| planning-engine | **960/960** (24 nouveaux ; le cas « fractionné manuel refusé » devient un cas construit) |
| head-coach-engine, conditions de D (séquentiel, Edge servie avec le flag V2 et sans le secret fractionné, `RUN_LOCAL_P0_EDGE=1`, runtime D compilé) | **1483/1484**, 149 fichiers, 71 preuves de cible `nalynt-phys02`. Le test ignoré est le volet « secret ON » du test Edge. |
| Test Edge, runtime servi avec le secret ON | **2/2** : génération HTTP avec fractionné ; daily-run → session-execution → daily-run avec guidage |
| web (intégrations comprises) | **2296/2296**, 23 preuves de cible |
| prescription-engine / longitudinal-engine | **96/96** / **890/890** |
| Web de D (checkout jetable `649a0a2`) | **8/8** (3 PHYS-02 + 5 PHYS-01.1) |
| Builds | planning, prescription, head-coach (dist + bundles Edge), web : OK |

- **Bout en bout** (`phys02EnduranceCoaching.integration.test.ts`, pile isolée `nalynt-phys02`, 74 migrations de D) : plan → check-in → séance → guidage → résultats → séance suivante, sur 6 semaines ; plus les cas sommeil, mental, temps, santé et « sans option ».
- **Fixtures web** : documents réels du moteur, régénérés de façon déterministe. Le fixture Force PHYS-01.1 est inchangé.
- **Typecheck** : planning-engine propre (2 erreurs de typage de tests PHYS-01.1 corrigées). Web : mêmes 7 fichiers de tests en erreur qu'en PHYS-01.1, aucun nouveau.

## 5. Compatibilité et rollback

- **Format** : `session-model-v2.6`, aucun manifeste, aucune migration, M1 inchangé.
- **Prouvé sur le code réel de D.**
  - *Option OFF* : plan identique (plan entier) ; le web de D lit les prescriptions d'endurance et ignore le guidage ; les séances d'endurance faites sous D sont relues par le guidage.
  - *Option ON, ce qui fonctionne* : le web de D lit le fractionné bloc par bloc et enregistre l'activité ; le KEEP de D sur un fractionné est une copie ; sur MENTAL_RED, D bloque proprement.
  - *Option ON, risque démontré* : D lève une erreur de contrat sur un fractionné allégé (nuit courte), et **rien n'est persisté** ce jour-là. Sur les mêmes données, PHYS-02 persiste la décision avec sa raison.
- **Règle de rollback.**
  - *Option OFF* : retour vers D sûr à tout moment, dans les deux sens.
  - *Option ON, avec des plans à fractionné acceptés* : le retour arrière est le secret à `false` (plus de nouveau fractionné), avec le runtime PHYS-02, qui sert les plans existants. Retirer `daily-run` vers D n'est sûr que si aucun fractionné n'est à venir. Requête agrégée de contrôle (non exécutée) :
    ```sql
    select count(*) from public.training_plan_generated_sessions g
    join public.training_plan_current_version c on c.plan_version_id = g.plan_version_id
    where g.kind = 'AEROBIC_INTERVALS' and g.date >= current_date;
    ```
- **Livraison (après GO).**
  1. Web : fractionné groupé, mots du RPE, guidage, messages.
  2. `daily-run` : règles du jour et guidage.
  3. `generate-training-plan` : plans identiques tant que le secret est absent.
  4. Le secret, en dernier, sur GO séparé.
  5. Visible pour tous dès l'étape 1 : la phrase d'aide RPE sur les blocs d'endurance fondamentale.

## 6. Règles sportives à valider (PROVISIONAL)

- **Placement** : fractionné en semaine `build_plus` seulement. Rien en semaine spécifique course : à discuter, l'effort de 3 min à RPE 8 est proche de la course DH.
- **Repli** : endurance fondamentale 45 min quand le fractionné ne tient pas (créneau ou temps du jour).
- **Jour LIGHT** : pas de séance du jour (voir D.2 des propositions).
- **Fractionné → fondamentale** : 53 min (MODERATE), 45 min (LIGHT).
- **Guidage** : 28 jours, même protocole ; rappel si RPE noté > cible max ; jamais de comparaison pour le fractionné.
- **Mots de l'échelle RPE** affichés au rider.
- **Contenus du catalogue** (6 × 3, échauffement et retour au calme sans RPE) : déjà PROVISIONAL (ADR UX-11A.5a.3).

## 7. Modifications canoniques proposées

Document : `docs/release/PHYS_01_PROPOSED_CANON_DIFFS.md`.
- **Réécrit** : il ne décrit que le comportement implémenté (Force PHYS-01.1 + endurance PHYS-02). Plus aucune référence à l'ancienne montée de version.
- **Trois parties séparées** : architecture technique, comportements du jour, **paramètres sportifs PROVISIONAL** (tableau valeur → fichier).
- **Diffs proposés** pour docs/03 (§5, §6, §7, §10), docs/04 (A10, ajouts du jour, fractionné), docs/05, docs/07, docs/10 (T64, T65).

Journal (`docs/11_DECISION_LOG.md`, sur la branche) :
- ADR PHYS-01 et PHYS-01.1 remplacées par une ADR PHYS-01.1 ne décrivant que le comportement accepté ;
- ADR PHYS-02 ajoutée (PROPOSÉE).

`docs/00` et `docs/12` ne sont pas modifiés sur la branche, comme pour PHYS-01.1.

**Décisions ouvertes** :
1. Conflit « adapté au niveau » / ADR UX-11A.5a.3 §5, et donnée de niveau d'endurance (absente du profil).
2. Fractionné un jour LIGHT : variante 4 × 3 (lever §5) ou endurance fondamentale LIGHT 45 min (exception au principe de non-modification de la décision de M1, comme `V2_SYSTEMIC_FLOOR`).
3. Activation de l'option et règle de rollback associée.
4. Résultats par répétition : non enregistrés (aucune table).

## 8. Environnement de test

- **Pile isolée** `nalynt-phys02`, ports 56610–56619, `config.toml` en skip-worktree (non versionné). Edge servi localement avec des fichiers d'environnement de test (aucun secret réel).
- **Checkout jetable de D** `D:\nx-tmp\dcompat` : moteurs compilés et dossiers de test non versionnés (`src/zz-phys02`). Aucun fichier de D modifié.
- **Rapport PHYS-01 initial** (`PHYS_01_PHYSICAL_COACHING_IMPLEMENTATION_REPORT.md`) : laissé tel quel comme historique, marqué remplacé.
