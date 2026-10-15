# PHYS-01 — DIFFS CANONIQUES PROPOSÉS (non appliqués)

**Pour** : HPM et Louis. **Statut** : proposition. Conformément à CLAUDE.md, aucun de ces documents n'est modifié avant accord. Le code de la branche `feat/phys-01-physical-coaching` implémente ces règles en local, comme Louis l'a décidé (2026-10-15, option « implémenter + diff canon »). Il n'est fusionné nulle part.

Toutes les valeurs restent **PROVISIONAL** : validation par un préparateur physique qualifié avant toute commercialisation.

## docs/03_COACHING_MODEL.md

### §5 Prescription — « Aucune fausse précision »

```diff
-**Aucune fausse précision en V1** : jamais de charge en kg, de % de 1RM, de zone de fréquence cardiaque ni de % de FTP, même si des valeurs déclarées existent au profil. La charge utilisée sera une donnée apportée par le pilote, pas une cible calculée.
+**Aucune fausse précision** : jamais de % de 1RM, de 1RM estimé, de zone de fréquence cardiaque ni de % de FTP, même si des valeurs déclarées existent au profil.
+
+**Conseil de charge (PHYS-01, Force uniquement)** : sur un exercice de travail à charge externe (barre, poulie, kettlebell, haltères), la prescription du jour peut porter un conseil de charge. Il est tiré **uniquement des charges que le pilote a réellement enregistrées** dans ses séances terminées (double progression) :
+- aucun historique fiable → **calibration par l'effort** (répétitions en réserve issues du RPE cible), sans aucun chiffre ; le pilote note la charge utilisée ;
+- fourchette de répétitions différente, ou dernière référence de plus de 28 jours → la dernière charge est **montrée**, jamais convertie ;
+- sinon, **un cran au plus** : monter si toutes les séries prescrites ont atteint le haut de la fourchette sans dépasser l'effort cible ; descendre si une série est restée sous la fourchette ou si le RPE a atteint la cible + 2 ; garder dans tous les autres cas.
+Un exercice au poids du corps ou à l'élastique ne reçoit aucun conseil de charge. Le conseil est consultatif : il ne change ni la décision, ni le contenu, ni la dose.
```

### §7 Progression

```diff
-Les semaines d'affûtage avant course gardent la structure et réduisent le volume. Jamais « tu as réussi, donc +10 kg ». Une progression fondée sur la performance réelle demandera des données de réalisation et une décision séparée.
+Les semaines d'affûtage avant course gardent la structure et réduisent le volume. Jamais « tu as réussi, donc +10 kg » : la charge progresse d'**un cran** de matériel au plus (barre / poulie 2,5 kg, kettlebell 4 kg, haltères 2 kg), et seulement selon la règle de double progression du §5 (PHYS-01). Le volume et l'intensité restent pilotés par le rôle de la semaine (introduction, développement, surcharge, consolidation, affûtage).
```

### §10 Limites

```diff
-- Pas de charge en kg, de 1RM, de % de 1RM, de zone cardiaque ni de % de FTP. Les niveaux léger, modéré et lourd de la famille Force sont des intentions de séance, pas des charges.
-- Pas de progression fondée sur la performance réelle.
+- Pas de 1RM, de % de 1RM, de zone cardiaque ni de % de FTP. Les niveaux léger, modéré et lourd de la famille Force sont des intentions de séance, pas des charges ; seul le conseil de charge du §5 (tiré de l'historique du pilote) porte des kilogrammes.
+- Progression fondée sur la performance réelle : la charge de la Force seulement (§5). Ni les répétitions au poids du corps, ni l'endurance, ni la DH ne s'adaptent encore aux résultats enregistrés.
```

### Modèle de séance Force (structure)

```diff
+**Retour au calme (PHYS-01)** : chaque séance de Force se termine par la mobilité de la zone chargée (jamais un exercice déjà fait à l'échauffement), puis une respiration à expiration longue. Les exercices ont le rôle `cool_down` ; aucun résultat n'est demandé.
+
+**Force courte (PHYS-01)** : quand le pilote a peu de temps aujourd'hui, même gabarit et mêmes exercices au dosage léger, avec l'échauffement complet, l'exercice principal et le secondaire, et la mobilité du retour au calme. Elle n'est proposée que si sa durée estimée tient dans le temps donné.
```

## docs/04_DAILY_DECISION_ENGINE.md — A10 (temps disponible)

