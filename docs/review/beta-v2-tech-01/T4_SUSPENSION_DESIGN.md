# T4 — suspension d'une séance ou d'une version de programme V2 : contrat exécutable minimal

**Statut** : spécification à approuver. **Non développée dans ce lot** (HPM, revue finale BETA-V2-TECH-01). Condition avant toute invitation de pilotes externes.
- Elle remplace la proposition précédente (un secret de suspension par famille). Un secret ne peut ni désigner une séance ou une version précise, ni garder la trace de qui a suspendu, quand et pourquoi.
- Chaque ligne du § 7 deviendra un test au GO de développement. Les noms de codes y sont fixés.

## 1. Périmètre

| Cible | Clé | Couvre |
|---|---|---|
| **Version de programme** | `training_plan_versions.id` | toutes les prescriptions finales V2 dont `plan_version_id` est cette version, séances ajoutées à la main comprises |
| **Séance du programme** | `training_plan_generated_sessions.id` | le jour de cette séance (`planned_sessions.source_generated_session_id`) et les prescriptions finales de ce jour |

- **V2 seulement.** Le chemin V1 ne crée pas de prescription finale ; il reste hors périmètre, à confirmer (décision 5).
- **Contenu concerné** : toutes les familles, DH ou non (une dose de Force erronée par exemple).

## 2. Données (migration additive, proposée)

```sql
create table public.prescription_suspensions (
  id uuid primary key default gen_random_uuid(),
  plan_version_id uuid references public.training_plan_versions (id) on delete restrict,
  generated_session_id uuid references public.training_plan_generated_sessions (id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0 and char_length(reason) <= 500),
  decided_by text not null check (length(trim(decided_by)) > 0 and char_length(decided_by) <= 200),
  suspended_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by text check (lifted_by is null or (length(trim(lifted_by)) > 0 and char_length(lifted_by) <= 200)),
  lift_reason text check (lift_reason is null or (length(trim(lift_reason)) > 0 and char_length(lift_reason) <= 500)),
  constraint prescription_suspensions_one_target check (num_nonnulls(plan_version_id, generated_session_id) = 1),
  constraint prescription_suspensions_lift_complete check (num_nonnulls(lifted_at, lifted_by, lift_reason) in (0, 3))
);
```

- **Accès** : RLS activée sans policy ; aucun droit pour `anon` / `authenticated` ; `service_role` = `SELECT`, `INSERT`, `UPDATE`.
- **Trigger** : suppression refusée, propriétaire compris ; seule mise à jour permise : la levée, une seule fois (`lifted_*` de NULL à rempli). Le reste de la ligne est immuable.
- **Fonction de lecture** `prescription_suspension_block(final_prescription_id)` : l'`id` de la suspension active qui couvre la prescription, sinon NULL. Aucun rôle de l'API, comme `execution_health_block`.

## 3. Contrôles serveur

Chaque contrôle lit les suspensions **dans la transaction de l'écriture**, sous verrou `SHARE` (comme la révocation PR2). Une suspension en cours d'écriture et une écriture d'exécution ou de quotidien sont donc strictement ordonnées.

| Point d'entrée | Contrôle | Réponse |
|---|---|---|
| `daily-run` (`persist_daily_run_v2`), y compris une relance du jour | la prescription finale serait couverte | décision du jour conservée (M1 inchangé), **aucune prescription finale créée**, statut `blocked` code `prescription_suspended` (statut existant, pas de nouveau terme) ; jamais `REST`, jamais de séance de remplacement |
| `session-execution` (`record_session_execution`) | la prescription de l'exécution est couverte | `started`, `resumed`, `completed` et toute série ou activité : **409 `prescription_suspended`**, rien n'est écrit. `paused` et `abandoned` restent permis. Mêmes règles que la suspension santé (P0-3) |
| Séance **déjà ouverte** avant la suspension | idem, à sa prochaine écriture | idem : elle ne peut plus que s'arrêter (pause, abandon) ; ses résultats déjà enregistrés sont conservés |
| `completed-session` lié à une prescription couverte | idem | 409 `prescription_suspended` |
| `accept-training-plan` d'une version suspendue | version suspendue | 409 `prescription_suspended`, rien n'est accepté |
| Lecture des suspensions impossible | — | refus sûr **503**, rien n'est servi ni écrit (fail-closed) |

## 4. Message au pilote

- **Aujourd'hui**, jour couvert : « NALYNT a suspendu cette séance pour vérifier son contenu. Ne la réalise pas telle quelle. Tes données sont conservées. »
- **Programme**, version couverte : « NALYNT a suspendu ton programme pour vérifier son contenu. Tes données sont conservées. Tu seras prévenu à la reprise. »
- **Séance ouverte** : l'écriture refusée est signalée avec le même texte. Les saisies non envoyées restent affichées, jamais effacées en silence. Seuls « Mettre en pause » et « Abandonner » sont proposés.
- **Jamais** : de conseil médical, de séance de remplacement, ni le mot « repos ».

