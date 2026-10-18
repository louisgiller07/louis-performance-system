# POWER_GUARD_01_REPORT — garde serveur des séances de puissance

**Date** : 2026-10-18 · **Pour** : HPM et Louis · **Statut** : local uniquement.

Rien n'a été touché hors du poste local :
- aucun push, aucune migration en production, aucun déploiement ;
- aucun flag activé (`NALYNT_V2_POWER_ENABLED` absent).

**Verdict : READY LOCAL**. Branche `int/v2-phys-integration-01`, au-dessus du candidat PHYS `36b0b3f`. SHA final au § 8.

## 1. Contrat serveur exact (vérifié dans `record_session_execution`, `20261013160000`)

| Point | Comportement réel |
|---|---|
| Série de travail valide | une ligne `exercise_set_results` de l'exécution, **active** (aucune ligne ne la remplace par `supersedes_id`), **réalisée** (`done = true`), portant un `prescription_item_id` qui désigne un `exercise` d'un bloc `main` ou `complementary` de **la prescription finale de cette exécution** |
| Corrections | les lignes ne sont jamais modifiées ni supprimées (triggers). Une correction remplace une originale, une seule fois, jamais une correction. La ligne active décide : une série corrigée en `done = false` ne compte plus ; une correction réalisée compte |
| « Annulation » | elle n'existe que par correction en non réalisée. L'abandon (`abandoned`) clôt sans exiger de série |
| Séance partielle | **une** série valide suffit. Le serveur n'exige jamais toutes les séries prescrites ; c'est l'écran qui demande « Terminer quand même ? » |
| Priorité santé | les événements sont traités avant les séries et avant les invariants de fin de lot. `completed` sous un signal de santé ouvert ou un REST de sécurité est refusé `health_suspended` (409) **avant** toute garde de séries. Les séries elles-mêmes sont refusées sous suspension |
| Idempotence | un rejeu identique (même identifiant) est `unchanged`, jamais recontrôlé. Un second `completed` donne `invalid_transition` (409). Les résultats d'une exécution terminée sont figés (`execution_terminal`) |
| Refus | `NX001` `strength_set_required` : HTTP **422**. Message Edge : « Record at least one performed work set before completing this session. » ; message web : « Enregistre au moins une série de travail pour pouvoir terminer la séance. » Tout le lot est annulé |
| Autres chemins de clôture | aucun. Seule `record_session_execution`, en `SECURITY DEFINER`, écrit les événements ; `authenticated` et `service_role` n'ont que `SELECT` sur les tables d'exécution. Le débrief V1 ne termine pas une exécution V2 (contrat INT-01 inchangé, commun à toutes les familles) |

**Réutilisation de `strength_set_required` : correcte pour POWER.**
- La séance de puissance est guidée par l'écran Force du web (`isGuidedStrengthPrescription` inclut POWER).
- Ses libellés sont les mêmes : « Séries de travail réalisées : x / y » et « Enregistre au moins une série de travail… ».
- Le statut HTTP (422) et le message anglais de l'Edge sont génériques.
- **Aucune adaptation de l'Edge ni du web n'est nécessaire.**

## 2. Migration préparée

`supabase/migrations/20261018120000_power_guard_01_power_set_required.sql` :
- `create or replace function public.record_session_execution(uuid, jsonb)`, copiée **mot pour mot** de `20261013160000` ;
- les mêmes `revoke` et `grant` ;
- une seule condition change :

```diff
-      if found and v_act_structure ->> 'family' = 'strength'
+      -- POWER-GUARD-01 … (3 lignes de commentaire)
+      if found and v_act_structure ->> 'family' in ('strength', 'power')
```

Vérifié en base après application :
- seule cette différence de corps (`prosrc`) existe par rapport à l'avant ;
- `SECURITY DEFINER`, `search_path=public`, propriétaire `postgres` ;
- `EXECUTE` à `postgres` et `service_role` seulement ;
- une seule fonction de ce nom.

Aucune table et aucune donnée touchées.

**Retour arrière** : `supabase/rollbacks/power-guard-01/20261018120000_rollback_power_guard_01.sql`.
- Ce n'est pas une migration. Il réinstalle exactement le corps de `20261013160000`, ce que le test d'empreinte vérifie.
- Il ne touche aucune donnée. Les exécutions terminées sous la garde le restent ; il n'y a rien à « restaurer ».

## 3. Tests avant / après (pile locale, fonctions Edge servies, JWT du rider, HTTP réel et persistance)

`head-coach-engine/tests/supabase/powerGuard01.integration.test.ts`. Mode `POWER_GUARD_01_EXPECTED=absent` à 75 migrations, `installed` à 76.

