# SPORT_SAFE_01R_REPORT — clôture ciblée et protection guidée

**Date** : 2026-10-18 · **Pour** : HPM et Louis · **Statut** : READY LOCAL. Recommandation : HOLD court, en attente d'une décision HPM sur A10 (§8).

Branche `fix/sport-safe-01`, créée depuis `99d2add`, pile locale `nalynt-gate01` (76 migrations). Commits locaux :

| Commit | Contenu |
|---|---|
| `5067a35` | SPORT-SAFE-01 initial, déjà revu |
| `4181de5` | Mission 1 : le refus §6 passe avant A10 |
| `5ea811d` | Mission 2 : MODIFY manuel identique au KEEP |
| `ab6b3a3` | Mission 3 : A1, web |
| *(ce commit)* | ADR, statut, backlog, rapport, preuves |

Rien n'est sorti du poste local : aucun push, aucune migration, aucun déploiement, aucun flag, aucune modification distante. La production reste `99d2add`.

---

## 1. Verdict A04 / A10

### Passages exacts du canon

`docs/04`, section « Temps disponible aujourd'hui — `V2_TODAY_TIME_CONSTRAINT` (ADR A10, approuvée 2026-10-07) » :

> - **Condition :** X renseigné, et une prescription du jour V2 **créée** qui demande plus de X minutes […].
> - **Priorité :** la contrainte s'applique après M1, `V2_SYSTEMIC_FLOOR` et la prescription A04. Elle part de la séance déjà décidée et ne fait que descendre.
>   - Un REST de M1 reste REST.
>   - **Une prescription bloquée reste bloquée (`not_evaluated`).**

`docs/04`, section « Prescription du jour V2 et MODIFY vers le haut » : « Aucune augmentation automatique, et jamais la dose prévue rebaptisée « modifiée ». »

ADR A04 §6 (`docs/11`) : « un MODIFY sans baisse de charge donne `modify_not_supported` ; jamais un document « modifié » qui ne serait que la dose prévue ».

### Trace réelle du moteur

Cas : endurance prévue MODERATE 45 min, fatigue systémique (C3.3), 30 min disponibles. Vrai `runDailyFor`, pile locale.

| Runtime | M1 | A04 | Trace A10 (`V2_TODAY_TIME_CONSTRAINT`) | Document du jour |
|---|---|---|---|---|
| Production `99d2add` | MODIFY AEROBIC_BASE LIGHT 45 | copie de la dose prévue, créée (empreinte identique au plan) | « Avant : MODIFY AEROBIC_BASE LIGHT 45 min. Action : adapted → REPLACE RECOVERY_ACTIVE. » | récupération active 20 min |
| `5067a35` | identique | refus seulement si la séance tient dans le temps | « adapted → REPLACE RECOVERY_ACTIVE » | récupération active 20 min |
| `4181de5` et suivants | identique | **refus `modify_not_supported`** | « Action : not_evaluated. » | aucun (`blocked`) |

### La récupération active de 30 min est-elle autorisée par le canon actuel ?

**Non.** Une fois le refus §6 posé par A04, la prescription est bloquée. A10 exige une prescription « créée » et dit : « Une prescription bloquée reste bloquée ». En production, la récupération n'apparaissait que parce qu'A04 créait d'abord une copie non conforme. `5067a35` introduisait donc une exception non approuvée.

### Correction minimale faite (`4181de5`)

Dans `todayTimeLimitV2.ts`, le refus est appliqué au résultat d'A04 avant A10, quel que soit le temps disponible. Le refus donne `blocked` et A10 répond `not_evaluated`. Une vraie réduction reste adaptable par A10 : endurance 60 → 45 min, puis récupération active si seulement 30 min sont disponibles.

### Arbitrage HPM recommandé

