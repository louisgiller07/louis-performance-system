# PHYS-04 — MOBILITY & BODYWEIGHT REPORT

**Pour** : HPM et Louis. **Date** : 2026-10-15.
**Branche** : `feat/phys-04-mobility-bodyweight` (worktree `D:\nx\phys02`), créée depuis PHYS-03 `1bf0295`.
**Périmètre** : local uniquement. Aucun push, merge, déploiement, migration ni secret activé. REL-01 C/D non touché. M1 et P0-SAFE non modifiés.

## Verdict

**READY LOCAL**, mobilité générée **désactivée par défaut** (`NALYNT_V2_MOBILITY_ENABLED` absent = plans de D). Paramètres sportifs PROVISIONAL.

- **Mobilité** : séance complète, guidée et enregistrée, au format v2.6.
- **Poids du corps** : progression réelle des répétitions, fondée sur les séries enregistrées, avec des règles explicites.
- **Blocage documenté** : aucune variante plus difficile sans matériel au catalogue. Au haut de la fourchette, le rider garde l'exercice ; aucun exercice inventé.

## 1. Ce qui fonctionnait déjà

- **Catalogue v2.6** :
  - protocole `mobility_routine_v1` (hanches, chevilles, dos, poignets, respiration ; 8 mouvements en durée ; 22–30 min ; doses verrouillées par l'ADR de correction de durée) ;
  - intention `mobility_on_bike_range` ;
  - exercices au poids du corps par niveau, avec leurs doses, consignes et vigilances.
- **Récupération active** (A04 / A10 / manuelle) : séance `RECOVERY_ACTIVE`, module web, complétion sans résultat.
- **Retours au calme** : Force (PHYS-01.1), endurance (blocs du protocole), puissance.
- **Force** : séries enregistrées série par série (répétitions, RPE ; charge facultative), lecture de l'historique (PHYS-01, 56 jours), retenues douleur / fatigue M1 / dose de la semaine.
- **Manques** :
  - pas de builder de mobilité, de placement, de prescription du jour ni de module guidé ;
  - la mobilité manuelle était refusée ;
  - aucun conseil pour les exercices sans matériel.

## 2. Ce qui est réellement livré

**Séance de mobilité** (famille `mobility`, kind `MOBILITY`) :
- **Contenu** : le protocole tel quel :
  - les 8 mouvements dans l'ordre ;
  - leur durée de référence, leurs consignes ;
  - la vigilance « sans forcer l'amplitude » ;
  - aucune dose, aucun étirement ni aucune règle médicale ajoutés.
- **Plan** (option seulement) : une séance de 30 min sur le premier jour libre (≥ 30 min) de la semaine de consolidation ; la semaine trace la politique et une phrase traduite.
- **Jour** :

| Situation | Résultat |
|---|---|
| KEEP | copie |
| Temps 22 à 29 min | routine au minimum du protocole (22 min) |
| Temps sous 22 min | récupération active, puis REST |
| Séance manuelle | la routine |
| Douleur bloquante | REST |
| Durée imposée sous 22 min | blocage explicite |

- **Web** :
  - un mouvement à la fois : « Mouvement n sur 8 », zone, durée, consigne, vigilance ;
  - boutons précédent / suivant (cibles de 44 px) ;
  - rien à mesurer : le rider termine la séance ;
  - avant le départ et après la fin : la séance complète en lecture.

**Distinction des trois formes** :
- **Séance de mobilité** : une routine complète, planifiée ou choisie.
- **Récupération active** : une activité très facile, quand M1 remplace la séance ou que le temps manque.
- **Retours au calme** : la fin d'une autre séance.

**Force au poids du corps** (`repsGuidance`, conseil consultatif) :
- **Portée** : chaque exercice de travail sans matériel mesuré en répétitions.
- **Lecture** : les séries terminées du même exercice (référence ≤ 28 jours, même fourchette).
- **Règles** :

| Situation | Conseil |
|---|---|
| Aucun historique | calibrer : fourchette et répétitions en réserve |
| Effort ≥ cible + 2, ou une série sous la fourchette | minimum de la fourchette |
| Toutes les séries au haut de la fourchette, effort dans la cible | garder le haut, et dire « pas encore de variante plus difficile sans matériel » |
| Effort dans la cible, sinon | série la plus courte + 1 répétition (jamais au-dessus de la fourchette) |
| Douleur, fatigue M1, ou dose de la semaine déjà augmentée | +1 retenu |

- **Hors règle** : autre fourchette ou référence trop ancienne → la dernière séance est seulement montrée.
- **Jamais** : de kg, d'autre exercice, ni de changement de la dose prescrite.
- **Web** : note sous l'exercice (carte et séance guidée) et indication « Conseillé : n » sur le champ, jamais pré-rempli.

## 3. Preuves et tests

| Suite | Résultat |
|---|---|
| planning-engine | **994/994** (16 nouveaux) |
| head-coach-engine, secrets PHYS absents (runtime D compilé) | **1526/1526**, 158 fichiers, 0 ignoré (second passage ; voir §3 bis) |
| head-coach-engine, secrets fractionné + puissance + mobilité ON | **1526/1526**, 158 fichiers, 0 ignoré |
| web (intégrations comprises) | **2316/2316** (10 nouveaux) |
| prescription-engine / longitudinal-engine | **96/96** / **890/890** |
| Web réel de D (checkout jetable `649a0a2`) | **14/14** (3 PHYS-04 + 3 PHYS-03 + 3 PHYS-02 + 5 PHYS-01.1) |
| Builds | planning, head-coach (dist + bundles Edge), web : OK |
| Typecheck | aucune erreur nouvelle (web : mêmes 7 fichiers de tests préexistants ; head-coach : déclarations des bundles et fichiers non touchés) |

**Bout en bout** (`phys04MobilityBodyweight.integration.test.ts`, 7/7, pile isolée `nalynt-phys02`) :

| Cas | Résultat |
|---|---|
| Débutant sans matériel | calibrer → séries enregistrées → la séance suivante vise +1 répétition |
| Séance manquée | le 21/10 non réalisé : le 4/11 vise toujours +1 depuis le 14/10, rien d'inventé |
| Avancé sans matériel | au haut : garder le haut, `no_bodyweight_variant`, mêmes exercices. Le plan avancé augmente déjà la dose en semaine 3 : la fourchette du pont fessier change (8–12 → 8–10), donc référence seulement |
| Mobilité | plan → check-in → routine complète (8 mouvements) → exécution terminée sans résultat → relue par M1 le lendemain |
| Temps réduit | mobilité : 25 min → 22 min ; 20 min → récupération active. Force : 40 min → séance raccourcie, conseils gardés |
| Santé bloquante | douleur traumatique le jour de mobilité → REST, aucune routine |
| Mobilité manuelle | la routine du catalogue |
| Option absente | aucune mobilité au plan |

**Autres preuves** :
- **Edge** (`phys04MobilityEdge.integration.test.ts`, runtime Deno local, JWT du rider), 2/2 avec le secret ON et 2/2 avec le secret OFF :
  - génération : mobilité en consolidation avec le secret, aucune sans ;
  - daily-run : calibrer → séries via session-execution → +1 ;
  - routine terminée sans résultat.
- **Web** (`phys04MobilityBodyweight.test.tsx`, documents produits par le moteur) :
  - carte et ordre des mouvements ;
  - guide pas à pas jusqu'à la complétion ;
  - notes de répétitions ;
  - indication sur le champ, jamais pré-rempli ;
  - message de blocage ;
  - conseil illisible ignoré.

### 3 bis. Second passage complet, secrets absents

- **Premier passage** : 1525/1526. Échec isolé d'un test INT-01 (débrief V1 sous suspension de santé), sans lien avec PHYS-04 ; ce fichier passe seul (7/7).
- **Second passage complet** : 1526/1526, 0 ignoré.
- Aucun défaut démontré, donc aucune stabilisation ajoutée.

## 4. Compatibilité D et limites du rollback (démontré sur le vrai runtime D `649a0a2`)

- **Option absente** :
  - plans identiques à ceux de D ;
  - `repsGuidance` ignoré par le web de D (décodeur tolérant) et jamais écrit par le runtime de D ;
  - rollback sûr.
- **Plans avec mobilité**, servis par D sans erreur :
  - KEEP = copie de la routine ;
  - A10 25 min → récupération active (D ne connaît pas le minimum de 22 min) ;
  - mobilité manuelle refusée explicitement.
- **Web de D** :
  - routine affichée, mais en **lecture seule** : la complétion guidée est impossible ;
  - Force au poids du corps exécutée comme avant, sans conseil.
- **Écarts déjà connus, non PHYS-04** : D n'ajoute pas le retour au calme Force (PHYS-01.1).
- **Condition d'un rollback complet** :
  - `docs/release/phys04-rollback/ROLLBACK_TO_D_PRECONDITION.sql` (lecture seule, agrégée, exécutée par Louis) renvoie 0 pour le fractionné, la puissance et la mobilité ;
  - les secrets sont retirés.
- **Désactiver l'option** = retirer le secret : aucun plan n'est modifié.

## 5. Paramètres sportifs PROVISIONAL

| Paramètre | Valeur |
|---|---|
| Semaines avec mobilité | consolidation, 1 séance de 30 min, premier jour libre |
| Minimum A10 | 22 min (minimum de chaque bloc du protocole) |
| Référence des répétitions | ≤ 28 jours, même fourchette |
| Effort trop haut | RPE ≥ cible max + 2 |
| Progression | +1 répétition par série, plafonnée à la fourchette |
| Retenues | douleur, fatigue M1, dose de la semaine déjà augmentée |
| Formulations | notes, guide, messages |

## 6. Bloquants avant activation

1. **Variantes sans matériel** absentes du catalogue : au haut de la fourchette, la progression s'arrête. Il faut des variantes validées (tempo, pause, unilatéral…) et une règle de passage.
2. **Canon** : docs/03 §7 / §10 interdisent la progression fondée sur la performance réelle. La levée est à valider (G.5).
3. **Volume de la semaine de consolidation** : +30 min de mobilité, à valider avec l'intention d'allègement.
4. **Rollback** : le web de D ne peut pas terminer une mobilité guidée. Précondition à 0 requise.
5. **Validation qualifiée** des paramètres PROVISIONAL.
6. **Rappels PHYS-03** : garde serveur de complétion de la puissance avant toute activation de la puissance.

## 7. Propositions canoniques

Section **G** de `docs/release/PHYS_01_PROPOSED_CANON_DIFFS.md` : architecture, comportements, paramètres, décisions ouvertes, diffs pour docs/03 §5 / §7 / §10, 04, 05, 07 et 10 (T67). ADR PHYS-04 **PROPOSÉE** dans `docs/11_DECISION_LOG.md`. Aucun document canonique n'est modifié avant accord.
