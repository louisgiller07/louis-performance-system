# SPORT_SAFE_01R2_DECISION_PACK — arbitrage A10 et préparation de l'intégration

**Date** : 2026-10-19 · **Pour** : HPM et Louis · **État : HOLD.** Une seule décision HPM est attendue : option A ou B (§1).

Tout reste local, sur la branche `fix/sport-safe-01` (depuis `99d2add`) : aucun push, merge, déploiement, migration ni flag. Le canon (`docs/01` à `docs/10`) n'a pas été modifié depuis `99d2add` : les textes ci-dessous sont des **propositions**.

---

## 1. A10 après un refus §6 — deux contrats

### Cas de référence (trace réelle, rapport SPORT-SAFE-01R §1)

Endurance prévue MODERATE 45 min. M1 décide MODIFY LIGHT 45 (C3.3, C3.6 ou douleur non-SAFETY sollicitée). A04 ne peut pas faire plus léger que la dose prévue : `modify_not_supported`. Le rider a indiqué 30 min.

### Canon actuel (`docs/04`, ADR A10, inchangé)

> - **Condition :** X renseigné, et une prescription du jour V2 créée qui demande plus de X minutes (sa durée effective, ou la somme des bornes hautes de ses blocs).
> - **Priorité :** la contrainte s'applique après M1, `V2_SYSTEMIC_FLOOR` et la prescription A04. Elle part de la séance déjà décidée et ne fait que descendre.
>   - Un REST de M1 reste REST.
>   - Une prescription bloquée reste bloquée (`not_evaluated`).

> (section « Prescription du jour V2 et MODIFY vers le haut ») Aucune augmentation automatique, et jamais la dose prévue rebaptisée « modifiée ».

### Option A — canon strict conservé

