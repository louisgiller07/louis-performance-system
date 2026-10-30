# Publication des Draft PR (PR2, BETA, SPORT) — fiche de décision

**Statut** : préparée (HPM 2026-10-29, PUBLICATION READINESS). **Rien n'est poussé.**
- Chaque push attend un GO distinct de Louis ; chaque merge, un autre GO.
- Aucune campagne rejouée : depuis l'intégration `8568470`, seuls `vercel.json` et des documents ont changé.

## 1. Ce qui serait poussé

| | Branche locale | SHA | Destination | Effet |
|---|---|---|---|---|
| PR2 | `release/v2-dh-revocation` | `0f18f31` | `origin/release/v2-dh-revocation`, aujourd'hui `0c9f332` : avance rapide de 5 commits | met à jour la Draft PR #2 |
| BETA | `beta/v2-tech-01` | le commit de cette fiche, juste après `81ca8f4` | nouvelle branche `origin/beta/v2-tech-01` | nouvelle Draft PR |
| SPORT, variante A (recommandée) | `pub/sport-v2-corrections-01` | `bbdce25` | nouvelle branche `origin/sport/v2-corrections-01` | nouvelle Draft PR |
| SPORT, variante B | `sport/v2-corrections-01` | `63cf454` | même destination | même Draft PR |

Chaque push nomme un SHA exact : rien d'autre ne part, aucun amont n'est configuré, jamais de force.

## 2. Contenu

**PR2** : 5 nouveaux commits, 14 fichiers. La PR complète compte 12 commits et 24 fichiers.
- `6f87745`, `37f6455` : revue finale du canon et réserve R1 (`docs/review/pr2-dh-revocation/`).
- `11ac665` : canon `docs/04`, `05`, `07` appliqué sur la branche, **en attente d'approbation** (réserve R1). Le push le rend visible ; il ne l'approuve pas.
- `9158914` : en-tête de la migration `20261027120000` et message du rollback (« une révocation est définitive »), avec l'assertion de test correspondante. Aucun corps de fonction changé ; migration jamais déployée.
- `0f18f31` : `docs/00`, `11`, `12`, rapport, plan de release § 6.3.

**BETA** : 11 commits, 52 fichiers.
- Serveur : résolution des affectations (B), exigence d'unité DH (T2), traces pilote ; fonctions Edge `daily-run` et `generate-training-plan`.
- Migration `20261027150000` (exemptions V1 tracées) et son rollback.
- Web : messages 403 et 503 de la génération.
- Tests : trois nouvelles suites, `signedRuntimeV2.ts`, quinze suites ajustées.
- CI : `.github/workflows/integration-v2-off.yml`.
- Garde Vercel (§ 3).
- Docs : ADR, T4, plan et résultats d'intégration, textes des Draft PR, cette fiche ; `docs/00`, `11`, `12`.

**SPORT, variante A** : 11 commits, 32 fichiers.
- `planning-engine` : poussée garantie en Force du haut du corps, prototype des charnières, tests et instantanés.
- Migration `20261028120000` (catégorie du professionnel, commotion) et son rollback.
- Web : `ConcussionFollowUpForm`, catégorie du professionnel obligatoire.
- Tests d'intégration : `a5P0Hardening`, trois suites d'une ligne.
- Docs sportives `docs/review/sport-v2-corrections-01/` ; `docs/00`, `11`, `12` ; garde Vercel.
- **Construction** : les six premiers commits sont ceux de la source, aux mêmes SHA. Les cinq suivants en sont des copies, auteurs et dates conservés :
  - sans le dossier `docs/review/incident-2026-10-28-local-stack/` (11 fichiers) ;
  - avec six passages neutralisés dans `docs/00`, `11`, `12` et `REVIEW_1.md`, plus deux messages de commit.

  Tout fichier hors de `docs/` est identique à la source (code, tests, migration, web).

**SPORT, variante B** : la source telle quelle, 41 fichiers, dossier d'incident compris.

## 3. Contrôles

