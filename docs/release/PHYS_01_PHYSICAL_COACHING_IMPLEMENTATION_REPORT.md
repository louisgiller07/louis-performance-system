# PHYS-01 — PHYSICAL COACHING IMPLEMENTATION REPORT

**Date** : 2026-10-15 · **Pour** : HPM (via Louis)

**Branche** : `feat/phys-01-physical-coaching`, créée depuis le candidat D `649a0a2` (worktree `D:\nx\phys01`).
- Local uniquement : aucun push, déploiement ni accès à Supabase Production.
- REL-01 (C, D), P0-SAFE et les fonctionnalités DH ne sont pas modifiés.

**Verdict : `PARTIAL`**
- **Le parcours vertical Force est `READY LOCAL`** : nouveau rider → plan → check-in → séance haut du corps → guidage → enregistrement → historique → prochaine séance. Il est prouvé de bout en bout sur une base locale et par la vraie fonction `daily-run`.
- **Endurance, puissance et mobilité** : à étendre (§5).
- **Canon** : la gouvernance demande l'approbation des diffs proposés (docs/03, 04, 05, 07, 10).

## 1. Ce que V2 sait déjà faire (candidat D, avant PHYS-01)

Il ne faut pas confondre V2 avec V1 (audit externe du 12.10) : en V1, la séance est une intention ; en V2, la séance est déjà détaillée.

| Domaine | Déjà en place |
|---|---|
| **Force** | 6 gabarits (bas et haut du corps × débutant, intermédiaire, avancé). <br>Échauffement : 2 mobilités et 1 activation, avec séries, mesure, repos et consigne. <br>3 exercices de travail choisis selon le niveau puis le **matériel** (liste ordonnée de variantes : sans matériel, élastiques, haltères, barre, poulie). <br>Séries, répétitions, **RPE**, **repos** selon le rôle et le palier de dose (léger, modéré, surcharge). <br>Montée en charge du mouvement principal ; consignes et vigilances. |
| **Progression du plan** | Bloc de 6 semaines : introduction → développement → surcharge → consolidation. Rôles avant course : spécifique, affûtage, course. Maintien de la progression après des séances manquées ; Force plafonnée à MODERATE pour un débutant. |
| **Adaptation du jour** | M1 (check-in : sommeil, fatigue, douleur…) produit KEEP, MODIFY (dose légère), REPLACE ou REST. Le temps du jour (A10) est pris en compte. P0-SAFE (signal de santé → repos). Séances manuelles (P0-3). |
| **Endurance** | Protocole de base : échauffement 10 min, corps 30–75 min à RPE 3–4 avec test de la parole, retour au calme 5 min. Modalité au choix selon les créneaux vélo. **+15 min par cycle**, jusqu'à 90. |
| **Récupération** | Récupération active (20–40 min, RPE 2–3, mobilité légère, respiration). |
| **Guidage et enregistrement** | Force série par série : répétitions ou durée, **RPE ressenti**, **charge utilisée en kg**, corrections, invariant de complétion. Modules DH, endurance et récupération. Historique (P0-4). |

## 2. Lacunes réellement démontrées