**Texte proposé** (`docs/04`, deux ajouts ; A10 n'est pas modifié sur le fond) :

Dans « Prescription du jour V2 et MODIFY vers le haut », après « Aucune augmentation automatique… » :
```diff
+Un `MODIFY` dont le contenu sportif serait exactement celui de la séance de référence ne produit pas non plus de
+prescription du jour V2 (ADR SPORT-SAFE-01) : `blocked` / `final_prescription_adaptation_not_defined` /
+`modify_not_supported`. Séance de référence : la prescription prévue ; pour une séance manuelle (P0-3), le document
+que son KEEP recevrait (séance avant M1). Cas atteints : endurance déjà à la durée LIGHT de la politique (45 min, RPE
+du protocole fixe), endurance manuelle, DH manuelle HEAVY.
```
Dans A10, « Priorité » :
```diff
   - Une prescription bloquée reste bloquée (`not_evaluated`).
+  - Cela vaut pour le refus `modify_not_supported` ci-dessus, même quand la séance décidée par M1 dépasse X. Le rider
+    voit le temps qu'il a indiqué, la durée de la séance décidée, et qu'aucune séance guidée n'est proposée.
```

**Ordre et états :**

| Étape | Résultat |
|---|---|
| M1 | MODIFY AEROBIC_BASE LIGHT 45 (décision et consignes inchangées) |
| A04 | `blocked` / `final_prescription_adaptation_not_defined` / `{ reason: "modify_not_supported", planned: "MODERATE", final: "LIGHT", durationMin: 45 }` |
| A10 | `not_evaluated`. Trace : « Temps disponible : 30 min. Avant : MODIFY AEROBIC_BASE LIGHT 45 min. Action : not_evaluated. » |
| Persisté | `decisions` : MODIFY LIGHT 45, statut `blocked` ; aucune ligne `decision_final_prescriptions` |
| Rider | Aujourd'hui : « Prévu 45 min → Adapté 45 min (charge légère) » et la protection de M1. Séance guidée : le message `modify_not_supported` (§3, prêt). **À ajouter :** le message de disponibilité (§3), sans quoi les 30 min ne sont dites nulle part |

C'est l'état actuel de la branche (`4181de5`). Il ne manque que le message de disponibilité.

### Option B — amendement contrôlé

**Texte proposé** (`docs/04`, A10) — en plus de l'ajout §6 de l'option A, identique :
```diff
-- **Condition :** X renseigné, et une prescription du jour V2 créée qui demande plus de X minutes (sa durée effective, ou la somme des bornes hautes de ses blocs).
+- **Condition :** X renseigné, et une prescription du jour V2 créée qui demande plus de X minutes (sa durée effective,
+  ou la somme des bornes hautes de ses blocs) ; ou un `MODIFY` refusé faute de contenu plus léger
+  (`modify_not_supported`, ci-dessous) dont la séance décidée par M1 demande plus de X minutes.
@@
   - Un REST de M1 reste REST.
-  - Une prescription bloquée reste bloquée (`not_evaluated`).
+  - Une prescription bloquée reste bloquée (`not_evaluated`), sauf le refus `modify_not_supported` décrit ci-dessous.
+  - **Refus `modify_not_supported` et temps insuffisant (SPORT-SAFE-01R.2)** :
+    - le refus n'est pas effacé : il reste tracé comme résultat d'A04 ;
+    - A10 évalue ses candidats habituels, dans l'ordre ci-dessus, à partir de la séance décidée par M1 ;
+    - un candidat identique au document refusé (même contenu sportif et même durée) est écarté ;
+    - aucun candidat n'est plus chargé que la séance décidée ; si aucun ne tient, REST ;
+    - jamais sur un REST de M1, un signal de santé ou une autre raison de blocage ;
+    - la séance retenue est présentée par la phrase A10 existante (« raccourcie » ou « récupération active à la
+      place »), jamais comme un LIGHT de la séance refusée.
@@
 - **Traçabilité :**
+  - un refus `modify_not_supported` suivi d'A10 laisse deux traces : la règle `A04_MODIFY_NOT_SUPPORTED` (couche
+    `ARBITRATION` : séance refusée, raison) puis `V2_TODAY_TIME_CONSTRAINT` (séance avant = séance refusée, action,
+    séance après) ;
```

**Ordre et états :**

| Étape | Résultat |
|---|---|
| M1 | MODIFY AEROBIC_BASE LIGHT 45 (inchangé) |
| A04 | refus `modify_not_supported`, conservé dans le résultat (`refused`) et tracé (`A04_MODIFY_NOT_SUPPORTED`) |
| A10 | 30 < 45 : candidats endurance (paliers de 15 min, minimum 45) → aucun. Puis **récupération active** ≤ 30 min → retenue. Trace : « Avant : MODIFY AEROBIC_BASE LIGHT 45 min. Action : adapted → REPLACE RECOVERY_ACTIVE. » |
| Persisté | `decisions` : REPLACE RECOVERY_ACTIVE (comme A10 aujourd'hui), statut `created` ; ligne `replace`, règles `v2.replace.recovery_active`, `v2.time.today_limit` ; le refus figure dans `daily_plan.triggered_rules` |
| Rider | Comme la production aujourd'hui : « Tu as 30 min aujourd'hui : la séance prévue ne tient pas dans ce temps, récupération active à la place. » Séance guidée de récupération (20 min, RPE 2–3) avec les consignes de M1 (A1) |

C'est, pour ce cas, le document que la production (`99d2add`) et `5067a35` produisaient déjà. Seule la trace du refus s'ajoute.

### Effets sur les scénarios existants

| Scénario | Production `99d2add` | Option A (branche) | Option B |
|---|---|---|---|
| Prévue 45 + LIGHT, sans temps ou X ≥ 45 | fausse copie « allégée » | refus | refus |
| Prévue 45 + LIGHT, X = 20 ou 30 | récupération active (après la fausse copie) | refus, `not_evaluated` | récupération active, refus tracé |
| Prévue 60 + LIGHT, sans temps | 45 min réelles | 45 min réelles | 45 min réelles |
| Prévue 60 + LIGHT, X = 30 | récupération active | récupération active | récupération active |
| Manuelle 45 ou 60 + LIGHT, sans temps | fausse copie | refus | refus |
| Manuelle 45 + LIGHT, X = 30 | récupération active | refus, `not_evaluated` | récupération active |
| DH manuelle HEAVY 120 → MODERATE, X = 90 | DH 90 min, 6 passages, « raccourcie » | refus | DH 90 min (durée réellement plus courte, « raccourcie ») ; candidat écarté s'il est identique en contenu **et** en durée |
| KEEP, REPLACE, REST, Safety A1–A7, autres raisons de blocage | — | inchangés | inchangés |
| Différentiel flags OFF (47 970 cas planifiés) | référence | 192 différences : 32 sans temps, 96 « fits », 64 « adapted » | 128 différences ; les 64 cas « adapted » reviennent au document de production, avec la trace du refus en plus |

### Risques de contournement santé

| Risque | Option A | Option B |
|---|---|---|
| Séance proposée sous un signal de santé | aucun : moins de séances qu'en production | aucun : le chemin ne s'ouvre que sur un MODIFY ; tout REST de Safety (A1–A7, signal ouvert) reste REST avant A04 ; garde serveur P0-3 inchangée |
| Charge supérieure à la décision de M1 | aucun | aucun : les candidats A10 « ne font que descendre » ; la récupération active est plus légère que l'endurance LIGHT |
| Déclarer un temps court pour obtenir une séance guidée un jour d'allègement | sans objet | possible, mais on obtient une récupération active (moins de charge) : pas un contournement |
| Douleur non-SAFETY et récupération active | sans objet | **existant en production** : le contenu de récupération (mobilité) n'est pas filtré par zone douloureuse. Atténué par A1 (protection de M1 affichée au-dessus), à arbitrer avec A2 |

### Impact SQL, Edge, web, historique

| | Option A | Option B |
|---|---|---|
| SQL | aucun | aucun. `persist_daily_run_v2` exige seulement action = décision (A10 met déjà REPLACE) et aucune règle pour un KEEP |
| Edge | `daily-run` (bundle déjà modifié par la branche) | `daily-run` seulement : `todayTimeLimitV2` et la trace dans `applyV2TodayTimeConstraint`. Environ un jour de développement et de tests |
| Web | message de disponibilité à ajouter (§3) | aucun ajout nécessaire ; la phrase A10 et les consignes existent |
| Historique | jours bloqués : pas d'exécution V2 guidée possible | récupération enregistrable, comme en production |
| Rollback | revert de la branche | idem |

### Recommandation pour une bêta payante : **option B**

1. **Le temps déclaré est respecté.** Avec A, un rider fatigué qui a 30 min reçoit une consigne de 45 min et aucune séance guidée : une régression visible par rapport à la production, sur un cas courant (fatigue et peu de temps).
2. **Aucune séance identique n'est présentée comme adaptée.** Le refus est conservé et tracé. L'alternative est un autre type de séance ou une durée réellement plus courte, construite par la séquence A10 déjà canonique. Aucune dose nouvelle.
3. **La priorité santé reste entière.** Ni SQL ni changement web nécessaire.

Coût : un amendement canon exact, une petite modification de `daily-run` et ses tests. **Jusqu'à l'approbation, la branche reste en option A**, conforme au canon actuel.

---

## 2. Vérification des corrections locales

| Commit | Moteur V2 (planning-engine) | Adaptateur M2 (head-coach `src/supabase`) | Web | Docs | M1 |
|---|---|---|---|---|---|
| `5067a35` | `todayTimeLimitV2.ts` | — | — | 00, 11, 12, rapport | non |
| `4181de5` | `todayTimeLimitV2.ts` | — | — | 11 (ADR SPORT-SAFE-01 amendé) | non |
| `5ea811d` | `todayTimeLimitV2.ts`, `buildKeepFinalPrescriptionV2.ts` (champ additif `manualSession`) | `reconcileFinalPrescriptionV2.ts` | — | — | non |
| `ab6b3a3` | — | — | `dayGuidance.tsx`, `guidedSessionLoader.ts`, `GuidedSessionView.tsx`, `DecisionHero.tsx` | — | non |
| `609b8d8` | — | — | — | 00, 11 (ADR SPORT-SAFE-01R), 12, rapport, preuves | non |
| `b36317f` (R.2) | — | — | message `modify_not_supported` (copie, loader, vue) | — | non |
| `08fdc76` (R.2) | tests seulement | — | — | — | non |

M1 (`head-coach-engine/src/{types,engine,rules,domains,mapping}`) : 0 ligne. Migrations : 0.

**Pourquoi l'endurance manuelle de 60 min n'est pas réduite :**
- P0-3 (`docs/05`) construit la séance manuelle « pour le type et la charge finaux de M1 (mêmes builders que REPLACE) ».
- Le builder d'endurance prend `min(max(durée de M1, 45), 90)` et ignore la charge (RPE du protocole fixe).
- M1 garde 60 min. Le document LIGHT 60 est donc celui du KEEP.
- La règle A04 « durée LIGHT de la politique (45 min) » est définie pour le MODIFY d'une prescription **prévue**. L'appliquer aux séances manuelles serait une règle nouvelle, donc non faite. **Arbitrage B3 :** appliquer ou non la durée LIGHT A04 à une endurance manuelle.

**Le refus de la DH manuelle HEAVY ne suit pas le canon sans ambiguïté :**
- Le §6 (A04, `docs/04`) parle de la dose **prévue** ; une séance manuelle n'en a pas. La référence « document du KEEP » est une **interprétation** (`5ea811d`).
- Le document MODIFY MODERATE est un vrai document MODERATE. C'est le KEEP HEAVY qui est construit, sans le dire, à la dose MODERATE.
- P0-3 a décidé un refus explicite de la Force manuelle HEAVY (« jamais allégée en silence »), mais pas de la DH ni de l'endurance HEAVY.
- La correction est conservée, conformément à ta consigne : elle empêche de présenter une séance identique comme adaptée. Elle demande cependant ta validation explicite (texte §1, ajout §6).
- **Arbitrage B4 :** traiter la DH et l'endurance manuelles HEAVY comme la Force HEAVY (refus explicite dès le KEEP), ou garder le refus du seul MODIFY.

**Couverture des différences flags OFF par les tests :**
- **Planifié — couvert exactement.** Différentiel contre le runtime de production :
  - 47 970 cas, chacun identique ou égal au refus attendu, champ par champ ;
  - liste des clés **et** comptes épinglés (`08fdc76`) : 192 = 32 + 96 + 64.
- **Manuel sans la séance avant M1 — couvert.** 11 088 cas identiques.
- **Manuel avec la séance avant M1 — couvert sur une matrice synthétique :**
  - 1 848 MODIFY d'un cran de charge, sans durée ; forme exacte et comptes épinglés (66 refus par clé) ;
  - les durées réelles de M1 et le câblage de `reconcileFinalPrescriptionV2` sont couverts par les tests d'intégration (vrais chemins), pas par un différentiel.
- **Non couverts par un différentiel :**
  - les chemins PHYS ON (interrupteurs absents en production) ;
  - le web : A1 et le message s'appliquent quel que soit l'interrupteur, et sont couverts par des tests ciblés.

**`609b8d8` ne modifie aucun document canonique** (`docs/01` à `docs/10` inchangés). Il contient :
- du descriptif : statut, backlog, rapport, preuves ;
- l'ADR SPORT-SAFE-01R dans `docs/11`, registre que Claude Code peut tenir. Sa **forme est normative** : il énonce comme décisions l'ordre A04 → A10, la référence manuelle et le contrat A1. `4181de5` avait déjà amendé l'ADR SPORT-SAFE-01.
- Le commit de ce dossier ajoute à l'ADR une mention de statut : approuvé avec conditions, point 1 en arbitrage A/B, aucun texte canon modifié, effet normatif seulement après approbation du texte canon exact.

---

## 3. Cohérence visible par le rider

| Proposition | État |
|---|---|
| **Message spécifique `modify_not_supported`** (carte du jour et séance guidée) : « Ton état du jour demande d'adapter cette séance, mais NALYNT n'en a pas de version guidée plus légère que celle prévue : pas de séance guidée aujourd'hui. » Faits seulement : ni dose, ni RPE, ni conseil. Les autres raisons de blocage gardent leur message | **Prêt** (`b36317f`, avec tests). Texte à valider |
| **Disponibilité quand la séance est bloquée** (nécessaire en option A) : « Tu as indiqué {X} min aujourd'hui : la séance recommandée ({D} min) ne tient pas dans ce temps, et NALYNT n'en a pas de version guidée plus courte. » Sources : `daily_checkins.available_minutes_today` (déjà lu par Aujourd'hui) et `final_session.duration_min` ; affichée quand le statut est bloqué et X < D. Jamais une lecture du texte de la trace | **Non implémenté** : utile seulement en option A ; environ une demi-journée |
| **Contradiction « RPE cible réduit » / « RPE 3–4 »** (endurance 60 → 45). M1 (C3.3) demande un RPE réduit ; le LIGHT A04 réduit la durée et garde le RPE du protocole | **Non implémenté**. Options ci-dessous |

Options pour la contradiction de RPE (M1 inchangé, aucune valeur inventée) :
- **R1 — informatif (web).** Afficher sur le document « Allègement : durée réduite (60 → 45 min) ; intensité du protocole inchangée ». Plus honnête sur ce qui a été réduit, mais la contradiction avec la consigne de M1 reste visible. **Insuffisant seul.**
- **R2 — décision sportive (B1).** Une vraie dose LIGHT d'endurance (par exemple RPE 2–3), décidée par le préparateur. M1 et V2 deviennent cohérents. **Recommandé avant la bêta.**
- **R3 — texte de M1 (C3.3) selon la famille.** Demande une ADR M1 (moteur gelé). Non recommandé.
- **Exclu :** masquer la consigne de M1, ou dire au rider de « rester en bas de la plage ». Ce serait une consigne inventée.

---

## 4. Fiabilité des tests

**Test en échec dans le passage complet head-coach du 2026-10-18 :**
`tests/supabase/p0_3PlannedSessionLock.integration.test.ts` › « concurrency — the rider's UPDATE, then DELETE, hold the lock: the session start waits on it and is refused (final_prescription_not_current); no session » (5 859 ms).

- **Préexistant, non introduit.**
  - Le même test avait échoué sous charge pendant une mission antérieure (pile `nalynt-qa01`), avec « the other connection ended first ».
  - Le fichier de test n'est pas modifié par la branche.
  - Le seul code de la branche sur son chemin est inerte : il y a un KEEP DH planifié, et les gardes ne visent que les MODIFY.
  - Rejoué seul deux fois : 10 / 10.
- **Cause probable : un harnais chronométré.**
  - La connexion A garde sa transaction 4 s (`HOLD_S = 4`, `pg_sleep`).
  - B doit être *observé* en attente du verrou consultatif avant la fin de A, par un sondage `docker exec psql` toutes les 100 ms.
  - Sous charge (Vite, runtime Edge et la suite en même temps), lancer B puis l'observer dépasse 4 s. A termine d'abord et le harnais échoue. La durée de 5,9 s est cohérente avec ce scénario.
  - Le message d'erreur exact de ce passage n'a pas été conservé (sortie filtrée). La cause n'est donc pas prouvée pour ce passage-là.
- **Correction de mon compte rendu précédent :** le passage complet head-coach n'était **pas entièrement vert** (1 échec sur 1 616 tests exécutés). Seul le rejeu isolé était vert.
- **Piste, hors de cette mission :** allonger `HOLD_S`, ou rendre l'observation de B indépendante de `docker exec` (une connexion d'observation persistante).

**Tests de cette mission (ciblés, sans relancer toutes les suites) :**

| Suite | Avant (code précédent) | Après |
|---|---|---|
| web `sportSafe01R2Message` + `guidedSessionLoader.guidance` | 11 échecs / 21 (code de `ab6b3a3`) | 21 / 21 |
| web : séance guidée, prescription V2, plan du jour, pages | 2 échecs (tests qui attendaient l'ancien texte générique pour `modify_not_supported`, mis à jour) | 853 réussis, 18 ignorés (871) |
| planning-engine `phys00FlagsOffEquivalence` (comptes épinglés) | — | 4 / 4 |
| Build web, `tsc` build | — | OK |

Non relancés (code inchangé depuis leur dernier passage) : head-coach complet, Edge, planning-engine complet, web complet.

---

## 5. Corrections prêtes, restantes, risques

**Prêtes (locales) :**
- refus §6 au point d'entrée quotidien, planifié et manuel (`5067a35`, `5ea811d`) ;
- ordre A04 → A10 strict, option A (`4181de5`) ;
- A1, consignes de M1 sur la séance guidée, et retrait du slogan sur une douleur (`ab6b3a3`) ;
- message `modify_not_supported` (`b36317f`) ;
- comptes du différentiel épinglés (`08fdc76`).

**À faire selon la décision HPM :**
- **Option A :** le message de disponibilité (§3), plus les ajouts canon de l'option A.
- **Option B :** l'amendement A10, la double trace (`A04_MODIFY_NOT_SUPPORTED` puis A10), les tests (différentiel : les 64 cas « adapted » égaux à la production plus la trace), et l'ajout canon §6.
- **Dans les deux cas :**
  - l'ajout §6 de `docs/04` ;
  - l'ajout P0-3 de `docs/05` (rapport SPORT-SAFE-01R §2) ;
  - `docs/10` T39 et un scénario A1 ;
  - la validation du texte du message ;
  - B1 (dose LIGHT d'endurance), B3 (durée LIGHT d'une endurance manuelle), B4 (HEAVY manuel) ;
  - A2 à A5 (DH sous douleur, durée, confirmation, crédit V2-L2).

**Risques :**
- **Option A :** régression visible pour un rider fatigué qui a peu de temps (aucune séance guidée), qu'on peut seulement expliquer.
- **Option B :** dépend d'un amendement canon. La récupération active n'est pas filtrée par zone douloureuse (déjà le cas en production).
- **Les deux :** la contradiction de RPE reste visible tant que B1 n'est pas décidé. Le refus de la DH manuelle HEAVY reste une interprétation tant que B4 n'est pas décidé.

---

## 6. État : **HOLD**

**MERGE READY seulement après ta décision sur :**
1. **L'option A ou B, avec le texte canon exact.**
   - Option A : ajout du message de disponibilité, puis merge.
   - Option B : implémentation et tests (environ un jour), puis merge.
2. **Les textes canon.** L'ajout §6 de `docs/04`, l'ajout P0-3 de `docs/05`, les scénarios de `docs/10`.
3. **Le message `modify_not_supported`** (texte).

Aucun push, merge ni déploiement avant ces décisions. Les arbitrages sportifs B1, B3, B4 et A2 à A5 ne bloquent pas le merge d'intégration. Ils bloquent la bêta payante.