Avec le canon strict, Aujourd'hui affiche, pour ce cas, « Prévu 45 min → Adapté 45 min (charge légère) ». Les 30 min déclarées par le rider ne sont pas reprises, et aucune séance guidée n'est proposée. C'est conforme, mais incohérent pour le rider. Je recommande d'amender `docs/04` pour qu'A10 évalue un refus §6 à partir de la séance décidée par M1. La séquence de candidats d'A10 est déjà canonique ; elle donnerait ici la récupération active.

```diff
   - Un REST de M1 reste REST.
   - Une prescription bloquée reste bloquée (`not_evaluated`).
+  - Exception (SPORT-SAFE-01R) : un `MODIFY` refusé faute de contenu plus léger (`modify_not_supported`, A04 §6) est
+    évalué depuis la séance décidée par M1 ; si elle dépasse X, A10 retient le premier candidat qui tient (jamais la
+    copie refusée elle-même).
```

Si l'amendement est approuvé, il suffit de retirer `4181de5`, ou de le réduire au chemin sans temps, et d'ajouter le scénario dans `docs/10`. Sans approbation, la branche reste conforme au canon strict.

---

## 2. Endurance manuelle

**Reproduction** (vrai moteur, pile locale, séance ajoutée par le rider sous RLS, journée sans séance prévue). La colonne « Production » donne le résultat V2 en production ; une même empreinte signifie le même contenu sportif.

| Séance manuelle | Check-in | M1 | Production (`99d2add` et `5067a35`) | Branche |
|---|---|---|---|---|
| AEROBIC_BASE MODERATE 45 | neutre | KEEP | créé, empreinte `f5c3528c` | identique |
| AEROBIC_BASE MODERATE 45 | fatigue C3.3 / jambes 9 / genou 4 | MODIFY LIGHT 45 | créé « modify », **empreinte `f5c3528c` = KEEP** | refus `modify_not_supported` |
| AEROBIC_BASE MODERATE 45 | C3.3 + 30 min | MODIFY LIGHT 45 | A10 → récupération 20 min | refus, `not_evaluated` (§1) |
| AEROBIC_BASE MODERATE 60 | neutre | KEEP | créé, empreinte `7cef941a` | identique |
| AEROBIC_BASE MODERATE 60 | C3.3 | MODIFY LIGHT 60 | créé « modify », **empreinte `7cef941a` = KEEP** | refus |
| AEROBIC_BASE HEAVY 60 | C3.3 | MODIFY MODERATE 60 | créé, **= KEEP** | refus |
| DH_TECHNICAL HEAVY 120 | C3.3 | MODIFY MODERATE 120 | créé, 6 passages, **= KEEP** | refus |
| DH_LIGHT HEAVY 90 | C3.3 | MODIFY MODERATE 90 | créé, **= KEEP** | refus |
| STRENGTH_UPPER MODERATE | C3.3 | MODIFY LIGHT | créé, réellement allégé | identique (contre-preuve) |

**Peut-elle être présentée comme allégée sans changement réel ?** Oui, en production, pour toute durée.
- Le builder d'endurance n'a aucun levier de charge (RPE du protocole fixe).
- Côté manuel, M1 garde la durée.
- Le même défaut est prouvé pour la DH manuelle HEAVY : son KEEP est déjà construit à la dose MODERATE.

**Le correctif existant ne couvrait pas ce chemin.** Une séance manuelle n'a pas de prescription prévue à comparer, et `5067a35` ne s'appliquait qu'à une prescription prévue.

**Les règles manuelles et planifiées ne doivent pas diverger selon le canon.**
- `docs/04` §6 est général : « jamais la dose prévue rebaptisée « modifiée » ».
- P0-3 (`docs/05`, ADR P0-3) fixe la construction du contenu (builders REPLACE pour le type et la charge finaux de M1), sans exception au §6.
- Seule la référence diffère : le document que le KEEP de la séance manuelle obtiendrait.

