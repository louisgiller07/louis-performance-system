# PHYS-03 — POWER COACHING REPORT

**Pour** : HPM et Louis. **Date** : 2026-10-15.
**Branche** : `feat/phys-03-power` (worktree `D:\nx\phys02`), créée depuis PHYS-02 `433a5fe`.
**Périmètre** : local uniquement. Aucun push, merge, déploiement, migration ni activation V2. REL-01 C/D non touché. M1 non modifié.

## Verdict

**READY LOCAL**, avec l'option puissance **désactivée par défaut** (`NALYNT_V2_POWER_ENABLED` absent = plans de D). Paramètres sportifs PROVISIONAL.

Limites assumées (détaillées en §5) :
- pas de séance de puissance pour un débutant ;
- pas de séance de puissance un jour LIGHT ;
- pas de garde serveur de complétion.

## 1. Existant réutilisé (aucun second système)

- **Catalogue v2.6** :
  - exercices explosifs par niveau et matériel : squat sauté, saut en longueur sans élan, sauts du patineur (intermédiaire, sans matériel), swing à l'haltère (haltères), pompes pliométriques (avancé) ;
  - `pogo_hops` en activation ;
  - leurs doses de référence (3–5 séries de 3–5 répétitions, repos 2–3 min), leurs consignes techniques et la vigilance « Arrête la série dès que la hauteur ou la vitesse baisse » ;
  - l'intention `corner_exit_power`.
- **Force** : échauffement des gabarits (exposé par le builder Force, comportement inchangé), retour au calme PHYS-01.1, estimateur de durée, règles de niveau cumulatif et de matériel.
- **Cadres** : A04, A10, A07, P0-3 (séances manuelles), enregistrement série par série (RPC générique, aucune migration), module guidé Force.
- **Canon** : docs/03 §3 (Activation · exercice explosif) et §5 (enveloppe Puissance), appliqués tels quels.

## 2. Fonctionnalités implémentées

**Séance complète** (format v2.6, famille `power`) :
- **Échauffement progressif** : mobilité (`hip_90_90`, `knee_to_wall_ankle`) → activation (`bird_dog`) → activation pliométrique (`pogo_hops`, 2 × 15–20).
- **Exercices explosifs dans l'ordre** :
  - intermédiaire avec haltères : squat sauté, saut en longueur, sauts du patineur, swing ;
  - sans matériel : les 3 sauts ;
  - avancé sans matériel : les 3 sauts + pompes pliométriques.
- **Dose** : 3 séries chacun, répétitions du catalogue, repos complet 2–3 min, aucun RPE.
- **Consignes** : vitesse, technique et qualité ; critère d'arrêt dès que la hauteur ou la vitesse baisse.
- **Retour au calme** : mobilité de hanche, respiration.
- **Durée réaliste** (estimation du contenu, bornes hautes) : 59 min pour 4 exercices, 51 min pour 3. C'est la durée affichée par la décision.
- Jamais de kg, de hauteur de saut ni de difficulté technique.

**Plan** (option serveur seulement) :
- en semaine `build`, la séance de Force bas du corps devient la séance de puissance (même date, durée, charge) ;
- jamais le lendemain d'une séance de développement au sens de M1 ;
- jamais pour un débutant ;
- trace sur la semaine : raison `power_session`, phrase traduite, `powerPolicy`.

**Jour** :

| Situation | Résultat |
|---|---|
| Normal | KEEP : la séance prévue, durée 59 min |
| Temps 55 min | même séance sans le dernier exercice explosif (51 min), repos inchangés |
| Temps 45 min (ou 3 exercices qui ne tiennent pas) | récupération active, jamais moins de 3 explosifs |
| Jambes ou avant-bras fatigués (C3.6 / C3.5) | décision M1 gardée, **pas de séance de puissance**, trace `V2_POWER_FATIGUE_HOLD` |
| Nuit courte, stress, douleur (M1 → LIGHT) | non défini : décision gardée, raison `power_load_not_supported` |
| Signal santé (P0-SAFE A4, A6 → A7) | REST, aucune séance |
| REST | REST |
| Séance manuelle `POWER` | séance du catalogue (MODERATE) ; débutant ou autre charge : refus explicite |

**Guidage et résultats** (web) :
- séance guidée série par série, sur le module Force ;
- l'échauffement et le retour au calme sont en lecture ;
- répétitions réalisées et RPE facultatif, sans champ de charge ;
- complétion possible dès une série réalisée.

**Historique** : la séance terminée est relue par M1 le lendemain (`recent_sessions`, `POWER`, `done`).

## 3. Preuves de bout en bout et tests

