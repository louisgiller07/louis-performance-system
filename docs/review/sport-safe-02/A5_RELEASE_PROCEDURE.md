# SPORT-SAFE-02 A5 — procédure de publication et de rollback

Statut : **préparée, non exécutée**. Aucune étape de ce document ne s'exécute sans GO HPM sur le candidat final et confirmation de Louis.

## 1. Inventaire production (avant toute migration)

Lecture seule, une seule requête `SELECT`, agrégats sans identité ni date :

```
npx supabase db query --linked -f docs/review/sport-safe-02/A5_PRODUCTION_INVENTORY.sql
```

| Ligne | Lecture | Critère |
|---|---|---|
| `precheck_*_absent` (16–19) | objets créés par la migration | tous `true`, sinon HOLD |
| `precheck_last_migration` / `precheck_migrations_count` | `20261018120000` / `76` | sinon HOLD |
| `precheck_execution_health_block_md5` | empreinte de la garde actuelle | à noter : référence d'un rollback |
| `concussion_signals_*`, `riders_with_open_concussion` | volume concerné | information |
| `riders_with_several_open_concussion_signals` | chaque signal s'atteste séparément | information |
| `open_concussion_rider_without_login`, `…_banned_or_deleted` | aucun chemin d'attestation (seul le rider connecté atteste) | > 0 : décision HPM (compte inactif : suppression du compte ou réactivation de la connexion) |
| `open_concussion_flag_date_in_future` | issue datée impossible avant cette date | temporaire, information |
| `open_concussion_today_checkin_declares_concussion` | clôture refusée tant que le check-in du jour n'est pas corrigé | information (« Modifier » reste disponible) |
| `open_concussion_session_recorded_since_signal` | « erreur de saisie » impossible ; « retour complet autorisé » reste possible | information |
| `open_concussion_unfinished_guided_execution` | après migration : résultats, reprise et fin refusés ; pause et arrêt acceptés ; résultats conservés | information |
| `open_concussion_latest_decision_today_not_rest` | prescription du jour (ZERO_DH) qui ne sera plus démarrable | information |
| `resolved_concussion_without_resolved_at` | anomalie historique ; un signal résolu le reste | information |
| `open_signals_other_types_unchanged_by_a5` | non concernés par A5 | information |

## 2. Ordre de déploiement (une seule fenêtre)

Candidat : la branche `fix/a5-p0-hardening` (SHA noté dans la gate), publiée en avance rapide sur `main` après GO.

1. **Base** — `npx supabase db push --linked --dry-run` doit lister **uniquement** `20261021200000_sport_safe_02_a5_p0_hardening.sql` ; puis `npx supabase db push --linked`. Jamais `--include-all`, jamais `migration repair`.
   Contrôle (lecture seule) : `migration list --linked` → 77, dernière `20261021200000` ; l'inventaire relancé donne les lignes 16–19 à `false`.
2. **Edge** — `head-coach-engine npm run build:release`, puis `npx supabase functions deploy daily-run --project-ref uvolpldwwyvadlamulvr` (une seule fonction ; jamais `--prune`, `--no-verify-jwt`, `--use-api`). Seule `daily-run` charge le code M1 modifié ; les bundles `generateTrainingPlan` et `dailyRunV2` sont identiques au bit près à la production. Contrôle : `functions list` → `daily-run` v48, les autres versions inchangées.
3. **Web** — publication de `main` → déploiement Vercel de production. Contrôle : diff des bundles servis (`load011-bundle-diff.mjs`) limité au suivi santé.

Pourquoi cet ordre :
- base d'abord : dès la migration, le serveur refuse tout démarrage, résultat, reprise ou fin sous commotion ouverte, quelle que soit la décision. Entre 1 et 2, l'ancien moteur peut encore afficher une séance (ZERO_DH) que le serveur refuse : incohérence d'affichage, jamais d'exécution ;
- moteur avant la base serait **non sûr** : une ancienne prescription Force calculée avant le signal resterait démarrable avec l'ancienne garde (DH seulement) ;
- web en dernier : l'interface appelle le RPC créé par la migration. Entre 2 et 3, l'ancienne interface n'offre pas de clôture : les riders attendent, sans chemin dangereux.

Aucun smoke en production sans nouveau GO explicite.

## 3. Rollback

| Situation | Action | Sûr ? |
|---|---|---|
| Défaut de l'interface d'attestation | remettre le déploiement web précédent | oui : garde serveur intacte ; pas de clôture rider pendant ce temps (état d'avant A5) |
| Défaut du moteur (`daily-run`) | redéployer `daily-run` depuis `1b55825` | exécution sûre (la garde refuse toute famille sous commotion) ; affichage ZERO_DH incohérent ; temporaire seulement |
| Défaut de la garde ou du RPC | **roll forward** : nouvelle migration corrective | préféré |
| Rollback de la base (dernier recours, décision HPM) | contenu de `supabase/rollbacks/sport_safe_02/` appliqué comme **nouvelle** migration | **non sûr par défaut** : Force et endurance redeviennent démarrables sous commotion, une ancienne prescription redevient démarrable après clôture, plus aucun chemin de clôture rider |
| Rollback complet (base + `daily-run` v47 + web) | — | **non sûr** : retour à ZERO_DH, Force autorisée sous commotion ; interdit sans décision HPM explicite |

Rollback de la base, s'il est décidé :
- les déclarations des riders ne sont jamais perdues : elles sont copiées dans `health_flag_attestations_rollback_archive` (propriétaire seul, aucun rôle d'API ; supprimées avec le compte) ;
- les signaux gardent statut, date et note de clôture ;
- contrôle : l'empreinte de `execution_health_block` revient à la valeur notée à l'inventaire (même corps ; l'empreinte dépend des fins de ligne du fichier appliqué : `22de221b…` en CRLF, `309546cc…` en LF localement) ;
- une réapplication passe par une nouvelle migration.

Vérifié localement : migration → déclarations → rollback → archive (2 lignes), empreinte exacte, contre-preuve (Force autorisée, clôture directe acceptée), purge avec archive, réapplication, second rollback idempotent.

## 4. Aucun rider sans procédure de résolution

- Tout signal de commotion ouvert d'un rider connecté se clôt par « retour complet autorisé » (daté entre la déclaration et aujourd'hui), depuis tout état : sans attestation, `monitoring` historique, « évaluation en cours », « commotion confirmée » (test `no rider is ever locked`).
- Condition préalable : le check-in du jour ne déclare plus de suspicion ; il reste modifiable (« Modifier »), et le check-in du lendemain est une nouvelle déclaration (test d'intégration et parcours navigateur).
- Erreur de saisie : sans limite de jour, avec confirmation, avant toute évaluation et sans séance depuis le signal ; sinon, issue professionnelle datée.
- Signal daté dans le futur : issues datées possibles dès cette date ; « évaluation en cours » possible tout de suite.
- Aucun opérateur ni rôle de service ne clôture (décision HPM). Un rider sans connexion n'a pas de chemin : compte inactif, à traiter au cas par cas (ligne 7–8 de l'inventaire).