**Correction (`5ea811d`)** :
- `reconcileFinalPrescriptionV2` transmet la séance du rider avant M1 (`DailyPlan.planned_session_before`) dans le champ TypeScript additif `lineage.manualSession`.
- Le refus compare le MODIFY au KEEP construit avec des identifiants jetables, jamais persisté, avant A10.
- Aucun changement de DB ni de M1.
- La A04 « durée LIGHT 45 min » n'est pas appliquée aux séances manuelles : ce serait une règle nouvelle (voir §4).

**Différentiel** : 1 848 MODIFY manuels avec la séance avant M1. Refus seulement pour :
- AEROBIC_BASE (MODERATE→LIGHT, HEAVY→MODERATE) ;
- DH_TECHNICAL et DH_LIGHT HEAVY→MODERATE ;
- RECOVERY_ACTIVE, que `/plan` ne permet pas de planifier avec une charge : cas synthétique.

La Force et les autres types restent identiques à la production.

Diff `docs/05` proposé, non appliqué (paragraphe P0-3, après « Origine et action ») :

```diff
+- **§6 (SPORT-SAFE-01R)** : un MODIFY dont le contenu est celui du KEEP de la séance manuelle (séance avant M1,
+  `planned_session_before`) est refusé (`blocked` / `final_prescription_adaptation_not_defined` /
+  `modify_not_supported`), avant A10. Cas atteints : endurance (aucun levier de charge), DH HEAVY.
```

---

## 3. A1 — consignes de M1 visibles (implémenté, `ab6b3a3`)

**Contrat de données : aucun changement nécessaire.**
- M1 persiste `protection.do_not_do` et `monitoring.observe` dans `decisions.daily_plan`. Le rider les lit (RLS `decisions_own_select`).
- Chaque exécution porte son `decision_id`.
- Aucune colonne ni migration.

**Avant (production)** :
- Aujourd'hui montrait déjà « À éviter » et « À surveiller », non repliés, avant « Ouvrir la séance guidée ».
- La séance guidée (`/today/session`) n'en montrait rien. Le rider roulait 90 min sans rappel de la douleur ni de la règle d'arrêt.

**Après** :
- **Séance guidée, avant le démarrage** : protection et surveillance de la décision courante, au-dessus du contenu et du bouton « Commencer la séance ».
- **Pendant la séance, et après un rechargement** : celles de la décision de l'exécution. La ligne est append-only, donc figée comme la prescription, même si une décision plus récente existe.
- **Jamais en lecture seule** : séance terminée ou arrêtée, séance suspendue (la bannière santé P0-SAFE reste seule).
- **Aucun avertissement inventé** :
  - M1 n'a rien décidé → aucun bloc ;
  - ligne invalide ou illisible → aucun bloc ;
  - lecture en échec → l'écran échoue, jamais la séance sans ses consignes.
- **Même assainissement qu'Aujourd'hui** : `knee_R` devient « Genou droit ».
- **`DecisionHero` (Historique)** : plus de « prêt à performer » quand M1 a adapté pour une douleur déclarée (`PAIN_NON_SAFETY`, « Douleur signalée »). Avec de la fatigue seule, le slogan reste. Aujourd'hui n'affichait déjà pas ce slogan (MissionHero).

**Messages de remplacement ou de réduction** :
- Sur Aujourd'hui, ils restent ceux de M1 et d'A10 : « Pourquoi ? », phrase d'A10, « Adapté ».
- La séance guidée d'un remplacement porte les consignes de sa décision. Exemple, jambes 9/10 → DH léger : « Éviter le squat lourd… », « Réduis encore la séance ou arrête la partie DH… ».

