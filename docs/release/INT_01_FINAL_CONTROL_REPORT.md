# INT-01 — DERNIER CONTRÔLE : TENTATIVE GUIDÉE ARRÊTÉE HORS SANTÉ

**Date** : 2026-10-13 · **Pour** : HPM (via Louis) · **Statut** : READY INTEGRATION / NOT DEPLOYED. Local uniquement : aucun push, merge, déploiement, changement de flag ni écriture en production.

## 1. Contournement constaté (avant correctif)
Pile locale, rider de simulation. Séance guidée V2 commencée, résultats enregistrés, puis arrêtée, sans signal de santé.

| Débrief V1 | Résultat avant | Conséquences |
|---|---|---|
| « Terminée », « Partielle », « Remplacée » | **200** | ligne `completed_sessions` avec charge (63 / 24 / 22,5) ; charge récente M1 AMBER incluant ces séances ; Historique « ✓ Séance réalisée · 1 h 30 » à la place de la séance arrêtée ; compteurs de séances et d'adhérence augmentés |
| après une séance guidée **terminée** | 409 `completed_session_v2_exists` | déjà protégé |
| débrief normal sans séance guidée | 200 | légitime |

Le contrat HPM était donc violé : une exécution guidée pouvait devenir une réalisation V1 fictive ou une seconde séance principale.

## 2. Correction minimale (migration `20261013190000`)
- `persist_completed_session` seule. Un jour avec une exécution `abandoned` ayant au moins un résultat (série ou activité) refuse tout débrief V1 → 409 `guided_results_exist` (NX104, code existant).
- Inchangés : signature, SECURITY INVOKER, `search_path`, droits, verrou consultatif, upsert, garde santé `20261013180000` (évaluée d'abord).
- Aucune nouvelle fonction ni structure SQL.
- Une tentative arrêtée **sans résultat** garde le débrief ordinaire (UX-11R.9), sauf un jour ayant eu un REST Safety, où seule « Non réalisée » est acceptée.
- Empreintes : `persist_completed_session` `2d5ec3f3…` → `050ad0e4…`. Le rollback restaure `2d5ec3f3…` ; la ré-application est identique.

## 3. Tests ciblés (T61)
| Cas | Résultat |
|---|---|
| Arrêtée avec 2 résultats (DH et Force) : « Terminée », « Partielle », « Remplacée », « Non réalisée » | 409 `guided_results_exist` ; aucune ligne `completed_sessions` ; exécution et résultats intacts |
| Charge M1 (`buildRawContext`) | aucune entrée `recent_sessions` pour ce jour |
| Arrêtée sans résultat → « Terminée » | 200 (UX-11R.9) |
| Séance guidée terminée ou ouverte | 409 `completed_session_v2_exists` |
| Débrief normal sans séance guidée | 200 |
| Contre-preuve : script de rollback appliqué | contournement revenu (200) ; ré-application → 7/7 |
| Rollback hybride vers C (SQL conservé, `completed-session` et `session-execution` du candidat, autres Edge C) | T60 7/7, 0 erreur Edge |

## 4. Interface (décision produit 3)
- **Tentative arrêtée avec résultats** : Aujourd'hui affiche « Séance guidée arrêtée » et « Voir la séance guidée », sans invitation « Raconter ma séance ». Un débrief legacy enregistré auparavant reste lisible, sans « Modifier ».
- **REST Safety du jour et tentative sans résultat** : l'invitation reste, mais seule « Non réalisée » est proposée, avec une note.
- **Autres jours** : quatre choix, inchangés. L'Historique n'est pas modifié.
- **Navigateur** (390 px, aucun débordement horizontal) :
  - jour ordinaire arrêté avec 3 résultats → carte « Séance guidée arrêtée » ;
  - jour avec REST Safety, signal clôturé, 2 résultats → même carte ;
  - A6 → REST Safety, tentative sans résultat arrêtée, signal clôturé → « Non réalisée » seule, enregistrée (200 `skipped`).
- **Messages** : `guided_results_exist` (Edge et web) couvre désormais tous les statuts refusés.

## 5. Non-régression du candidat
- **Suites** :
  - planning-engine 883/883 ;
  - prescription-engine 96/96 ;
  - head-coach-engine 1361/1361 (DB et Edge) ;
  - configs Edge : completed-session 152/152, session-execution 24/24, edge 57/57 ;
  - longitudinal-engine 873/873 ;
  - web 2248/2248 (intégrations comprises).
- **Builds** : web OK ; `build:release:all` OK.
- **Inventaire Edge** : seule `completed-session` change (`b1b067cf…`). `daily-run` `e00f0011…`, `generate-training-plan` `dbccafa4…` et `session-execution` `aebd17b1…` sont inchangées.

## 6. Décisions produit appliquées
1. **Refus conservateur sous signal ouvert**, même pour un jour antérieur au signal : conservé, limite documentée (`docs/05`). L'évolution temporelle est inscrite au backlog.
2. **`P1-DATE-01`** : ticket créé (bornes de date du débrief et risque de date future du daily-run). Aucun contrat modifié dans INT-01.
3. **Invitation web alignée sur les refus serveur** : §4.

## 7. Rollback
La configuration de rollback vers C conserve le SQL P0-3 et les deux gardes du débrief (`20261013180000`, `20261013190000`), ainsi que `session-execution` et `completed-session` du candidat. `daily-run` et `generate-training-plan` reviennent à C ; le web candidat est conservé de préférence. Le rollback ne réactive jamais un contournement.

Documenté dans `INT_01_COMPAT_RELEASE_PLAN.md` §4.2 (branche C, fusionnée) et `P0_3_RELEASE_PLAN.md` §5.

## 8. Points ouverts
- **Données existantes** : les débriefs enregistrés avant la migration ne sont pas modifiés. En local, Y garde ses lignes fictives. En production, leur nombre est inconnu ; une requête d'inventaire en lecture seule est possible sur décision HPM, non exécutée.
- **Limite de concurrence**, inchangée : `persist_daily_run_v2` ne prend pas le verrou consultatif.
- **Textes web** à relire : carte « Séance guidée arrêtée », note « Non réalisée » seule, message `guided_results_exist`.

## 9. Verdict
**INT-01 : READY INTEGRATION / NOT DEPLOYED.** Candidat figé : branche `int/int-01-v2-candidate-r1`, tag local `int-01-ready-integration`. Aucun autre travail sans décision HPM.