| Suite | Résultat |
|---|---|
| planning-engine | **979/979** (14 nouveaux : contenu par niveau / matériel, placement, KEEP, LIGHT, A10, fatigue, manuel, REST) |
| head-coach-engine, secrets PHYS absents (conditions de D, runtime D compilé) | **1514/1514**, 155 fichiers, 0 ignoré, 74 preuves de cible `nalynt-phys02` |
| head-coach-engine, secrets fractionné + puissance ON | **1514/1514**, 155 fichiers, 0 ignoré, 74 preuves de cible |
| web (intégrations comprises) | **2305/2305**, 23 preuves de cible |
| prescription-engine / longitudinal-engine | **96/96** / **890/890** |
| Web réel de D (checkout jetable `649a0a2`) | **11/11** (3 PHYS-03 + 3 PHYS-02 + 5 PHYS-01.1) |
| Builds | planning, prescription, head-coach (dist + bundles Edge), web : OK |

**Bout en bout** (`phys03PowerCoaching.integration.test.ts`, pile isolée `nalynt-phys02`, 74 migrations de D) :

| Rider | Résultat |
|---|---|
| Intermédiaire avec haltères | plan (puissance le 14/10 et le 4/11) → check-in → séance complète (59 min) → 12 séries enregistrées (11 réalisées, la dernière arrêtée pour la qualité), aucune charge → historique relu par M1 le lendemain |
| Avancé sans matériel | pompes pliométriques à la place du swing |
| Débutant | aucune séance de puissance au plan |
| Matériel limité / temps réduit | 3 sauts ; 55 min tient (51) ; 45 min → récupération active ; avec haltères, 55 min → séance raccourcie à 3 exercices |
| Jambes fatiguées | décision M1 gardée, pas de séance, trace |
| Nuit courte | décision M1 gardée, puissance non définie |
| Signaux santé | A4, et A6 → A7 : REST |

**Autres preuves** :
- **Edge** (`phys03PowerEdge.integration.test.ts`, runtime Deno local) : génération HTTP avec le secret ON (puissance) et OFF (aucune) ; daily-run → séance (59 min) → session-execution (série + complétion) → retenue fatigue via HTTP.
- **Compatibilité D** : `phys03PreviousRuntimeCompat.integration.test.ts`.
- **Non-régression Force** : fixtures Force et endurance régénérées identiques (échauffement Force exposé sans changement).
- **Typecheck** : planning-engine propre ; web : mêmes 7 fichiers de tests préexistants, aucun nouveau.

## 4. Compatibilité et rollback (démontré sur le vrai runtime D `649a0a2`)

- **Option absente** :
  - plans identiques à D (test de plan entier) ;
  - aucun document de puissance ;
  - rollback complet sûr.
- **Plans contenant des séances de puissance**, servis par D sans erreur :
  - KEEP = copie ;
  - LIGHT : refus propre (`modify_family_not_supported`) ;
  - A10 : récupération active ;
  - séance manuelle : refus explicite ;
  - le web de D affiche la séance bloc par bloc, en **lecture seule** : il ne peut pas l'enregistrer ni la terminer.
- **Écart de sécurité en cas de rollback** : un jour de jambes fatiguées, D prescrit la séance de puissance (la retenue PHYS-03 n'existe pas dans D). Démontré.
- **Condition d'un rollback complet** :
  - `docs/release/phys03-rollback/ROLLBACK_TO_D_PRECONDITION.sql` (lecture seule, agrégée, exécutée par Louis dans le SQL Editor) renvoie `power_sessions_ahead = 0` et `intervals_sessions_ahead = 0` ;
  - les secrets sont retirés.
- **Désactiver l'option** = retirer le secret : aucun plan modifié, les plans existants restent servis par ce runtime.

## 5. Limites

- **Débutant** : aucun exercice explosif à son niveau dans le catalogue, donc pas de séance de puissance. Une initiation demanderait des exercices validés.
- **Jour LIGHT** : puissance non définie (comme une Force déjà LIGHT).
- **Serveur** : il n'exige aucune série réalisée pour terminer une séance de puissance (le web l'exige). Un garde serveur demanderait une migration.
- **Fatigue de la veille** : « jamais après une séance fatigante » est appliqué au plan et aux signaux M1 du jour, mais la séance réellement faite la veille n'est pas relue.
- **Protocole** : `strength_warm_up_v1` ne liste pas `POWER` (échauffement réutilisé via le gabarit Force).
- **Durée affichée** : estimation pour la puissance, créneau du planificateur pour la Force.
- **Paramètres sportifs PROVISIONAL** : choix et ordre des exercices, séries au minimum, placement en semaine `build`, échauffement, estimation de durée, signaux de retenue, formulations.

## 6. Propositions canoniques

`docs/release/PHYS_01_PROPOSED_CANON_DIFFS.md` §F :
- architecture technique ;
- comportements ;
- tableau des paramètres sportifs PROVISIONAL ;
- décisions ouvertes et conflits ;
- diffs docs/03, 04, 05, 07, 10 (T66).

ADR PHYS-03 (PROPOSÉE) dans `docs/11_DECISION_LOG.md`.

Conflits signalés :
- M1 n'a pas de branche `POWER` pour C3.5 / C3.6 (comblé côté V2 sans modifier M1, à valider) ;
- portée de `strength_warm_up_v1` ;
- garde serveur de complétion ;
- durée affichée.