**Inchangés** :
- M1, ses décisions et ses doses ; A2, A3, A5 ; P0-SAFE ;
- CONSISTENCY-01/02 (Aujourd'hui lit toujours la décision courante) ;
- PARTIAL-01 ;
- les prescriptions figées et les séances terminées en lecture seule.

---

## 4. Messages réellement visibles (captures et traces)

Web local de la branche (`ab6b3a3`) sur la pile locale, riders fictifs, viewport 390×844, horloge du navigateur fixée au jour du scénario. Chaque décision vient de `runDailyFor` (une seule décision par rider, vérifié). L'exécution démarrée ou terminée passe par la vraie RPC.
- Textes complets : `docs/release/sport-safe-01/evidence/SPORT_SAFE_01R_VISIBLE_TEXTS.txt`.
- Captures PNG (non versionnées) : dossier local de la session, `scratchpad/sportsafe01r/screens/` (25 images).

| Scénario | Aujourd'hui | `/today/session` |
|---|---|---|
| DH, genou 4/10 | « Adapté : 1 h 30 (charge légère) », « Pourquoi ? Douleur signalée — Genou droit — séance adaptée et surveillance renforcée », État du corps « Douleur signalée », À éviter / À surveiller, puis « Ouvrir la séance guidée » | « À éviter : Éviter toute charge sollicitant fortement Genou droit · Réduire l'intensité de la séance pour protéger Genou droit » ; « À surveiller : Surveiller l'évolution de la douleur (Genou droit, intensité 4/10) sur 24-48h · Pendant la séance, arrête la partie DH si la douleur augmente clairement ou si ton contrôle se dégrade. » ; puis « Prévu : 4 passages » et « Commencer la séance » |
| DH, genou 4/10, démarrée puis rechargée | idem | « État : en cours », mêmes consignes au-dessus de la séance |
| DH, genou 4/10, terminée | — | « État : terminée », 4/4 passages, **aucune consigne** (lecture seule) |
| DH, sans signal | « Prévu », aucun bloc À éviter | **aucun bloc**, « Prévu : 6 passages » |
| DH, jambes 9/10 | REPLACE DH léger | consignes jambes de M1, « Prévu : 4 passages » |
| DH, genou 6/10 | « Coaching suspendu », signal de santé, avis d'un professionnel | « Repos aujourd'hui : pas de séance guidée. » |
| Endurance 45, fatigue | « Prévu 45 min (modérée) → Adapté 45 min (légère) », « À éviter : Réduire l'intensité globale de la séance (RPE cible réduit) — sommeil insuffisant » | « Pas de séance guidée pour cette recommandation. » |
| Endurance 45, fatigue, 30 min | **identique : les 30 min n'apparaissent pas** (§1) | « Pas de séance guidée pour cette recommandation. » |
| Endurance 45, 30 min, sans fatigue | A10, récupération active | récupération active, 20 min, RPE 2–3 |
| Endurance 60, fatigue | Adapté 45 min (légère) | « À éviter : Réduire l'intensité globale… (RPE cible réduit) » au-dessus d'un **bloc principal 30 min RPE 3–4** (voir §5, B1) |
| Endurance manuelle 45, fatigue | « Modifiée par toi », Adapté 45 min (légère) | « Pas de séance guidée pour cette recommandation. » |
| Historique, DH genou 4/10 | — | pas de « prêt à performer » ; À éviter / À surveiller |
| Historique, DH sans signal | — | « ✓ Prêt à performer » (inchangé) |

---

## 5. Tests avant / après

| Suite | Avant | Après |
|---|---|---|
| planning-engine : `sportSafe01EnduranceLight` + `sportSafe01RManualModify` (nouveau) | 8 échecs / 28 sur le code de `5067a35` (A10 sur un refus ; MODIFY manuels) | 28 / 28 |
| web : `sportSafe01RGuidance`, `guidedSessionLoader.guidance`, `sportSafe01RTagline` (nouveaux) | 8 échecs / 21 sur le code web de `99d2add` | 21 / 21 |
| head-coach : `sportSafe01.integration` (vrais chemins, endurance prévue et manuelle, DH, A10, Safety, repos, sans check-in) | — | 23 / 23 |
| planning-engine complet + différentiel de production | — | 1 066 / 1 066 ; 192 refus planifiés (64 de plus que `5067a35`, tous « adapted » A10), manuel sans champ identique, manuel avec champ : liste exacte du §2 |
| head-coach complet (pile locale, Edge servie) | — | 1 615 réussis. Un test de concurrence en échec sous charge (Vite et Edge actifs) : `p0_3PlannedSessionLock`, rejoué seul deux fois 10 / 10, code non touché |
| Edge (bundles Deno comparés à Node) | — | 57 / 57 |
| web complet | — | 2 331 réussis, 61 ignorés ; build OK |
| Typage | — | planning-engine propre ; web `tsconfig.build` propre ; head-coach sans erreur dans les fichiers touchés (erreurs préexistantes ailleurs) |

**Arbitrages ouverts** :
- **A10 après un refus §6** (§1). Amendement recommandé.
- **B1 — vraie dose LIGHT d'endurance.** A1 rend visible un décalage existant : la protection de M1 demande « RPE cible réduit », alors que le LIGHT d'A04 réduit la durée et garde le RPE 3–4. C'est un choix du préparateur : RPE 2–3, ou 30 min, ou récupération.
- **B2 — message dédié au refus.** Actuellement : « Pas de séance guidée pour cette recommandation » et la décision M1 « Adapté (légère) ».
- **DH manuelle HEAVY.** Trois options :
  - refus (actuel) ;
  - texte honnête « déjà à la dose modérée » ;
  - dose LIGHT (règle nouvelle).
- **A2, A3, A4, A5** inchangés.

---

## 6. Diffs

**Par rapport à `5067a35`** (code et tests) : 17 fichiers, +671 / −50.
- Source :
  - `todayTimeLimitV2.ts` (+40) ;
  - `buildKeepFinalPrescriptionV2.ts` (+5, champ `manualSession`) ;
  - `reconcileFinalPrescriptionV2.ts` (+11) ;
  - `guidedSessionLoader.ts` (+27) ;
  - `GuidedSessionView.tsx` (+5) ;
  - `dayGuidance.tsx` (nouveau, 45) ;
  - `DecisionHero.tsx` (+5 / −3).
- Le reste est fait de tests et du double de backend des tests.

**Par rapport à `99d2add`** :
- Code source : 7 fichiers, +137 / −10. Code et tests : 20 fichiers, +1 081 / −44.
- Documentation : `docs/00`, `docs/11` (ADR SPORT-SAFE-01, amendé, et ADR SPORT-SAFE-01R), `docs/12`, deux rapports, un fichier de preuves.
- **Inchangés** : M1 (`head-coach-engine/src/{types,engine,rules,domains,mapping}`, 0 ligne), les migrations (0), V1.
- **Livraison** : `generateTrainingPlan.bundle.js` est identique octet pour octet à `99d2add`. `dailyRunV2.bundle.js` change. Une release toucherait `daily-run` et le web.

---

## 7. Commits locaux

`4181de5`, `5ea811d`, `ab6b3a3`, puis le commit de documentation (ADR, statut, backlog, ce rapport, preuves). Tous sont sur `fix/sport-safe-01`, fichiers indexés un par un, sans push.

---

## 8. Recommandation

**HOLD court, puis MERGE en intégration (sans déploiement).**

- **Code prêt.** Les trois corrections sont couvertes par des tests et des contre-preuves, et le différentiel se limite aux cas visés.
- **Avant le merge, l'HPM décide :**
  1. **A10 après un refus §6.** Approuver l'amendement (recommandé) et retirer `4181de5`, ou garder le canon strict (la branche telle quelle).
  2. **Les diffs canon.** `docs/04` (§1, plus §6 « contenu identique » et séance manuelle), `docs/05` (§2), `docs/10` (T39, plus un scénario A1 sur la séance guidée).
- **Avant toute activation commerciale :** arbitrer B1, B2, la DH manuelle HEAVY, puis A2 à A5.
