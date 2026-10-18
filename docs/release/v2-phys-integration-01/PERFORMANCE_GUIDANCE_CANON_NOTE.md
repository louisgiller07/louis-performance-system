# Guidage fondé sur les performances réelles (PHYS-01 charge, PHYS-04 répétitions) — note de canon

**Date** : 2026-10-18 · **Pour** : HPM et Louis · **Statut** : NON AUTORISÉ à l'activation.

`docs/03` §10 dit : « Pas de progression fondée sur la performance réelle. » Cette règle est inchangée : rien n'a été modifié dans `docs/03`.

## 1. Ce qui existe dans le code intégré

| | Guidage de charge (PHYS-01, `strength-load-guidance-v1`) | Guidage de répétitions au poids du corps (PHYS-04, `bodyweight-reps-guidance-v1`) |
|---|---|---|
| Où | `loadGuidance` sur un exercice de travail d'une prescription finale de Force | `repsGuidance` sur un exercice de travail au poids du corps |
| Entrées | `exercise_set_results` du rider : séries actives (corrections appliquées), `done`, répétitions (`measure_value`), `load_kg`, `rpe_actual`, sur 56 jours, **même exercice du catalogue** | mêmes séries, répétitions et RPE, sans charge |
| Règle | double progression : pas de charge connue → calibrer ; référence (dernière séance de cette fourchette, moins de 28 jours) → un pas de plus, de moins ou la même charge ; jamais un 1RM ; un pas au plus | une répétition de plus au plus par séance dans la fourchette ; au haut de la fourchette, exercice conservé |
| Retenue | douleur au check-in ou signal de fatigue M1 → aucune hausse (`todayLoadHold`) ; une baisse n'est jamais retenue | idem |
| Nature | conseil seulement : la dose prescrite, la décision et le contenu ne changent pas | conseil seulement |
| Interrupteur | `NALYNT_V2_PHYS_PERFORMANCE_GUIDANCE_ENABLED`, actif **seulement** avec `NALYNT_V2_PHYS_DAILY_ENABLED` | idem |

Flags absents (état par défaut) : aucune lecture de l'historique, aucun champ écrit, aucun affichage.

## 2. Limites

- **Paramètres PROVISIONAL**, sans validation par un préparateur qualifié :
  - pas de charge ;
  - âge de référence (28 jours) ;
  - marge d'effort (2 points de RPE) ;
  - fenêtre de 56 jours ;
  - une répétition par séance.
- **Qualité des données** : saisie libre de la charge et des répétitions. Une erreur de saisie produit un conseil faux, borné à un pas.
- **Séances partielles** (PARTIAL-01) : une séance arrêtée tôt peut servir de référence si ses séries sont réalisées. La règle ne lit que les séries réalisées, jamais un taux de réalisation.
- **Variantes** : un autre identifiant d'exercice n'est jamais comparé. Il n'y a aucune variante au poids du corps dans le catalogue (PHYS-04).
- **Unité** : un haltère par main, sinon la charge totale. Une confusion de saisie fausse la référence.
- **Pas de fatigue cumulée** : la charge des jours précédents, au-delà des signaux M1 du jour, n'est pas relue.

## 3. Risques

- **Progression trop rapide** si la saisie surestime la performance. Bornée à un pas par séance.
- **Contradiction de canon** tant que `docs/03` §10 n'est pas modifié. C'est la raison du verrou.
- **Confiance excessive** dans un conseil chiffré non validé sportivement.

## 4. Conditions d'activation

1. **Décision HPM** sur les diffs de canon proposés (`PHYS_01_PROPOSED_CANON_DIFFS.md` §7 / §10 et G.5). Le canon est modifié **avant** le code.
2. **Validation qualifiée** des paramètres du § 2 par un préparateur physique.
3. **Essais internes** sur le compte de simulation, avec les deux flags ON, sur plusieurs semaines de saisies réelles.
4. **Tests** :
   - ceux qui existent : guidage, retenue, bornes ;
   - à ajouter si les paramètres changent : la contre-preuve flag OFF, c'est-à-dire aucune lecture ni aucun champ.
5. **Activation par flag**, d'abord limitée aux pilotes (procédure d'affectation V2 existante).
