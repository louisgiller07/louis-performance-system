# INT-01 — FINAL ROLLBACK SAFETY GATE

**Date** : 2026-10-13 · **Pour** : HPM (via Louis) · **Statut** : local uniquement. Aucun push, merge, déploiement, changement de flag ni écriture en production.

## 1. Versions
| Branche | HEAD | Remarque |
|---|---|---|
| `int/int-01-compat` (C) | `1043cba` | code inchangé depuis `3a45543` ; ajouts de docs seulement (T59, ADR suite, plan de release) |
| `int/int-01-v2-candidate-r1` (candidat) | ce commit de doc, après `1b31d7e` | code inchangé depuis `3e2f0e3` ; fusion des docs de C, §5 du plan P0-3, ce rapport |
| `int/int-01-compat-on-p1txt01-dryrun` | `f0d2be2` | essai : C rejouée sur P1-TXT-01 (`fef14b0`), voir §6 |

## 2. A — Simulation du rollback vers C (pile locale, Edge et web servis, JWT des riders)
| Étape | Réalisé | Résultat |
|---|---|---|
| 1. C avant le candidat | SQL production (66 + rollbacks P0-3 : empreintes = production), Edge et web C ; riders M et N (plans générés par C), check-in et `daily-run` C | 200 |
| 2. Candidat | 3 migrations P0-3 (empreintes candidates), Edge et web candidats ; rider D (plan candidat, drill v2_only) | 200 |
| 3a. Séance V2 manuelle | M et N : Renfo haut du corps modérée aujourd'hui via `/plan` → `daily-run` : `manual_override_new_kind` / `keep`. M commence dans l'UI (2 séries) ; N par API (1 série, laissée ouverte). | 200 |
| 3b. Séance DH avec résultats | D : `cornering_advanced_line_exit`, 4 passages, terminée | 200 |
| 4. Suspension A6 | M, séance commencée : check-in modifié dans l'UI (douleur 7/10, ni nouvelle ni critère de gravité) → REST couche A **A6**, signal `injury_suspect` actif | 200 |
| 5. Rollback | Edge et web → C, **SQL P0-3 conservé** (69 migrations). Variantes (i), (ii), (iii) ci-dessous. | voir §3 |

