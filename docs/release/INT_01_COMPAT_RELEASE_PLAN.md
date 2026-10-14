# INT-01 R2 — Version de compatibilité du catalogue V2 (C) : plan de release

**Statut** : PASS LOCAL / NOT DEPLOYED. Branche `int/int-01-compat`, construite sur la production P0-SAFE `92937a9` ; à reconstruire sur la production réellement en service au moment du déploiement (§7). Décisions : ADR INT-01 R2 et sa suite (`docs/11_DECISION_LOG.md`). Tests : T59 (`docs/10_TEST_PLAN.md`).

**Objet.** C lit, adapte et affiche le contenu que la release V2 suivante ajoute sous `session-model-v2.6`, sans jamais le générer. Ce contenu comprend :
- le drill `cornering_advanced_line_exit` et ses textes ;
- l'intent `dh_corner_line_control` ;
- les terrains compatibles ;
- `off_camber_section`.

C est livrable seule, avant le candidat V2. Elle devient la cible de rollback du candidat.

## 1. Contenu
| Couche | Changement | Inchangé par rapport à la production |
|---|---|---|
| planning-engine | catalogue (drill v2_only exclu de la sélection, textes, intent non sélectionnable, `compatibleTerrains` en lecture), `dhDrillForLoad`, `canonicalDhDrill`, `off_camber_section` accepté dans le snapshot | génération et adaptations des plans de production (différentiel : 0 écart) |
| Edge | `daily-run` (graphe `c9df7832…` sur base `92937a9`), `generate-training-plan` (`b8815db1…`) | les 8 autres fonctions (dont `session-execution` `0702b514…`) |
| Web | libellé et textes du drill, conservation d'un terrain enregistré non proposé | tout le reste |
| SQL, flags | aucun | — |

## 2. Ordre de déploiement
1. Construire C sur la production en service (§7) : `npm ci`, `npm run build:release:all`, puis `--verify-only`. Attendu : seuls `daily-run` et `generate-training-plan` changent par rapport à l'inventaire de la production en service.
2. Edge `daily-run`, puis Edge `generate-training-plan`, une fonction nommée à la fois.
3. Web (Vercel).

C ne modifie aucune donnée. L'ordre entre les trois étapes est libre tant qu'aucun contenu de la release suivante n'existe.

## 3. Smoke
Compte de test jetable, plan V2 de production.
- Aujourd'hui, daily-run, séance guidée DH et historique sont identiques à la production.
- Profil : enregistrer la section terrain sans régression.

## 4. Rollback
### 4.1 Cibles
| Situation | Cible | Pourquoi |
|---|---|---|
| C déployée, candidat jamais déployé | production en service avant C | aucun contenu de la release suivante n'existe |
| Candidat déployé, puis retiré | **C** | après la première génération du drill v2_only ou la première déclaration de « Virages en dévers », `92937a9` n'est plus une cible valide : `daily-run` 500 sur ces jours DH, `generate-training-plan` 500 pour ces profils, séance « non prise en charge » à l'écran |

Avant toute décision, mesurer les données concernées par requête :
- drill `cornering_advanced_line_exit` dans `training_plan_planned_prescriptions` ou `decision_final_prescriptions` ;
- `off_camber_section` dans `athlete_performance_profiles.terrain_access` ou dans `training_plan_versions.input_snapshot`.

