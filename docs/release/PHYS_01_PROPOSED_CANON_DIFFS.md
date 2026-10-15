# PHYS-01.1 — DIFFS CANONIQUES PROPOSÉS (non appliqués)

**Pour** : HPM et Louis. **Statut** : proposition, révisée par PHYS-01.1 (2026-10-15).
- Conformément à CLAUDE.md, aucun document canonique n'est modifié avant accord.
- La branche `feat/phys-01-physical-coaching` implémente ces règles en local seulement.
- Ce document remplace la version PHYS-01 (`5ec0976`) : il n'y a plus de changement de version du Session Model.

## 0. Résumé en quatre catégories

### A. Comportement effectivement implémenté (local, testé)

1. **Format inchangé.**
   - Le Session Model reste `session-model-v2.6`, avec les mêmes versions de composants.
   - Un plan (prescription planifiée) est identique à celui de D : démontré sur le code de D.
2. **Retour au calme de la Force.** Il est ajouté chaque jour à toute prescription finale de Force, jamais au plan :
   - mobilité de la zone chargée (bas du corps : `hip_flexor_mobility` ; haut du corps : `cat_cow`), puis `breathing_long_exhale` ;
   - consigne `instruction.recovery.light_mobility` ;
   - uniquement des identifiants existants ; aucun résultat demandé.
3. **KEEP** : le contenu prévu est repris à l'identique, et le retour au calme est ajouté à la fin. Aucune règle d'adaptation, comme l'exige la base.
4. **Durée sous A10.** La durée d'une Force est l'estimation de son contenu, calculée avec des bornes hautes :
   - séries × (mise en place + travail), repos entre séries, transitions, montée en charge, retour au calme ;
   - cela vaut aussi pour la séance décidée avant la contrainte.
5. **Échelle A10 de la Force.** Toujours **à la dose décidée par M1** (jamais une dose plus légère pour une raison de temps), dans cet ordre :
   1. séance complète ;
   2. retour au calme réduit à sa mobilité ;
   3. retrait du dernier exercice accessoire, puis du suivant (3 → 2 → 1, le principal est toujours gardé) ;
   4. puis récupération active ;
   5. puis REST.

   L'échauffement et les repos ne sont jamais raccourcis. Règle `v2.time.strength_shortened`. La filiation au plan se fait par exercice.
6. **Conseil de charge** (`loadGuidance`, `strength-load-guidance-v1`), sur les exercices de travail chargés d'une prescription **finale** de Force.
   - Il est persisté dans `decision_final_prescriptions.structure`. Le web de D l'ignore.
   - Il est consultatif : un échec de lecture ne bloque jamais la décision (avertissement stable).
   - Il est exclu de l'empreinte sport.

### B. Nouvelles règles de progression (conseil de charge)

1. **Sources** : seules les séries actives (une correction remplace son original) des exécutions **terminées**, du **même exercice** (même identifiant), avant la date du jour, sur 56 jours.
   - Un set non fait, à 0 répétition ou à 0 kg n'est jamais une référence.
   - Une autre variante n'est jamais comparée : haltère et barre ne sont pas la même charge.
2. **Calibration** quand aucune charge n'a été notée : un objectif d'effort (répétitions en réserve = 10 − RPE cible), **sans aucun chiffre**.
3. **Référence cible** : la dernière séance prescrite avec la **même fourchette de répétitions** que celle du jour, de moins de 28 jours. Sinon, la dernière charge est **montrée** (`different_dose` ou `history_too_old`), jamais convertie.
4. **Un cran au plus.** Le cran dépend du matériel : barre et poulie 2,5 kg (total), kettlebell 4 kg, haltères 2 kg (**par haltère**).

   | Situation à la référence | Conseil du jour |
   |---|---|
   | RPE ≥ cible + 2 | −1 cran |
   | Une série sous la fourchette | −1 cran |
   | Toutes les séries prescrites au haut de la fourchette, effort dans la cible (ou RPE non noté) | +1 cran |
   | Autrement | même charge |

   Jamais sous un cran.
5. **Une seule progression à la fois** : si la dose du jour est plus lourde que celle de la référence (plus de séries ou RPE cible plus haut), la hausse est **retenue** (`hold: dose_up`).
6. **État du jour** : une douleur déclarée (toute intensité) ou un signal de fatigue M1 (C3.3, C3.5, C3.6, C3.7) retient la hausse (`hold: pain` / `fatigue`). Une baisse n'est jamais retenue.
7. **Débutants** : aucun exercice chargé n'existe dans les gabarits débutants, donc jamais de kilogramme.