```diff
-  1. **Force** → dose LIGHT 45 min (mêmes exercices). Aucune Force plus courte.
+  1. **Force** → dose LIGHT (mêmes exercices), puis **Force courte** (PHYS-01 : principal + secondaire, retour au calme réduit). Sous A10, la durée d'une Force est l'**estimation de son contenu** (bornes hautes prudentes : séries × (mise en place + travail) + repos + transitions + montée en charge), jamais le créneau du planificateur ; cela vaut aussi pour la séance décidée avant la contrainte.
```

```diff
+- **Conseil de charge (PHYS-01)** : après la prescription A04 / A10, une Force reçoit le conseil de charge de ses exercices de travail chargés (docs/03 §5). Il est lu dans les séries enregistrées des exécutions **terminées** des 56 derniers jours, strictement avant la date de la décision. Il est consultatif : un échec de lecture laisse la prescription sans conseil (avertissement `phys01_load_guidance_history_unavailable`), sans jamais bloquer la décision. M1 n'est pas modifié.
```

## docs/05_DATA_MODEL.md

```diff
-*Charge* : la charge observée appartient à l'exécution, pas à la prescription. `load_kg` est une donnée réalisée, facultative, saisie par le pilote ; jamais une prescription, un objectif automatique ni une charge calculée par NALYNT.
+*Charge* : la charge observée appartient à l'exécution. `load_kg` est une donnée réalisée, facultative, saisie par le pilote. Depuis PHYS-01, elle alimente le **conseil de charge** de la prescription du jour (`loadGuidance`, docs/03 §5). Ce conseil est stocké dans `decision_final_prescriptions.structure`, sur l'exercice de travail concerné, avec la version de sa règle (`strength-load-guidance-v1`) et la référence dont il est tiré. Il n'existe jamais dans une prescription planifiée. Aucune nouvelle table ni colonne.
```

```diff
-- **Règles générales** : … aucun kg, %1RM, zone cardiaque, FTP ni watt …
+- **Règles générales** : … aucun kg, %1RM, zone cardiaque, FTP ni watt, à l'exception du `loadGuidance` d'un exercice de travail d'une prescription **finale** de Force (PHYS-01), validé à cet endroit seulement …
```

Phrase « Progression » du paragraphe sur `exercise_set_results` :

```diff
-*Progression* : ces données préparent la progression, mais aucune adaptation du moteur ne les utilise encore.
+*Progression* : la Force les utilise pour le conseil de charge (PHYS-01) : séries actives (une correction remplace son original), exécutions terminées seulement, mesure en répétitions. Aucune autre adaptation du moteur ne les utilise encore.
```

## docs/07_GLOSSARY.md

```diff
+**Conseil de charge** (`loadGuidance`) — Charge à utiliser aujourd'hui sur un exercice de travail de Force, tirée uniquement des charges que le pilote a enregistrées (double progression, un cran au plus). Modes : calibration (par l'effort, sans chiffre), repère (dernière charge montrée), cible (charge conseillée). Consultatif ; jamais un 1RM.
+
+**Force courte** — Variante de la séance de Force pour un jour où le pilote a peu de temps : mêmes exercices au dosage léger, principal + secondaire, retour au calme réduit. Proposée seulement si sa durée estimée tient dans le temps disponible.
```

## docs/10_TEST_PLAN.md

```diff
+### T64. PHYS-01 — coaching physique exécutable (Force)
+
+- **Durée** : chaque gabarit × matériel × dose tient dans le créneau du planificateur ; la Force courte tient en 30 min (pire cas 28) ; estimation déterministe.
+- **Retour au calme** : mobilité de la zone chargée puis respiration, jamais un exercice de l'échauffement ; aucun résultat demandé.
+- **A10** : 60 → LIGHT → Force courte → récupération → REST. La filiation de la Force courte se fait par exercice ; la charge ne monte jamais.
+- **Conseil de charge** : table de règles (sans historique, sans charge, ancien, autre fourchette, haut atteint, dans la fourchette, sous la fourchette, effort trop élevé, plancher d'un cran). Tie-break de la charge de travail ; seules les exécutions terminées et les séries actives comptent.
+- **Validation** : accepté seulement sur un exercice de travail d'une prescription finale de Force ; refusé ailleurs ; forme exacte.
+- **Bout en bout (stack locale)** : 4 pilotes (débutant sans historique, avancé avec historique sur 3 séances, 30 min avec haltères seuls, signal de santé bloquant) ; chemin Edge `daily-run` réel.
+- **Transition** : un plan v2.6 garde son KEEP ; son MODIFY est un `catalog_mismatch` ; le web lit v2.7, v2.6 et v2.5.
```