| Contrôle | Constat | État |
|---|---|---|
| Visibilité | Le dépôt GitHub est **public** : un push publie aussitôt tout l'historique poussé. | à peser à chaque GO |
| Vercel, push d'une branche | Les projets `nalynt` et `nalynt-marketing` déploient toute branche poussée (préviews publiques de `nalynt`), sauf si `git.deploymentEnabled` l'exclut. PR2 l'exclut depuis `2594cf7` : 0 déploiement sur `0c9f332`. BETA et SPORT ne l'excluaient pas : **garde ajouté** (`81ca8f4` ; `63cf454`, `bbdce25`). | prêt |
| Vercel, merge | `main` = production, **déploiement automatique** des deux projets à chaque merge (les 50 derniers déploiements sont tous sur `main`). Web livré par chaque merge : PR2, rien ; BETA, messages 403 et 503, inertes tant que `generate-training-plan` n'est pas redéployée ; SPORT, **formulaire de suivi de commotion, catégorie obligatoire** : changement visible pour les riders. | à décider avec chaque GO de merge |
| GitHub Actions | `ci` (unitaires, `verify:sport-approvals`) et `integration-v2-off` (pile jetable dans le runner) : droits en lecture, aucun secret, aucune étape de déploiement. | sans déploiement |
| Supabase | Aucune intégration GitHub : ni vérification ni déploiement Supabase sur la PR #2, qui porte pourtant une migration. Migrations et fonctions : CLI manuelle seulement. | sans déploiement |
| Flag V2, secrets, production | Aucun changement d'interrupteur, aucun secret posé ni lu, aucune écriture. | conforme |
| Secrets dans les commits | Balayage des lignes publiées par les trois push (JWT, clés Supabase, jetons d'API, clés privées, URL avec mot de passe, référence du projet de production) : **0 résultat**. Aucun fichier sensible ni binaire. | conforme |
| Données du poste | La variante B publierait l'inventaire des sauvegardes du poste (logiciel et version, job, état des sauvegardes, chemins), dans le dossier d'incident, `docs/11`, `docs/12` et deux messages de commit. La variante A les retire de tout l'historique publié (vérifié commit par commit). Reste un chemin local d'archive (`SPORT_V2_CORRECTIONS_01.md`) ; le nom d'utilisateur figure déjà dans quatre fichiers de `main`. | variante A recommandée |

## 4. Approbations

| Sujet | État | Requis pour |
|---|---|---|
| S1, S2, S3 | acceptés (HPM 2026-10-29) | — |
| S4 (contrat `docs/05` fusionné) | favorable sur le principe ; approbation formelle du canon due | merge BETA, après le canon de PR2 |
| Canon PR2, réserve R1 (`docs/04`, `05`, `07`) | en attente : architecte et Louis | merge PR2 |
| ADR BETA (T2, B, exemptions V1) | en attente : architecte et Louis | merge BETA |
| CI indépendante `integration-v2-off` | requise (HPM) ; jamais exécutée sur GitHub | merge BETA |
| Règle « contrôle obligatoire » sur `main` | décision de l'architecte | — |
| Cohérence des contrats après intégration | HPM | chaque merge |
| Contenu SPORT : **aucune signature sportive** | coach DH : 56 décisions (14 fiches U, C, D, S), 2 fiches débutant, 9 décisions communes ; PHYS : poussée du haut du corps, charnières du bas du corps, modèle de séance, hors saison, avant course, endurance et puissance ; santé : 9 questions sur la commotion et la reprise ; GO de la migration `20261028120000` | merge SPORT |
| Push | GO de Louis, un par branche | chaque push |

## 5. Actions prévues après chaque GO (aucune exécutée)

Avant chaque push : `git ls-remote origin` (la destination n'a pas bougé) et arbre propre. `gh` n'est pas installé sur ce poste : PR et descriptions passent par l'interface GitHub.

**PR2**
1. `git push origin 0f18f3144878c4ba615d4e023e6a672080e7f3a7:refs/heads/release/v2-dh-revocation` : avance rapide, refusée sinon.
2. Mettre à jour la description de la PR #2 :
   - l'en-tête passe à `0f18f31` (24 fichiers, 12 commits) ;
   - section « Canon » : les six diffs sont **appliqués sur la branche** (`11ac665`) en attente d'approbation formelle (réserve R1) ; le push ne les approuve pas ;
   - section « Known limits » : les deux corrections de `docs/review/pr2-dh-revocation/PR2_PENDING_CORRECTIONS.md` ;
   - ajouter que la partition V2 ON est traitée par BETA (T1), dans une PR distincte.
3. Contrôles : `ci` verte sur `0f18f31` ; 0 déploiement Vercel pour ce SHA.

**BETA**
1. `git push origin <SHA de la remise>:refs/heads/beta/v2-tech-01`.
2. Draft PR `main` ← `beta/v2-tech-01`, texte `DRAFT_PR_BETA.md`.
3. Contrôles :
   - 0 déploiement Vercel ;
   - `ci` verte ;
   - `integration-v2-off` verte, rapport et journal relus : 0 rechargement, aucun worker mort.

   Un échec est analysé, jamais déclaré PASS. Premier passage sur GitHub : un échec d'environnement reste possible (images, durées).
4. **Portée** : cette CI prouve BETA sur `main`, pas l'empilement. Après la fusion de PR2, la branche mise à jour (S2, S3) la rejoue : c'est ce passage qui compte pour le merge.

**SPORT** (variante choisie)
1. `git push origin bbdce252f23865c37bb50cecf719ba0d6944833e:refs/heads/sport/v2-corrections-01` (A) ou `63cf454a50a0079d951beb60c99c1f201c648234` (B).
2. Draft PR `main` ← `sport/v2-corrections-01`, texte `DRAFT_PR_SPORT.md`.
3. Contrôles : 0 déploiement Vercel ; `ci` verte.

## 6. Les trois push sont indépendants

- Trois destinations distinctes, aucune n'est `main`.
- Aucun ne déclenche de déploiement : garde Vercel, CI sans déploiement, pas d'intégration Supabase.
- Chacun peut être autorisé seul, dans n'importe quel ordre.
- Seule nuance : sans BETA poussée, la PR SPORT renvoie à des documents qui ne sont pas encore publiés.

L'ordre ne compte que pour les merges : PR2, puis BETA, puis SPORT. Ils porteront alors S2, S3, S4 et S1, plus l'union des entrées des deux `vercel.json` et des docs 00, 11, 12.
