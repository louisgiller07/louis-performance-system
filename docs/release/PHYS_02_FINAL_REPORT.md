# PHYS-02 — RAPPORT FINAL (endurance, fractionné, repli LIGHT)

**Pour** : HPM et Louis. **Date** : 2026-10-15. **Branche** : `feat/phys-02-endurance` (local), après `869d3c6` (PHYS-02) et `71007c7` (PHYS-02.1).
Aucun push, déploiement, activation du fractionné, migration ni modification de REL-01. M1 inchangé.

## Verdict

**READY LOCAL.**

## Dernier correctif : douleur localisée et activité du repli

**Protections existantes vérifiées.**
- **P0-SAFE (A1–A7)** : REST, aucune séance. Il passe avant tout.
- **Règle douleur non-safety de M1** : classe la zone (haut du corps / membres inférieurs / autre) et dit si un *type de séance* la sollicite. L'endurance sollicite les membres inférieurs ; une douleur sans localisation est traitée avec prudence.
- **Aucune donnée ne relie une activité précise** (course, vélo, home-trainer) à une zone du corps. Les limitations déclarées ne sont lues par aucun builder V2.

**Comportement implémenté** (aucune règle médicale nouvelle) :
- **Repli proposé** : seulement si la douleur du jour, s'il y en a une, est libérée par cette règle existante (zone haut du corps / préhension, que l'endurance ne sollicite pas). La règle M1 est appelée en lecture seule.
- **Douleur au genou, à la cheville, à la hanche…, sans localisation, ou dans une zone non classée (dos, cou…)** : aucune activité n'est proposée.
  - La décision de M1 reste visible (MODIFY, fractionné, LIGHT).
  - La prescription du jour est bloquée avec la raison `intervals_fallback_pain_not_cleared` et la catégorie de zone.
  - La trace `V2_INTERVALS_LIGHT_FALLBACK` indique « repli non proposé ».
  - Le web affiche : « Tu as signalé une douleur que l'endurance solliciterait. NALYNT ne sait pas encore quelle activité la ménage : aucune séance n'est proposée aujourd'hui à la place du fractionné. »
- **Sans contrainte de santé** : inchangé (nuit courte, jambes → endurance fondamentale LIGHT 45 min).
- **REST reste REST**, P0-SAFE passe avant, M1 n'est pas modifié.

## Tests

| Suite | Résultat |
|---|---|
| planning-engine | **966/966** |
| head-coach-engine, secret fractionné OFF (conditions de D) | **1499/1499**, 151 fichiers, 0 ignoré, 71 preuves de cible `nalynt-phys02` |
| head-coach-engine, secret ON | **1499/1499**, 151 fichiers, 0 ignoré, 71 preuves de cible |
| web (intégrations) | **2298/2298**, 23 preuves de cible. Un premier passage avait 7 fichiers d'intégration en échec, parce que j'avais arrêté le runtime Edge local avant le lancement (« Local Edge runtime is not serving ») ; relancé avec le runtime : vert. |
| prescription / longitudinal | **96/96** / **890/890** |
| web réel de D | **8/8** |
| Builds | OK |

**Régressions ciblées** :
- **Douleur localisée** : genou → aucune activité ; sans localisation + 30 min → aucune activité (pas de récupération choisie à la place) ; zones non classées → aucune activité ; poignet + nuit courte → repli inchangé. Testé en unitaire, en intégration et via le runtime Edge Deno.
- **Absence de douleur** : repli inchangé.
- **Activité alternative non disponible** : jour sans créneau vélo + douleur non libérée → aucune activité hors terrain proposée non plus.
- **Signal santé bloquant** : A4 et A6 → A7 → REST, aucun repli.

## Limites restantes

- Proposer une activité compatible avec une douleur demanderait une donnée activité → zones sollicitées, validée par un professionnel. Elle n'existe pas.
- Deux cas analogues relèvent du comportement existant de D, non modifié ici :
  - l'endurance fondamentale *prévue* un jour de douleur garde ses activités prévues ;
  - un fractionné gardé (KEEP) avec une douleur non classée.
- Paramètres sportifs PROVISIONAL : génération 6 × 3 min (non activée), repli 45 min, mots au rider, catégories de zones libérantes.
