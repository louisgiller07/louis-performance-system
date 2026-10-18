# PHYS-02.1 — ENDURANCE STABILIZATION REPORT

**Pour** : HPM et Louis. **Date** : 2026-10-15.
**Branche** : `feat/phys-02-endurance` (worktree `D:\nx\phys02`), suite de PHYS-02 `869d3c6`.
**Périmètre** : local uniquement. Aucun push, déploiement, secret de Production, migration ni activation de V2. Les branches REL-01 ne sont pas touchées. M1 n'est pas modifié. Aucun nouveau format de séance.

## Verdict

**READY LOCAL.** L'option fractionné reste **désactivée** ; la génération 6 × 3 min à RPE 8 reste PROVISIONAL et non activée.

**Rollback vers D** : complet seulement si **aucun plan courant ne contient de fractionné** à partir de la date du jour. Tant que l'option n'a jamais été activée, c'est le cas. Sinon, le retour arrière est le retrait du secret, avec le runtime PHYS-02.1.

## 1. Comportement du jour allégé

Quand M1 décide **MODIFY vers LIGHT** sur une séance `AEROBIC_INTERVALS` (prévue, ou manuelle) :
- **la décision et la dose de M1 sont conservées** : MODIFY, LIGHT ;
- **la séance exécutée** est l'endurance fondamentale du catalogue (`endurance_base_continuous`) à la dose LIGHT : 45 min (10 min d'échauffement RPE 2–3, 30 min RPE 3–4 avec le test de la parole, 5 min de retour au calme), avec les activités prévues (hors terrain si le jour n'a pas de créneau vélo) ;
- **le remplacement est tracé** :
  - règle de prescription `v2.modify.intervals_light_to_base` ;
  - règle de décision `V2_INTERVALS_LIGHT_FALLBACK` (couche ARBITRATION), avec la séance et les règles de M1 dans le détail (ex. « M1 : MODIFY AEROBIC_INTERVALS LIGHT », C3.3) ;
  - phrase au rider dans le raisonnement et l'objectif : « Ton état du jour demande une séance légère et le fractionné prévu n'a pas de version allégée : endurance fondamentale légère à la place, à un rythme où tu peux parler en phrases complètes. » ;
- **la décision persistée affiche la séance effective** (type `AEROBIC_BASE`, 45 min), comme l'exige A07, qui refuse un écart de type entre décision et prescription.

| Situation (jour de fractionné) | Résultat |
|---|---|
| Nuit courte (C3.3) | MODIFY · endurance fondamentale LIGHT 45 min, tracé |
| Jambes fatiguées (C3.6) | idem |
| Douleur légère au genou (non-safety) | idem |
| Nuit courte + 30 min disponibles | récupération active (A10) |
| Nuit courte + 15 min disponibles | REST (A10) |
| Douleur traumatique (A4) | REST, aucune séance, aucun repli |
| Douleur forte la veille (A6), signal encore ouvert (A7) | REST, aucune séance, aucun repli |
| REST décidé par M1 | REST (jamais transformé en entraînement) |
| Séance manuelle, M1 → LIGHT | repli identique (`v2.manual.session` + `v2.modify.intervals_light_to_base`) |
| Séance manuelle choisie en LIGHT par le rider | refus explicite (`manual_load_not_supported`, message propre au fractionné) |
| Toute autre variation de charge du fractionné | non définie (`intervals_load_not_supported`), décision conservée |

**État sûr et explicite** : si aucune séance compatible ne peut être produite, la prescription est bloquée avec sa raison, et la décision de M1 reste visible. Cela couvre un document d'un autre catalogue, une durée non supportée, une adaptation non définie ou un temps insuffisant (→ REST).

## 2. Conformité et propositions canoniques

- **Conflit traité** : ADR UX-11A.5a.3 §5 (« aucune règle de fatigue, de niveau ou de phase ») contre la demande d'un repli un jour LIGHT.
- **Exception minimale proposée** (`PHYS_01_PROPOSED_CANON_DIFFS.md` §E, ADR PHYS-02.1 PROPOSÉE) :
  - le fractionné n'est jamais allégé ;
  - un jour LIGHT, il est **remplacé** par l'endurance fondamentale LIGHT du catalogue ;
  - aucune autre règle de fatigue, aucun sélecteur 4 / 6, aucune règle de niveau ou de phase.
- **Deuxième exception, à valider avec la première** : principe « la décision de M1 n'est pas changée ». Seul le type de séance persisté est aligné, de façon tracée, comme `V2_SYSTEMIC_FLOOR` et `V2_TODAY_TIME_CONSTRAINT`. Le libellé MODIFY et la charge LIGHT restent ceux de M1.
- **Règle technique et paramètres sportifs séparés** :
  - technique (architecture §A.9) : transformation tracée, ordre P0-SAFE → M1 → plancher systémique → prescription → A10 → repli → A07 ;
  - sportif provisoire (tableau §C) : séance de remplacement, 45 min, phrase au rider.
- **Niveau d'endurance** : non introduit (aucune donnée au profil). Le conflit « fractionné adapté au niveau » reste ouvert.
- **Journal** : ADR PHYS-02 annotée (jour LIGHT révisé), ADR PHYS-02.1 ajoutée. Diffs mis à jour pour docs/03 §6, docs/04, docs/07 (« Repli du fractionné »), docs/10 T65.

## 3. Tests

| Suite | Résultat |
|---|---|
| planning-engine | **965/965** (le jour LIGHT, la séance manuelle, A10 50 / 30 / 15 min, REST) |
| head-coach-engine, secret fractionné **ON** (Edge servie avec le secret, séquentiel, `RUN_LOCAL_P0_EDGE=1`, runtime D compilé) | **1492/1492**, 150 fichiers, **0 ignoré**, 71 preuves de cible `nalynt-phys02` |
| head-coach-engine, secret **OFF** (conditions de D) | **1492/1492**, 150 fichiers, **0 ignoré**, 71 preuves de cible. Un premier passage a eu 1 dépassement du délai de 5 s sur un test de concurrence UX-11R.9 sans lien avec l'endurance (fichier inchangé). Relancé seul 3 fois : 24/24 à chaque fois ; second passage complet : 1492/1492. Aucun délai modifié. |
| web (intégrations comprises) | **2297/2297**, 23 preuves de cible |
| prescription-engine / longitudinal-engine | **96/96** / **890/890** |
| Web réel de D (checkout jetable `649a0a2`) | **8/8**, dont le document de repli |
| Builds | planning, prescription, head-coach (dist + bundles Edge), web : OK |

- **Le test Head Coach précédemment ignoré** (volet « secret ON » du test Edge) ne dépend plus du secret : le plan à fractionnés est créé côté Node, puis servi via HTTP. Il passe dans les deux environnements, et le test de génération HTTP vérifie le fractionné (ON) ou son absence (OFF).
- **Parcours vérifiés** (pile isolée `nalynt-phys02`, 74 migrations de D) :
  - plan → check-in → séance → guidage → résultat → séance suivante, sur 6 semaines ;
  - jour de repli LIGHT réalisé → référence de la séance d'endurance suivante ;
  - le fractionné suivant revient normalement.
- **Nouveaux tests** :
  - `applyV2IntervalsLightFallback.test.ts` (4) ;
  - intégration : nuit courte, jambes, douleur, temps 30 / 15 min, A4, A6 → A7 ;
  - compatibilité D : conditions de rollback et requête de précondition ;
  - Edge : repli via le runtime Deno, plans inchangés ;
  - web : repli et refus manuel.

## 4. Compatibilité et rollback (démontré sur le vrai runtime D, `649a0a2`)

| Situation | Runtime D | Prouvé par |
|---|---|---|
| Option jamais activée | plan identique (plan entier), KEEP / MODIFY, données relues dans les deux sens : **rollback complet sûr** | compat. 1, 4 |
| Plan à fractionnés, jour de fractionné normal | KEEP = copie ; la séance réalisée sous D est relue par PHYS-02.1 | compat. 2 |
| Plan à fractionnés, A10 sur un jour de fractionné | récupération active, sans erreur | compat. 5 |
| Plan à fractionnés, jour d'endurance fondamentale baissé | MODIFY 45 min, sans erreur | compat. 5 |
| Séance manuelle de fractionné baissée | refus explicite (`manual_kind_not_supported`), sans erreur | compat. 5 |
| Plan à fractionnés, MENTAL_RED | blocage propre (`modify_kind_change_not_supported`) | compat. 3 |
| **Plan à fractionnés, jour de fractionné baissé à LIGHT** | **erreur de contrat, rien n'est persisté ce jour-là** — PHYS-02.1 sert le repli sur les mêmes données | compat. 3, 5 |
| Après le dernier fractionné du plan | jour LIGHT servi normalement | compat. 5 |
| Web de D | lit tous les documents, dont le repli (une endurance fondamentale ordinaire) | web D 8/8 |

**Retour impossible vers D** : tant qu'un plan courant contient un fractionné à partir de la date du jour, chaque jour où M1 le baisse à LIGHT ferait échouer le daily-run de D pour ce rider.

**Désactivation de l'option sans perdre ni modifier les plans** :
1. retirer le secret `NALYNT_V2_ENDURANCE_INTERVALS_ENABLED` de `generate-training-plan` (aucune écriture en base) ;
2. les nouvelles générations n'ont plus de fractionné ;
3. les plans existants restent tels quels et sont servis par le runtime PHYS-02.1 (KEEP, repli LIGHT, guidage).

Prouvé sur le runtime Edge local, secret ON puis OFF : lignes des plans et version courante identiques avant / après.

**Conditions exactes d'un rollback complet** (web, `daily-run`, `generate-training-plan` vers D) :
1. `docs/release/phys02-rollback/ROLLBACK_TO_D_PRECONDITION.sql` renvoie `intervals_sessions_ahead = 0`. Requête en lecture seule et agrégée, exécutée par Louis dans le SQL Editor ; jamais par Claude Code en Production.
2. Le secret est déjà retiré (sinon de nouveaux plans à fractionné peuvent apparaître).

Si la condition n'est pas remplie, deux options :
- **attendre** : après la date de dernier fractionné renvoyée par la requête, le compte retombe à 0 ;
- **retour partiel** : seulement le web et `generate-training-plan`, en gardant `daily-run` PHYS-02.1.

Aucune suppression de données, aucune modification de plan.

## 5. Limites sportives restantes (PROVISIONAL)

- Génération 6 × 3 min à RPE 8 et placement en semaine de surcharge : non activés.
- Repli LIGHT : séance (endurance fondamentale), durée 45 min, formulation au rider.
- Douleur non-safety localisée (genou, cheville…) : **corrigé** dans le rapport final (`PHYS_02_FINAL_REPORT.md`) — aucune activité n'est plus proposée quand la règle douleur existante ne libère pas la zone.
- Niveau d'endurance absent du profil ; résultats par répétition non enregistrés.
- Tous les autres paramètres de PHYS-01.1 / PHYS-02 (tableau §C des propositions) restent à valider.