Le pilote **ne lit pas la table** : l'information lui parvient par la réponse de `daily-run` (`blocked` / `prescription_suspended`) et par le code 409. Le motif interne (`reason`) ne lui est pas montré.

## 5. Audit

- **La suspension elle-même** : qui (`decided_by`), pourquoi (`reason`), quand (`suspended_at`), et la levée (`lifted_*`). Aucune ligne effacée.
- **Événements pilote** :
  - `daily_run_succeeded` avec `finalPrescriptionStatus: blocked` et `finalPrescriptionStatusCode: prescription_suspended` (champs existants) ;
  - `session_completion_failed` avec le code `prescription_suspended` (événement existant de `completed-session`) ;
  - `session-execution` n'émet aujourd'hui qu'un journal structuré (`outcome: rejected`, `code`), qui n'est pas durable. Un événement durable `session_execution_refused` (code, `suspensionId`) est **proposé** ; c'est un nouveau nom (décision 7).
- **Requête de suivi en lecture seule** : suspensions actives, pilotes et jours couverts, refus depuis la suspension.

## 6. Ce que T4 ne fait jamais

- Supprimer ou réécrire une ligne : programme, séance prévue, prescription, exécution, résultat.
- Substituer automatiquement une autre séance, un `REST` ou une version corrigée.
- Modifier M1 : la décision du jour est conservée, seule la prescription finale V2 est bloquée.
- Rendre la main à un client : ni création, ni levée, ni suppression d'une suspension par le navigateur.

## 7. Contrat exécutable (tests à écrire au GO)

| # | Situation | Attendu |
|---|---|---|
| T4-01 | aucune suspension | `daily-run`, `session-execution`, `completed-session` et `accept-training-plan` donnent les mêmes résultats qu'avant T4 (différentiel) |
| T4-02 | version suspendue, jour de cette version | décision conservée ; 0 prescription finale ; `blocked` / `prescription_suspended` ; jamais `REST` ; `planned_sessions` identiques (contenu et nombre) |
| T4-03 | séance suspendue | seul son jour est bloqué ; les autres jours de la version sont servis |
| T4-04 | toutes les familles | Force, endurance, puissance, mobilité et DH bloquées de la même façon |
| T4-05 | prescription du jour déjà créée, puis suspension, puis `started` | 409 `prescription_suspended`, 0 ligne écrite |
| T4-06 | séance ouverte avant la suspension | séries, `resumed` et `completed` en 409 ; `paused` et `abandoned` acceptés ; résultats antérieurs intacts (nombre de lignes et contenu) |
| T4-07 | suspension écrite pendant une écriture d'exécution ou de quotidien | ordre strict : l'écriture attend, puis est refusée ; rien d'écrit |
| T4-08 | `completed-session` lié à une prescription couverte | 409, rien d'écrit |
| T4-09 | `accept-training-plan` d'une version suspendue | 409, version non acceptée |
| T4-10 | client du pilote, puis client anonyme | ni lecture, ni écriture, ni levée, ni suppression d'une suspension |
| T4-11 | propriétaire de la base | suppression refusée ; mise à jour hors levée refusée ; seconde levée refusée ; levée incomplète refusée |
| T4-12 | levée | les jours sont de nouveau servis comme en T4-01 ; rien n'a été réécrit ; aucun refus n'est rejoué |
| T4-13 | lecture des suspensions impossible | 503, rien n'est servi ni écrit |
| T4-14 | rider V1 | inchangé (si la décision 5 confirme le périmètre V2 seul) |
| T4-15 | web | message du § 4 sur Aujourd'hui, dans le programme et dans la séance ouverte ; seuls « Mettre en pause » et « Abandonner » proposés ; saisies non envoyées conservées à l'écran |
| T4-16 | événements | chaque refus est tracé (§ 5) avec le code et, pour l'exécution, l'identifiant de suspension ; jamais le motif interne |

## 8. Décisions nécessaires

1. **Cibles** : version et séance du programme (proposé), ou une seule des deux.
2. **Statut** : réutiliser `blocked` avec le code `prescription_suspended` (proposé, aucun nouveau terme), ou créer un statut dédié, à inscrire dans `docs/07`.
3. **Textes** du § 4.
4. **`completed-session`** : refuser (proposé), ou accepter la déclaration d'une séance libre sans lien avec la prescription.
5. **V1** : hors périmètre (proposé), ou à couvrir.
6. **Mode opératoire** : qui peut écrire une suspension (opérateur `service_role`) et le délai d'information des pilotes.
7. **Audit des refus d'exécution** : nouvel événement durable `session_execution_refused` (proposé), ou journal structuré seul.