**Vérifications sous C, SQL conservé :**
- **Sécurité santé (M).**
  - Nouvelle série, reprise et terminaison sont refusées (rien n'est écrit : la séance reste en pause avec 2 séries). La pause passe.
  - L'arrêt sûr passe, depuis l'UI : `started>paused>abandoned`, 2 résultats conservés.
  - La relance `daily-run` C donne REST A6 (`not_required`).
- **Aucun doublon.**
  - M : nouvelle exécution → `final_prescription_not_current` (409).
  - N : seconde exécution → `active_execution_exists` (409).
  - D : nouvelle exécution sur jour terminé → `session_already_completed` (409).
  - Au plus 1 exécution ouverte par jour et 1 prescription par décision ; les décisions restent append-only.
- **Séance V2 manuelle existante (N), aucun 500.**
  - Série acceptée sous C.
  - Relance `daily-run` C : statut bloqué `planned_session_not_generated` (comportement de la production).
  - Série encore acceptée sur la séance ouverte (prescription figée), puis arrêt 200.
- **Résultats et historique.** Avant / après identiques, hors actions autorisées (séries de N, arrêts, décisions relancées). Historique et journée de D consultables dans le web C (drill v2_only affiché).
- **SQL conservé × Edge C.**
  - `daily-run` C : 200 sur jour généré, manuel, suspendu et terminé.
  - `generate-training-plan` C + `accept-training-plan` : 200 ; le jour exécuté garde la séance de l'ancienne version, le jour suivant passe à la nouvelle.
  - Verrou : modification du jour exécuté par le rider → NX201 ; jour libre modifiable.

## 3. Matrice Edge / SQL / web
| Configuration du rollback vers C | Refus santé (série, reprise, fin) | Ce que voit le rider | Arrêt sûr | Doublons | V2 manuelle existante | Verrou du jour, acceptation | Données | 500 |
|---|---|---|---|---|---|---|---|---|
| (i) SQL conservé + **toutes** les Edge C (dont `session-execution` de production) + web C | refusés, mais **500** | « Ton action n'a pas été confirmée (connexion)… Réessayer » (trompeur) | OK | aucun | OK | OK | intactes | **5** |
| (ii) SQL conservé + Edge C + **`session-execution` candidat conservé** + web C | **409** `health_suspended` | « Action refusée. L'état affiché est celui enregistré. » Le web C propose encore « Reprendre » et « Saisir ». | OK | aucun | OK | OK (message `/plan` générique) | intactes | 0 |
| (iii) = (ii) + **web candidat conservé** (recommandée) | 409 | UX P0-3 / R1 complète : « Séance suspendue », seul « Arrêter », aucune invitation à reprendre ni formulaire | OK (UI) | aucun | OK | OK | intactes | 0 |
| (iv) SQL P0-3 retiré + Edge et web C (essai R2) | **aucune garde serveur** (comportement production) | — | OK | — | — | pas de verrou serveur | intactes | 0 |
| Production `92937a9` après génération du nouveau contenu | — | séance « non prise en charge » | — | — | — | — | — | `daily-run` et `generate-training-plan` **500** |

**Conclusion A.**
- Aucune régression de sécurité santé tant que le SQL P0-3 est conservé.
- La seule incompatibilité est (i), le `session-execution` de production face à la garde 160000. Elle se lève **sans code**, en conservant le `session-execution` du candidat.
- **Configuration retenue (documentée) : (iii)**, à défaut (ii).

## 4. B — Débrief V1 « Raconter ma séance » sous suspension : contournement réel → STOP
**Chemin serveur.**
- `completed-session` (PUT) → `persist_completed_session`.
- Seul garde-fou : refuser s'il existe ce jour-là une séance guidée **non arrêtée** (`completed_session_v2_exists`).
- Aucune vérification santé ; `session_date` non bornée (format seulement).
- Code identique en production, dans C et dans le candidat.

**Reproduction (JWT du rider, signal ouvert, décision REST couche A).**

| Rider et version | Situation | Débrief | Résultat |
|---|---|---|---|
| R, candidat | séance guidée du jour **arrêtée** sous suspension | DH « Terminée » | **200** |
| R, candidat | le lendemain (jour futur, sans séance) | DH « Terminée » | **200** |
| M, sous C | séance arrêtée sous suspension | Force « Terminée » | **200** (charge 42) |

Avec une séance guidée encore ouverte, le serveur refuse (409) : le contournement passe par l'arrêt.

**Impact.**
- **Règle O1 contournée.** Sous suspension, l'arrêt est la seule fin sûre et la terminaison est refusée. Le débrief déclare pourtant la séance « Terminée ».
- **Historique.** La journée « Coaching suspendu » affiche « ✓ Séance réalisée — Renfo haut du corps · 1 h ». La séance guidée arrêtée est masquée (priorité canonique du débrief).
- **Charge M1.** La séance déclarée entre dans la charge récente lue par M1, alors que la note P0-3 exclut les séances interrompues.
- **Verrou P0-3.** Le verrou du jour s'active (jour futur compris).
- **Ce qui n'est pas contourné.** Ni proposition d'entraînement, ni reprise guidée, ni signal de santé : la sécurité physique tient. C'est une écriture déclarative.
- **Origine.** Préexistant en production. Le candidat cache seulement l'entrée dans l'UI (R1) ; le serveur ne change pas.

**Proposition ciblée** (non implémentée, nouveau GO requis).
- **Règle.** Sous suspension santé du jour (même définition que `execution_health_block`), le débrief refuse `done`, `partial` et `replaced` (409 `health_suspended`). Il accepte `skipped` (« Non réalisée », raison douleur), qui consigne une absence d'entraînement et peut porter le signal.
- **Option 1 (recommandée).** Garde dans `persist_completed_session` (migration ; contrat critique, même transaction, couvre tout appelant). À livrer après une Edge `completed-session` qui traduit le nouveau code (sinon 500, même schéma que P0-3).
- **Option 2.** Pré-contrôle dans l'Edge `completed-session` via une fonction de lecture SECURITY DEFINER accordée à `service_role` (migration de droits). Moins atomique.
- **Option 3.** Lecture directe des signaux et de la décision dans l'Edge. Aucun SQL, mais une règle dupliquée : déconseillée.
- **Séparé, préexistant.** Borner `session_date` (refuser un débrief pour un jour futur).
- **Tests à prévoir.** Suspension × (aucune séance, séance arrêtée, séance ouverte) ; `skipped` accepté ; contre-preuve hors suspension ; compatibilité Edge / SQL dans les deux sens ; rollback vers C (C devrait embarquer l'Edge `completed-session` mise à jour si le SQL est conservé).

## 5. C — Documentation livrée
| Document | Contenu |
|---|---|
| `docs/10` | T59 : unitaires C, différentiel, simulation réelle, gate final, non-régression |
| `docs/11` | ADR INT-01 R2 (suite) : rollback vers C avec SQL P0-3 et `session-execution` candidat conservés ; production `92937a9` invalide après génération ; règle formelle de compatibilité et de versionnement des catalogues V2 (lire avant de générer, sens stable, étiquette N-1, cible de rollback mesurée, données déclarées jamais effacées, preuves exigées ; règle 7 proposée, non appliquée) |
| `docs/release/INT_01_COMPAT_RELEASE_PLAN.md` | §4 cibles et configuration de rollback ; §6 fonctionnalités dégradées sous C ; §7 intégration depuis la production en service |
| `docs/release/P0_3_RELEASE_PLAN.md` §5 | cible C, SQL conservé |
| `docs/00` | lignes de statut |

## 6. Intégration depuis la production en service (P1-TXT-01)
- `origin/main` = `92937a9` (production). P1-TXT-01 (`fef14b0`, non déployé) touche les libellés V1 du web et docs 11/12.
- **Essai.** Les 7 commits de C rejoués sur `fef14b0` :
  - un seul conflit, `docs/11`, résolu par union ;
  - code identique à C, plus P1-TXT-01 ;
  - planning-engine 842/842 ; web 2082 verts (dont le test P1-TXT-01 ; intégrations ignorées sans pile) ;
  - build release OK ; inventaire Edge identique à C (`daily-run` `c9df7832…`, `generate-training-plan` `b8815db1…`, autres = production).
- La procédure (rejouer C sur la production réellement en service, régénérer le miroir, tout retester, vérifier l'inventaire) est dans le plan de release §7.

## 7. Régressions et réserves
- **Sécurité santé** : aucune régression sous C avec le SQL P0-3 conservé.
- **Incompatibilité** : (i) seulement, levée par la configuration (ii) / (iii).
- **Dégradé si le web C est utilisé** : invitation à reprendre (R1 absent), messages génériques sur les refus, tentative arrêtée non affichée, détail P0-4 absent. Les séances manuelles V2 n'ont plus de contenu sous C dans tous les cas.
- **B** : contournement réel, préexistant, en attente de décision.

## 8. Verdict
**Gate de rollback (A) : PASS**, avec la configuration de rollback (iii), à défaut (ii) : SQL P0-3 conservé, `session-execution` candidat conservé, `daily-run` et `generate-training-plan` → C.

**B : STOP** conformément à la consigne : contournement réel de la règle O1 par le débrief V1, préexistant en production.

**Verdict global : BLOCKED sur B seul, en attente de décision HPM.**
- Option 1 : GO pour le correctif serveur ciblé (§4), puis contrôle de non-régression.
- Option 2 : classer B comme risque préexistant suivi par un ticket séparé ; le candidat redevient alors READY INTEGRATION sans autre changement.