### C. Règles qui demandent une validation sportive qualifiée

- **Seuils et paliers** : 28 jours, RPE cible + 2, crans (2 / 2,5 / 4 kg), « RPE non noté → la répétition décide ».
- **Estimation des durées** : 4 s par répétition, 10 s de mise en place, 60 s de transition, montée en charge 2 × (30 + 60 s), bornes hautes des repos.
- **Contenu** : composition du retour au calme ; ordre de l'échelle A10 (dose gardée, accessoires retirés depuis la fin).
- **Signaux** : choix des règles M1 qui retiennent une hausse.

### D. Décisions produit encore ouvertes

1. **Créneaux du planificateur** (45 / 60 min) ou durée réelle du contenu affichée en permanence. Impact : charge récente de M1.
2. **Charges disponibles du rider** (plaques, haltères) à déclarer au profil, pour remplacer « prends la plus proche ».
3. **Exercices au poids du corps** : progression (répétitions puis variante plus dure). Aujourd'hui, aucun conseil.
4. **Correspondances entre variantes** (par ex. haltère ↔ barre), aujourd'hui volontairement absentes.
5. **Avertissement `phys01_load_guidance_history_unavailable`** : affichage au rider ou observabilité seulement.

## docs/03_COACHING_MODEL.md

### §5 Prescription

```diff
-**Aucune fausse précision en V1** : jamais de charge en kg, de % de 1RM, de zone de fréquence cardiaque ni de % de FTP, même si des valeurs déclarées existent au profil. La charge utilisée sera une donnée apportée par le pilote, pas une cible calculée.
+**Aucune fausse précision** : jamais de % de 1RM, de 1RM estimé, de zone de fréquence cardiaque ni de % de FTP, même si des valeurs déclarées existent au profil.
+
+**Conseil de charge (PHYS-01, Force uniquement, PROVISIONAL)** : sur un exercice de travail à charge externe, la prescription **du jour** peut porter un conseil de charge, tiré uniquement des charges que le pilote a réellement enregistrées pour **ce même exercice** (règles : docs/03 §7 et `docs/release/PHYS_01_PROPOSED_CANON_DIFFS.md` §B). Il est consultatif et ne change ni la décision, ni le contenu, ni la dose. Haltères : charge **par haltère** ; barre, poulie et kettlebell : charge totale. Poids du corps et élastiques : aucun conseil.
```

### §7 Progression

```diff
-Les semaines d'affûtage avant course gardent la structure et réduisent le volume. Jamais « tu as réussi, donc +10 kg ». Une progression fondée sur la performance réelle demandera des données de réalisation et une décision séparée.
+Les semaines d'affûtage avant course gardent la structure et réduisent le volume. Jamais « tu as réussi, donc +10 kg » : la charge progresse d'**un cran de matériel au plus**, selon la double progression du conseil de charge. **Une seule progression à la fois** : quand la semaine augmente déjà la dose (séries ou RPE cible), la charge attend. Aucune hausse un jour de douleur déclarée ou de fatigue détectée par M1.
```

### §10 Limites

```diff
-- Pas de charge en kg, de 1RM, de % de 1RM, de zone cardiaque ni de % de FTP. Les niveaux léger, modéré et lourd de la famille Force sont des intentions de séance, pas des charges.
-- Pas de progression fondée sur la performance réelle.
+- Pas de 1RM, de % de 1RM, de zone cardiaque ni de % de FTP. Les niveaux léger, modéré et lourd sont des intentions de séance ; seul le conseil de charge (§5), tiré de l'historique du pilote, porte des kilogrammes.
+- Progression fondée sur la performance réelle : la charge des exercices de Force chargés seulement. Ni le poids du corps, ni l'endurance, ni la DH ne s'adaptent encore aux résultats enregistrés.
```

### Modèle de séance Force

```diff
+**Retour au calme (PHYS-01.1)** : chaque séance de Force **du jour** se termine par la mobilité de la zone chargée (jamais un exercice de l'échauffement), puis une respiration à expiration longue. Il n'est pas inscrit dans le plan (le format du plan est inchangé). Aucun résultat n'est demandé.
```

## docs/04_DAILY_DECISION_ENGINE.md — A10

```diff
-  1. **Force** → dose LIGHT 45 min (mêmes exercices). Aucune Force plus courte.
+  1. **Force** (PHYS-01.1) → **même dose** que celle décidée par M1 : retour au calme réduit à sa mobilité, puis retrait du dernier exercice accessoire, puis du suivant (le principal est toujours gardé). Jamais un repos raccourci, jamais un exercice d'échauffement retiré, jamais une dose plus légère pour une raison de temps. La durée d'une Force est l'**estimation de son contenu**, jamais le créneau du planificateur ; cela vaut aussi pour la séance décidée avant la contrainte.
```

