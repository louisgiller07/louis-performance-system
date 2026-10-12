# P0 première génération — diagnostic et options (décision HPM requise)

**Pour** : HPM, décision sportive avant correction du moteur.
**Statut** : défaut reproduit sur le HEAD local (`fix/p0-first-generation`). Le message de refus est corrigé. La correction de fond **attend ta décision**.

## Cause racine (prouvée)

Le constructeur DH V2 (`planning-engine/src/sessionModelV2/builders/dhPrescriptionV2.ts`) applique la règle validée (docs/03 « Technique DH — règles V2 », ADR UX-11A.5b.0.1) :
- **un seul** drill par couple (compétence, niveau déclaré) ;
- ce drill exige **un seul** terrain (`requiredTerrain`, `planning-engine/src/catalog/sessionDrillCatalogV2.ts`) ;
- si ce terrain n'est pas déclaré : plan bloqué (`unavailable_dh_drill_terrain`). Aucun autre terrain, aucun autre niveau, aucune autre priorité.

Les terrains assignés sont plus étroits que ce que demandent les textes validés des drills.

| Profil (review 09.10) | Priorité / niveau | Drill | Terrain exigé | Terrains déclarés | Résultat |
|---|---|---|---|---|---|
| Tentative 1 | virages / intermédiaire | `cornering_berm_speed` | `bermed_trail` | technique, racines et rochers, piste DH | bloqué |
| Tentative 2 (+ relevés) | freinage / intermédiaire | `braking_late_entry` | `flow_trail` | + relevés | bloqué |
| Tentative 3 (freinage seul) | freinage / intermédiaire | `braking_late_entry` | `flow_trail` | idem tentative 1 | bloqué |
| Tentative 4 (tout) | — | — | — | tous | généré |

Le texte de `braking_late_entry` (« garde les freins jusqu'à juste avant l'entrée du virage… ») ne dépend d'aucun terrain particulier. Un sentier technique ou une piste DH offrent des entrées de virage.

Même défaut pour un débutant : `braking_progressive_control` exige `any_groomed_trail` et refuse un flow trail.

## Contraintes canoniques

docs/03 (protégé) fixe :
- « **niveau de l'exercice** : **uniquement** le niveau technique DH déclaré » ;
- « **compétence** : **uniquement** depuis une priorité explicitement déclarée ».

Un repli vers un drill d'un autre niveau, ou vers une compétence non déclarée, change donc une règle canonique.

En revanche, la liste des terrains où un drill est réalisable est une **donnée du catalogue**. docs/03 ne la fixe pas, et ton mandat l'inclut explicitement (« compatibilité réelle des terrains »).

## Options

1. **Terrains compatibles par drill** (données du catalogue, aucune règle changée).
   - Chaque drill liste les terrains où ses consignes validées sont réalisables telles qu'écrites.
   - Le drill reste celui de (compétence, niveau). Le refus précis reste le filet pour les cas réellement impossibles.
   - Effet attendu :
     - A généré, si la piste DH complète est acceptée pour les virages relevés (voir tableau) ;
     - B généré ;
     - C et D inchangés ;
     - E toujours refusé, avec le message précis (correct : aucun terrain inventé).
2. **Repli vers un drill plus facile de la même compétence** (régression `regressesTo`), jamais plus difficile, avec explication sur la séance.
   - Modifie la règle « niveau uniquement déclaré » de docs/03 (diff à valider).
   - Seule, elle ne résout pas A : le drill virages débutant exige lui aussi un terrain non déclaré. Elle dépend donc de l'option 1.
3. **Nouveau contenu** : un drill virages intermédiaire sans virage relevé, par exemple sur sentier technique ou piste DH.
   - Meilleure qualité sportive pour A, mais extension du catalogue : textes à valider par un coach. Ticket séparé.
4. **Repli vers une autre priorité déclarée**, voire une autre compétence.
   - Contredit la règle de compétence de docs/03 et dégrade l'orientation du programme.
   - Non recommandé.

**Recommandation** : option 1 avec le tableau ci-dessous. Garder le refus précis (déjà livré) pour les cas réellement impossibles. Option 3 plus tard si la qualité l'exige.

## Tableau proposé (option 1) — à valider sportivement

Principes :
- un drill **débutant** reste sur des terrains roulants (aménagé, flow, relevés) ;
- un terrain n'est ajouté que s'il offre **toujours** l'élément exigé par les consignes (virage, zone de freinage, section technique…).

| Drill | Niveau | Terrain actuel | Terrains proposés | Justification |
|---|---|---|---|---|
| `braking_progressive_control` | débutant | aménagé | aménagé, flow, relevés | zone de freinage marquée sur sentier roulant |
| `braking_late_entry` | intermédiaire | flow | flow, aménagé, relevés, **technique**, **piste DH** | une entrée de virage existe partout |
| `braking_marked_zone_at_speed` | avancé | technique | technique, **piste DH** | zone de freinage avant un passage technique |
| `cornering_flat_turn_precision` | débutant | flow | flow, aménagé | virage plat roulant |
| `cornering_berm_speed` | intermédiaire | relevés | relevés, **flow**, **bike park**, **piste DH** | **à valider** : ces terrains comportent-ils toujours des virages relevés ? |
| `cornering_off_camber` | avancé | technique | technique, **pente raide**, **piste DH** | **à valider** : dévers garanti ? |
| `race_execution_section_consistency` | débutant | aménagé | aménagé, flow, relevés | section roulante chronométrable |
| `race_execution_split_pace` | intermédiaire | technique | technique, **piste DH** | section technique avec repère |
| autres (choix de ligne, raide, racines et rochers, sauts, simulation complète) | — | inchangé | inchangé | terrain spécifique à la compétence |

Pour A, seule la ligne `cornering_berm_speed` → piste DH conditionne le succès. Si tu la refuses, A reste refusé avec le message précis : il faudra l'option 2 ou 3.