### 4.2 Rollback du candidat vers C : SQL de sécurité conservé (gate final INT-01)
| Composant | Version pendant un rollback vers C | Raison |
|---|---|---|
| SQL P0-3 (`20261013120000`, `20261013140000`, `20261013160000`) | **conservé** | La garde santé (160000) empêche toute reprise, série, activité ou terminaison sous suspension ; le verrou du jour (140000) protège les séances exécutées. Les deux sont compatibles avec les Edge C (prouvé). 120000 n'est jamais appelé par C, il reste sans effet. |
| SQL gardes du débrief legacy (`20261013180000` et `20261013190000`, candidat, ADR INT-01 B et sa suite) | **conservés** | Sous suspension, et après l'arrêt d'une tentative un jour de REST Safety, le débrief V1 ne peut pas enregistrer « Terminée », « Partielle » ou « Remplacée ». Une tentative guidée arrêtée avec résultats n'accepte aucun débrief V1, santé ou non. Les retirer réactiverait les contournements. Compatibles avec les Edge C (T60 7/7 avec les deux gardes, T61). |
| Edge `daily-run`, `generate-training-plan` | C | ne génèrent plus le nouveau contenu, lisent l'existant |
| Edge `session-execution` | **candidat, conservé** (graphe P0-3) | traduit `health_suspended` et `daily_decision_not_current` en 409. La version de production les remonte en 500 (« Ton action n'a pas été confirmée (connexion) »). Ne la remettre qu'après un rollback de 160000. |
| Edge `completed-session` | **candidat, conservé** | traduit NX102, NX103 et NX104 en 409 (`health_suspended`, `daily_decision_not_current`, `guided_results_exist`). La version de production les remonte en 500 `persistence_failed`, ce qui est prouvé. Ne la remettre qu'après un rollback de `20261013190000` puis de `20261013180000`. |
| Web | **candidat conservé de préférence**, sinon C | Avec les Edge C et le SQL conservé, le web candidat garde l'UX santé P0-3 / R1 et des messages clairs pour les refus du débrief (prouvé). Le web C est sûr côté serveur mais dégradé (§6). |

Rejouer les rollbacks SQL P0-3 (en ordre inverse, comme nouvelles migrations) n'est à envisager que si le SQL lui-même est la cause. Dans ce cas, on renonce à la garde santé et au verrou serveur, et on remet `session-execution` après 160000.

**Gate final (2026-10-13, local, T59).**

| Situation | Résultat |
|---|---|
| Rider en A6 avec séance V2 manuelle commencée | série, reprise et terminaison 409 ; pause et arrêt 200 ; aucune écriture refusée |
| Tentatives de doublon | refusées (`final_prescription_not_current`, `active_execution_exists`, `session_already_completed`) |
| Séance V2 manuelle existante | aucun 500 : `daily-run` C la bloque, la séance ouverte se poursuit puis s'arrête |
| Verrou du jour | NX201 sur le jour exécuté ; l'acceptation d'un nouveau plan garde ce jour |
| Données | résultats et historique conservés |
| Erreurs | 0 erreur 500 (5 avec le `session-execution` de production) |

## 5. Preuves locales de C
- **Tests** :
  - planning-engine 842/842, prescription-engine 96/96 ;
  - head-coach-engine 1295/1295 (DB et Edge C) ;
  - web 2130/2130 (intégrations comprises), build OK ;
  - longitudinal-engine 873/873.
- **Différentiel C / production** : 32 256 constructions DH, 588 plans complets, 264 000 adaptations quotidiennes, 0 écart.
- **Simulation production → C → candidat → C** : aucun 500, aucune perte. Contre-épreuve production : 500.

## 6. Fonctionnalités dégradées sous C
Elles sont sûres côté serveur tant que le SQL P0-3 est conservé.
- **Séances V2 manuelles** :
  - pas de nouveau contenu : `daily-run` C renvoie un statut bloqué `planned_session_not_generated` (comme la production) ;
  - une séance manuelle déjà commencée se poursuit et s'arrête ;
  - pas de verrou web de `/plan` : un jour exécuté est refusé par le serveur avec le message générique « Impossible d'enregistrer la séance planifiée. Réessaie dans un instant. » ;
  - mentions V1 / V2 de P0-3 absentes.
- **Web C uniquement** (le web candidat conservé n'a pas ces défauts) :
  - sous suspension : pas de « Séance suspendue » ; Aujourd'hui invite à « Reprendre la séance guidée » (R1 absent) ; l'écran guidé propose « Reprendre » et « Saisir », et le serveur refuse avec « Action refusée. L'état affiché est celui enregistré. » ;
  - une tentative arrêtée n'est plus visible sur l'écran guidé quand la décision courante n'a pas de prescription ;
  - historique : le détail des séances guidées (P0-4) disparaît de l'affichage ; les données restent.
- **Génération** : P0 première génération et P0-2 ne s'appliquent plus aux nouvelles générations (règles de la production) ; les plans déjà générés sont lus et adaptés.
- **Débrief V1** : la garde serveur reste active, car le SQL est conservé. Avec le web C, ses refus s'affichent par le message générique « Une erreur inattendue s'est produite. Réessaie. ». Le web candidat affiche un message dédié.

## 7. Intégration depuis la production en service (ne pas écraser P1-TXT-01)
C est une suite de commits sur `92937a9`, pas un état figé. Au moment du déploiement :
1. Identifier la production réellement en service : commit des Edge déployées et du web Vercel ; P1-TXT-01 peut l'avoir précédée.
2. Créer la branche de release de C depuis ce commit et y rejouer les commits de C (`git cherry-pick` dans l'ordre). Conflit attendu : `docs/11_DECISION_LOG.md` (ajouts en fin de fichier, résolus par union) ; aucun avec le code de P1-TXT-01 (libellés V1 du web).
3. Régénérer le miroir des textes web (`web/scripts/generate-session-model-v2-texts.mjs`) si le catalogue a changé entre-temps, puis relancer toutes les suites et `build:release:all`. L'inventaire Edge doit différer de la production en service uniquement par `daily-run` et `generate-training-plan`.
4. Le candidat V2 sera intégré ensuite, sur la production + C, de la même manière.

**Essai local (2026-10-13)** : C rejouée sur P1-TXT-01 (`fef14b0`). Un seul conflit, `docs/11`, résolu par union. Suites planning-engine et web vertes ; contrôles P1-TXT-01 conservés.