```diff
+- **Retour au calme et conseil de charge (PHYS-01.1)** : après A04 / A10, toute prescription de Force du jour reçoit son retour au calme, et ses exercices chargés leur conseil de charge. Le conseil est lu dans les séries des exécutions **terminées** des 56 derniers jours, avant la date ; il est retenu un jour de douleur ou de fatigue M1. Consultatif : un échec de lecture laisse la prescription sans conseil (avertissement `phys01_load_guidance_history_unavailable`). M1 n'est pas modifié.
```

## docs/05_DATA_MODEL.md

```diff
-*Charge* : la charge observée appartient à l'exécution, pas à la prescription. `load_kg` est une donnée réalisée, facultative, saisie par le pilote ; jamais une prescription, un objectif automatique ni une charge calculée par NALYNT.
+*Charge* : la charge observée appartient à l'exécution. `load_kg` est une donnée réalisée, facultative, saisie par le pilote (haltères : par haltère). Depuis PHYS-01, elle alimente le **conseil de charge** de la prescription du jour (`loadGuidance` sur l'exercice de travail, dans `decision_final_prescriptions.structure`, avec la version de sa règle et la référence dont il est tiré). Il n'existe jamais dans une prescription planifiée. Aucune table, colonne ni version de catalogue nouvelle.
```

```diff
-- **Règles générales** : … aucun kg, %1RM, zone cardiaque, FTP ni watt …
+- **Règles générales** : … aucun kg, %1RM, zone cardiaque, FTP ni watt, sauf le `loadGuidance` d'un exercice de travail d'une prescription **finale** de Force (PHYS-01), validé à cet endroit seulement …
```

```diff
-*Progression* : ces données préparent la progression, mais aucune adaptation du moteur ne les utilise encore.
+*Progression* : la Force les utilise pour le conseil de charge (PHYS-01) : séries actives, exécutions terminées, mesure en répétitions, même exercice. Aucune autre adaptation du moteur ne les utilise encore.
```

**Prescription du jour (KEEP)** :

```diff
-KEEP = copie verbatim de la prescription planifiée.
+KEEP = copie verbatim du contenu planifié, plus, pour une Force, le bloc de retour au calme ajouté à la fin et le conseil de charge de ses exercices chargés (PHYS-01.1). Aucune règle d'adaptation.
```

## docs/07_GLOSSARY.md

```diff
+**Conseil de charge** (`loadGuidance`) — Charge à utiliser aujourd'hui sur un exercice de travail de Force, tirée uniquement des charges que le pilote a enregistrées pour ce même exercice (double progression, un cran au plus, une seule progression à la fois). Modes : calibration (par l'effort, sans chiffre), repère (dernière charge montrée), cible (charge conseillée, éventuellement retenue). Consultatif ; jamais un 1RM.
+
+**Séance raccourcie** — Séance de Force adaptée au temps du jour : même dose, retour au calme réduit, puis derniers exercices accessoires retirés (le principal est toujours gardé).
```

## docs/10_TEST_PLAN.md

```diff
+### T64. PHYS-01 / PHYS-01.1 — coaching physique exécutable (Force)
+
+- **Compatibilité** : plan identique à celui du runtime précédent (même snapshot, mêmes ids). Le runtime précédent (code réel de D) fait KEEP et MODIFY sur des données PHYS-01.1. Le web précédent lit toutes les prescriptions PHYS-01.1, et refuse celles de PHYS-01 v2.7 (contre-preuve). Le retour vers PHYS-01.1 relit les séries enregistrées sous D.
+- **Durée** : chaque gabarit × matériel × dose tient dans son créneau ; une séance raccourcie contient échauffement, séries, repos, montée en charge, transitions et retour au calme.
+- **A10** : la dose de M1 est conservée ; une surcharge dont le principal seul ne tient pas → récupération ; la propriété « jamais plus que le temps donné » est vérifiée de 15 à 120 min.
+- **Conseil de charge** : table de règles (sources, calibration, référence de même fourchette, crans et unités, échec, effort, débutant, maintien `dose_up` / `pain` / `fatigue`, plancher) et validation de forme.
+- **Bout en bout (stack locale)** : débutant ; avancé sur 6 semaines (calibration → repère → maintien → +2,5 kg → maintien) ; 30 min avec haltères seuls ; signal de santé bloquant ; douleur légère ; chemin Edge `daily-run` réel.
```