| # | Lacune | Preuve |
|---|---|---|
| L1 | **Aucun conseil de charge.** Les charges, répétitions et RPE enregistrés n'étaient lus par aucun moteur. | Aucun lecteur de `exercise_set_results` hors du pont M1, qui ne compte que les séances terminées. Canon : « jamais une charge calculée par NALYNT » (docs/05), « Pas de progression fondée sur la performance réelle » (docs/03 §10). |
| L2 | **Durée irréaliste et pas de Force à 30 min.** La durée affichée était le créneau du planificateur (45 ou 60 min) ; sous A10 : « Aucune Force plus courte ». | Contenu mesuré : LIGHT 28–30, MODERATE 35–41, surcharge 43–49 min. Un rider qui a 30 min recevait de la récupération active, alors que la Force légère tenait presque. |
| L3 | **Pas de retour au calme** en Force. | Blocs du constructeur : échauffement, principal, complémentaires. |
| L4 | **Puissance / explosivité absentes.** | `POWER` n'est pas construit ; la famille pliométrique est exclue des gabarits. |
| L5 | **Mobilité (séance) et fractionné non générés.** | Les protocoles `mobility_routine_v1` et `endurance_intervals_3min` existent au catalogue, mais aucun constructeur ne les produit. |
| L6 | **Progression au poids du corps** non gérée (le débutant n'a pas d'exercice chargé). | Aucune règle « haut de la fourchette → variante plus dure ». |
| L7 | **Chronomètre de repos** absent du guidage (le repos s'affiche seulement en texte). | `StrengthSessionModule`. |
| L8 | **Les nouveaux riders sont en V1** en production (flag et assignation V2). | Le parcours PHYS-01 ne sert qu'aux riders V2 : l'activation de V2 est une décision séparée. |

## 3. Le parcours implémenté (local)

**Moteur** (`planning-engine`, agrégat **`session-model-v2.7`**, règles PROVISIONAL)

- **Retour au calme** de chaque Force (gabarits v2.2) :
  - mobilité de la zone chargée (hanches pour le bas du corps, colonne pour le haut du corps), jamais un exercice de l'échauffement ;
  - puis une respiration à expiration longue.
  - Uniquement des exercices et une consigne existants : aucun nouvel identifiant de contenu.
- **Durée réelle d'une Force**, estimée à partir de son contenu, avec des bornes hautes prudentes : séries × (mise en place + travail), repos, transitions, montée en charge. Avec le retour au calme :

| Palier | Durée estimée |
|---|---|
| LIGHT | 36–40 min |
| MODERATE | 44–51 min |
| Surcharge | 51–58 min |
| Force courte | 26–28 min |

  Tout reste dans les créneaux du planificateur, qui sont inchangés.
- **Force courte**, quand le rider a peu de temps :
  - même gabarit, échauffement et exercices ;
  - dosage LIGHT ; exercice principal et secondaire ; mobilité du retour au calme.
  - Échelle sous A10 : dose prévue → LIGHT → courte → récupération → repos. La charge ne monte jamais, et la filiation au plan se fait par exercice.
- **Conseil de charge** (`strength-load-guidance-v1`), calculé uniquement à partir des séries enregistrées dans des séances terminées :

| Situation | Conseil |
|---|---|
| Aucun historique | **calibration** par l'effort (répétitions en réserve tirées du RPE cible), sans chiffre |
| Fourchette différente, ou référence de plus de 28 jours | **repère** : la dernière charge est montrée, jamais convertie |
| Même fourchette | **cible**, un cran au plus (barre ou poulie 2,5 kg, kettlebell 4 kg, haltères 2 kg) : +1 si toutes les séries prescrites sont au haut de la fourchette dans l'effort ; −1 si une série est sous la fourchette ou si le RPE atteint la cible + 2 ; sinon la même charge |

  Jamais de 1RM, de % ni de valeur du profil. Le conseil n'est validé que sur un exercice de travail d'une prescription **finale** ; partout ailleurs, `forbidden_load_field` reste en vigueur.

**Head Coach** (couche Supabase seulement ; M1 figé intact)
- La réconciliation V2 lit l'historique, sur 56 jours, des exercices de travail chargés.
- Elle attache le conseil, le valide et le persiste avec la prescription du jour.
- Le conseil est consultatif : un échec de lecture ne bloque jamais la décision (avertissement stable).
- Il est exclu de l'empreinte « sport » : un KEEP garde le contenu prévu.

**Web**
- Lecture de v2.7, v2.6 (plans actuels) et v2.5 ; un manifeste inconnu est toujours refusé.
- Le conseil s'affiche sur la carte du jour et dans la séance guidée (titre et raison en mots simples).
- La charge conseillée apparaît à côté du champ « charge », sans jamais pré-remplir la saisie.
- Le retour au calme s'affiche en lecture seule.

**Exemple réel** (pilote B, base locale)

| Séance | Ce qui est fait ou conseillé |
|---|---|
| 1 | Développé couché : 3 × 8–10, calibration. Le rider fait 3 × 10 à 50 kg. |
| 2 | 4 × 6–8. Conseil : « Charge : repère 50 kg (dernière séance) » et ajustement à l'effort. Le rider fait 4 × 8 à 55 kg, RPE 8. |
| 3 | 5 × 6–8. Conseil : « **Charge conseillée : 57,5 kg (+2,5 kg)** », car toutes les séries ont atteint le haut de la fourchette. |

## 4. Tests et preuves

| Suite | Résultat | Sur D |
|---|---|---|
| planning-engine | **932/932** | 883 |
| head-coach-engine, avec base locale et runtime Edge | **1440 réussis, 25 ignorés**, 1 échec instable de timing (`p0_3PlannedSessionLock`, deux connexions SQL) : 10/10 deux fois en isolé ; PHYS-01 ne touche pas ce code | 1455 tests |
| web, intégrations comprises | **2286/2286** | 2274 |
| prescription-engine | **96/96** | 96 |
| Build de release (`build:release:all`) | OK ; bundle web avec variables factices : PHYS-01, P0-SAFE, D et P1-TXT-01 présents | — |

**Bout en bout** (stack isolée `nalynt-phys01`, 74 migrations de D, cible vérifiée `[test-target] … verified`) :
- **A — débutant sans historique, sans matériel** : séance haut du corps complète (échauffement, 3 exercices avec séries, répétitions, RPE et repos, retour au calme). Aucun kilogramme.
- **B — avancé avec historique** : calibration, puis repère, puis +2,5 kg (tableau ci-dessus). Le conseil est persisté et identique à celui calculé.
- **C — 30 min, haltères seuls** : Force courte de 30 min au plus (bas du corps : squat goblet et soulevé de terre roumain), calibration sur les deux exercices.
- **D — signal de santé bloquant** : décision REST, signal actif, aucune prescription. La Force donnée plus tôt dans la journée ne peut plus être démarrée (refus serveur `final_prescription_not_current`, aucune exécution créée).
- **Chemin réel `daily-run` (Deno)**, appelé avec le jeton du rider : l'historique est lu et le conseil persisté.

Les tests Edge de C et D (P0-SAFE, UX-11R.9, BUG-V2-3, F-6C) passent tous : 24/24.

**Transition** : un plan v2.6 stocké garde son KEEP. Son MODIFY est un `catalog_mismatch` sûr, et sous 30 min il passe en récupération active.

## 5. Limites restantes, par catégorie

| Catégorie | Couvert | À étendre |
|---|---|---|
| Force | Complet pour le bas et le haut du corps (exercices chargés) | Progression au poids du corps (L6) ; chronomètre de repos (L7) ; convention des haltères (par main ou total : le conseil suit celle du rider, à préciser à l'écran) ; Force courte aussi dans le planificateur pour les créneaux de 30 min ; durées du planificateur alignées sur le contenu (impact sur la charge M1, décision HPM) |
| Endurance | Base continue, RPE + test de la parole, +15 min par cycle | Fractionné (protocole présent, non généré) ; adaptation selon les résultats enregistrés |
| Puissance / explosivité | — | Famille et sessions `POWER` à construire, avec règles de récupération |
| Mobilité / récupération | Récupération active ; retour au calme de la Force | Séance `MOBILITY` (protocole présent, non généré) |

**Toutes les règles et valeurs sont PROVISIONAL.** Un préparateur physique qualifié doit les valider avant commercialisation.

## 6. Schéma et migrations

- **Aucune migration, aucune RPC modifiée**, aucune nouvelle table ni colonne.
- Le conseil vit dans `decision_final_prescriptions.structure`. La base ne vérifie que « structure = objet ». Le serveur d'exécution ne compte que les blocs `main` et `complementary` : le retour au calme n'est donc jamais une série de travail.
- **Edge** : seules `daily-run` et `generate-training-plan` changent.

| Fonction | Graphe | Bundle |
|---|---|---|
| `daily-run` | `4b6a41ab…` | `f72734d7…` |
| `generate-training-plan` | `8484fa8b…` | `8847df47…` |

  `session-execution`, `completed-session`, `health-flag-resolution` et les autres ont les mêmes empreintes que D.

## 7. Plan d'intégration après REL-01

**Préalables** :
- D en production et clos ;
- diffs canoniques approuvés ;
- validation sportive (au minimum avant toute commercialisation).

**Ordre** (même logique que C → D : un runtime qui sait lire avant tout contenu nouveau) :
1. **Web PHYS-01** (push web) : il lit v2.5, v2.6 et v2.7. Sans contenu v2.7, c'est le même affichage qu'avec D, avec en plus le retour au calme et le conseil s'ils apparaissent. Rollback possible vers le web de D tant qu'aucun document v2.7 n'existe.
2. **`daily-run`** : retour au calme pour les plans v2.7, Force courte, conseil de charge.
3. **`generate-training-plan`** : les nouveaux plans sont en v2.7.

**Point de non-retour web** : dès le premier document v2.7. Le web de D ne lit pas v2.7 (liste blanche des manifestes), donc le retour arrière se fait seulement vers le web PHYS-01.

**Rollback Edge vers D** : possible, en mode dégradé.
- Un plan v2.7 garde son KEEP ; son MODIFY est un `catalog_mismatch`.
- Plus aucun conseil n'est produit ; les conseils déjà persistés sont ignorés par le serveur.

**Après l'étape 3** : régénérer le plan du compte Simulation (GO distinct), pour que son MODIFY fonctionne en v2.7.

**Contrôles** :
- empreintes Edge ci-dessus ;
- marqueurs web ;
- décodage des documents v2.6 de production ;
- surveillance de l'avertissement `phys01_load_guidance_history_unavailable`.

**Aucune activation V2 pour d'autres riders** sans décision séparée.

## 8. Décisions attendues

1. Approuver ou amender les diffs canoniques (`PHYS_01_PROPOSED_CANON_DIFFS.md`) et l'ADR PHYS-01 (`docs/11`, PROPOSÉE).
2. Valider l'ordre d'intégration après REL-01 (§7).
3. Prioriser les extensions : endurance (fractionné), mobilité, puissance, poids du corps, chronomètre de repos, durées du planificateur.
4. Prévoir la revue par un préparateur physique qualifié des valeurs PROVISIONAL :
   - doses et gabarits ;
   - pas de charge ;
   - seuils : 28 jours, RPE cible + 2 ;
   - estimation des durées.

**STOP.** Aucun déploiement sans GO HPM.