| # | Cas | Avant (75, production) | Après (76) |
|---|---|---|---|
| 1 | POWER, zéro série | **200 : terminée sans série (défaut)** | 422 `strength_set_required`, rien d'écrit (ni événement ni série) |
| 2 | POWER, une série valide sur 12 | — | 200, terminée (partielle) |
| 3 | POWER, toutes les séries | 200 | 200 |
| 4 | POWER, seulement des résultats invalidés (série corrigée en non réalisée ; échauffement ; série non réalisée) | **200 (défaut)** | 422 à chaque fois ; les 4 lignes de résultats restent intactes |
| 5 | POWER sous signal de santé ouvert (`injury_suspect`) | 409 `health_suspended` | 409 `health_suspended`, avec ou sans série ; `abandoned` reste permis |
| 6 | Rejeu identique, puis seconde clôture | 200 `unchanged` ; 409 `invalid_transition` | idem |
| 7 | Force zéro série / une série ; DH zéro passage / un passage ; mobilité sans résultat | 422 / 200 ; 422 `dh_pass_required` / 200 ; 200 | identique |
| 8 | POWER manuelle, flag OFF puis ON | OFF : pas de document ; ON : document `power` | identique, la garde s'appliquant à la séance ON |
| 9 | Séance POWER d'un plan généré flag ON, servie flag OFF | **terminée sans série (défaut)** | 422, puis 200 avec une série |
| + | Contournement : RPC appelée directement (rôle service) ; écriture directe d'un événement par le rider | RPC acceptée (défaut) ; écriture refusée | RPC refusée `strength_set_required` ; écriture refusée |
| + | Empreinte (installée = migration ; retour arrière = `20261013160000` ; une seule condition) | — | 3/3 |

**Bilan : 8/8 avant (défaut reproduit), 11/11 après.** La migration est appliquée seule, par `supabase migration up --local` (76 = 75 + `20261018120000`).

**Régressions**, garde installée :
- head-coach complet : **1587/1587** (164 fichiers ; les 9 tests de 2 fichiers dont le worker vitest a planté — défaut connu de cette machine Windows — passent au rejeu) ;
- web complet, intégrations comprises : **2371/2371** (176 fichiers) ;
- TypeScript head-coach : mêmes 27 erreurs préexistantes qu'en `863f3fb`.

**Exercice de retour arrière local**

| Étape | Résultat |
|---|---|
| Script de retour appliqué | la fonction redevient **identique** à celle de production ; `SECURITY DEFINER`, `search_path`, propriétaire et droits inchangés |
| Données | inchangées avant et après : 974 clôtures, 1971 séries, 1783 exécutions |
| Comportement après retour | mode `absent` 8/8 (le défaut revient) ; mode `installed` : 5 échecs, exactement les cas qui dépendent de la garde (1 + 2, 4, 9, contournement, empreinte). Le test discrimine bien |
| État final de la pile | migration réappliquée, empreinte vérifiée, 11/11. La pile locale reste à **76 = production + POWER-GUARD-01**. Pour revenir à 75, on applique le script de retour ; je n'ai rien retouché dans l'historique des migrations |

## 4. Conséquences sur les séances partielles

- Une séance de puissance **partielle** (au moins une série valide) reste une fin légitime, comme la Force.
- Une séance POWER terminée a toujours au moins une série réelle. M1 ne compte donc plus jamais une POWER « faite » sans aucune série (part de V2-L1, sans toucher M1).
- PARTIAL-01 (web) qualifie déjà la puissance comme la Force : toutes les séries → « Réalisée » ; moins → « Partiellement réalisée ». Le cas « zéro série terminée » devient impossible.

## 5. Compatibilité

| Couche | Production `863f3fb` | Candidat PHYS `36b0b3f` |
|---|---|---|
| SQL | migration additive sur le comportement de sécurité (elle ajoute un refus, n'en retire aucun). Sans effet en production tant qu'aucune séance de puissance n'existe (PHYS non déployé ; requête de précondition attendue à 0) | nécessaire avant `NALYNT_V2_POWER_ENABLED` |
| Edge | `session-execution` inchangée (code et statut existants) | idem ; `daily-run` et `generate-training-plan` non concernés |
| Web | aucun changement : le message existe déjà | l'écran Force de la puissance exige déjà `recorded > 0` ; serveur et web disent la même chose |

**Ordre de livraison**
1. Migration POWER-GUARD-01 (inoffensive seule).
2. Edge PHYS, flags OFF.
3. Web.
4. `NALYNT_V2_POWER_ENABLED`, seulement sur décision HPM.

## 6. Risques

- **Faible.** Le changement porte sur une seule condition d'une fonction centrale. Il est couvert par :
  - le test d'empreinte ;
  - la suite complète ;
  - les régressions Force, DH, activité, santé et idempotence.
- **Ordre de livraison** : déployer `NALYNT_V2_POWER_ENABLED` avant la migration rouvrirait le défaut. Le précontrôle de release doit l'interdire.
- **Retour arrière** :
  - il réinstalle le corps précédent sans toucher aux données ;
  - après retour, une séance de puissance redevient terminable sans série (le défaut). À n'utiliser qu'avec POWER OFF ;
  - les données ne sont jamais « restaurées » : il n'y a rien à restaurer.

## 7. Canon

Diff proposé pour `docs/05_DATA_MODEL.md` (invariants UX-11R.9, après F-6C), à appliquer sur accord HPM avant la release :

```diff
+- **POWER-GUARD-01 — fin d'une séance de puissance** (`record_session_execution`, migration additive `20261018120000`) :
+  la règle F-6C s'applique aussi à une prescription de famille `power` (PHYS-03, exercices explosifs en blocs `main`) :
+  au moins une série active, réalisée, sur un exercice de travail de sa prescription. Une séance partielle reste
+  légitime. Refus `strength_set_required` (HTTP 422), lot annulé. Mobilité et récupération : aucun résultat exigé.
```

## 8. Commit local

Branche `int/v2-phys-integration-01`, au-dessus de `36b0b3f`. SHA donné à la livraison. Aucun push.

**STOP. Revue HPM attendue.**
