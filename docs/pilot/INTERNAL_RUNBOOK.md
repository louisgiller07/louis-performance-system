# NALYNT — Runbook interne du pilote

**Document interne — ne pas partager avec les riders.**

Projet Supabase production : `uvolpldwwyvadlamulvr`. Toutes les requêtes ci-dessous sont en **lecture seule**, sauf la saisie de course (§2). Elles s'exécutent avec un rôle admin : SQL Editor du dashboard Supabase, ou `npx supabase db query --linked "<requête>"`. Ne jamais coller de clé, JWT ou mot de passe dans un ticket ou un message.

Remplacer les placeholders `<EMAIL>`, `<ATHLETE_ID>`, `<YYYY-MM-DD>`, `<START_DATE>` avant d'exécuter.

---

## 0. Checklist de lancement

Avant le lancement :

- [ ] production app healthy (`https://app.nalynt.ch` répond, login OK)
- [ ] migration state clean (`npx supabase migration list --linked` : 0 pending, 0 remote-only)
- [ ] observability table available (requête D1 ci-dessous s'exécute)
- [ ] privacy page public (`https://app.nalynt.ch/privacy` sans être connecté)
- [ ] operator identity correct (Louis Giller, Clos de la Cure 1, 1609 St-Martin, Suisse, contact@nalynt.ch)
- [ ] test account smoke green (compte de test production dédié : login, Aujourd'hui, Programme)
- [ ] 5–8 riders selected (cohorte : voir [README.md](README.md))
- [ ] participant guide ready ([PARTICIPANT_GUIDE.md](PARTICIPANT_GUIDE.md))
- [ ] race dates collected (pour chaque rider, avant sa génération)

---

## 1. Préparation d'un rider

Avant l'invitation :

- [ ] rider correspond à la cohorte
- [ ] email connu
- [ ] discipline DH
- [ ] équipement suffisamment complet
- [ ] disponibilités relativement stables
- [ ] dates de courses demandées
- [ ] support contact établi

Après l'inscription :

- [ ] onboarding complété
- [ ] consentement version `2026-09-24`
- [ ] Performance Setup complet
- [ ] disponibilités présentes
- [ ] courses saisies si nécessaire (§2), **avant** la génération
- [ ] génération réussie
- [ ] plan accepté
- [ ] premier daily-run réussi

Vérification en une requête, après l'inscription :

```sql
select a.id as athlete_id, a.name,
  o.onboarding_completed_at is not null as onboarding_done,
  o.privacy_notice_version, o.health_data_consent_at is not null as consent_recorded,
  (pp.athlete_id is not null) as performance_setup_saved,
  (select count(*) from athlete_availability_windows w where w.athlete_id = a.id) as availability_windows,
  (select count(*) from race_calendar r where r.athlete_id = a.id and r.status in ('planned','registered','confirmed')) as active_races,
  (select c.plan_version_id from training_plan_current_version c where c.athlete_id = a.id) as current_plan_version_id,
  (select max(e.created_at) from pilot_observability_events e where e.athlete_id = a.id and e.event_type = 'daily_run_succeeded') as last_daily_run_ok
from athletes a
join auth.users u on u.id = a.user_id
left join athlete_onboarding_profiles o on o.athlete_id = a.id
left join athlete_performance_profiles pp on pp.athlete_id = a.id
where u.email = '<EMAIL>';
```

Le rider est prêt quand `onboarding_done`, `privacy_notice_version = 2026-09-24`, `consent_recorded`, `performance_setup_saved`, `availability_windows > 0`, `current_plan_version_id` et `last_daily_run_ok` sont tous renseignés.

---

## 2. Saisie d'une course

Il n'y a pas d'UI de saisie : l'équipe ajoute les courses en SQL admin, **avant** la génération du plan du rider. Le générateur lit les courses sur tout l'horizon du plan au moment de la génération. Une course ajoutée après l'acceptation n'entre dans le plan qu'après une nouvelle génération et une nouvelle acceptation par le rider. Le Head Coach quotidien, lui, la voit dès le daily-run suivant (fenêtre proche).

Table : `public.race_calendar`

| Colonne | Obligatoire | Valeurs |
|---|---|---|
| `athlete_id` | oui | `athletes.id` du rider |
| `event_name` | oui | texte |
| `start_date` | oui | `date`, format `YYYY-MM-DD` |
| `end_date` | oui | `date`, `YYYY-MM-DD`, `>= start_date` (contrainte `valid_race_dates`) ; = `start_date` pour une course d'un jour |
| `priority` | non (défaut `B`) | enum `race_priority` : `A_PLUS`, `A`, `B`, `C` |
| `race_format` | recommandé | enum `race_format` : `HOT_TRAIL_2DAY`, `IXS_3DAY`, `SWISS_CUP`, `UCI_WC`, `UCI_WORLDS`, `OTHER`. Un `NULL` est lu comme `OTHER`, avec un warning : toujours renseigner, `OTHER` si aucun ne correspond. |
| `status` | non (défaut `planned`) | enum `race_status` : `planned`, `registered`, `confirmed`, `completed`, `skipped`, `cancelled` |

Seules `planned`, `registered` et `confirmed` sont prises en compte pour une course à venir. `cancelled` et `skipped` sont ignorées. Pour retirer une course, passer son `status` à `cancelled` ; ne pas la supprimer.

Template :

```sql
insert into public.race_calendar (athlete_id, event_name, start_date, end_date, priority, race_format, status)
select a.id, '<EVENT_NAME>', '<YYYY-MM-DD>'::date, '<YYYY-MM-DD>'::date, '<A_PLUS|A|B|C>'::race_priority, '<RACE_FORMAT>'::race_format, 'planned'::race_status
from athletes a join auth.users u on u.id = a.user_id
where u.email = '<EMAIL>'
returning id, athlete_id, event_name, start_date, end_date, priority, race_format, status;
```

Vérifier que `returning` renvoie exactement **une** ligne. Zéro ligne signifie un email inconnu.

---

## 3. Workflow support

Le rider fournit :
- son email ;
- la date (et l'heure approximative) ;
- l'écran concerné ;
- une description courte ;
- une capture si utile.

Le support procède ainsi :

1. **email → athlete_id** (requête S0).
2. **Événements d'observabilité** du rider (S1) : erreur, warning, blocage ?
3. **Records métier** selon le cas : plan courant (S2), séance prévue et lignée (S3), décision du jour (S4), séance enregistrée (S5).
4. **Diagnostic**, puis réponse au rider, et escalade technique si besoin.

Ne jamais demander au rider de détails médicaux par message.

### SQL support

```sql
-- S0. email -> athlete_id
select a.id as athlete_id, a.name
from athletes a join auth.users u on u.id = a.user_id
where u.email = '<EMAIL>';

-- S1. Derniers événements d'observabilité d'un rider
select e.created_at, e.event_type, e.severity, e.plan_version_id, e.event_date, e.decision_id, e.generated_session_id, e.metadata
from pilot_observability_events e
join athletes a on a.id = e.athlete_id
join auth.users u on u.id = a.user_id
where u.email = '<EMAIL>'
order by e.created_at desc
limit 50;

-- S2. Plan courant (et son dernier état de cycle de vie)
select v.id, v.horizon_start_date, v.horizon_end_date, v.generated_at,
  (select t.state from training_plan_version_lifecycle_transitions t
   where t.plan_version_id = v.id order by t.transition_number desc limit 1) as state
from training_plan_current_version c
join training_plan_versions v on v.id = c.plan_version_id
where c.athlete_id = '<ATHLETE_ID>';

-- S3. Séance prévue + lignée + prescription pour une date
select ps.planned_date, ps.source, ps.intervention, ps.source_plan_version_id, ps.source_generated_session_id,
  (pp.id is not null) as has_prescription
from planned_sessions ps
left join training_plan_planned_prescriptions pp on pp.generated_plan_session_id = ps.source_generated_session_id
where ps.athlete_id = '<ATHLETE_ID>' and ps.planned_date = '<YYYY-MM-DD>';

-- S4. Décisions du jour (la plus récente fait foi)
select id, created_at, final_session, daily_plan->>'decision' as decision, daily_plan->'final_session' as final_intervention
from decisions
where athlete_id = '<ATHLETE_ID>' and decision_date = '<YYYY-MM-DD>'
order by created_at desc;

-- S5. Séance enregistrée
select id, session_date, completion_status, decision_id, session_type, actual_duration_min, rpe
from completed_sessions
where athlete_id = '<ATHLETE_ID>' and session_date = '<YYYY-MM-DD>';
```

Repères de lecture :
- `daily_run_failed` avec `metadata.errorCode = no_checkin_for_date` : le rider n'a pas fait son check-in. C'est un problème de support, pas une panne.
- `plan_generation_blocked` : `metadata.blockedReason` indique ce qui manque (par exemple `missing_availability`).
- `daily_run_succeeded` avec `metadata.executablePrescriptionDelivered = false` sur un KEEP est normal pour une séance aérobie ou sans prescription canonique.

---

## 4. Routine quotidienne (~10 minutes sans incident)

1. Erreurs des dernières 24 h (D1), puis traiter chaque rider concerné avec S1.
2. Warnings des dernières 24 h (D2). Un pic de `daily_run_warning` signale un problème de projection ou de lookup.
3. Riders sans `daily_run_succeeded` depuis 3 jours (D3) : les relancer gentiment.
4. Messages reçus : répondre, et tracer chaque cas avec S0–S5.

```sql
-- D1. Erreurs dernières 24 h
select event_type, metadata->>'errorCode' as error_code, count(*) as events, count(distinct athlete_id) as riders
from pilot_observability_events
where severity = 'error' and created_at > now() - interval '24 hours'
group by 1, 2 order by events desc;

-- D2. Warnings dernières 24 h
select event_type, count(*) as events, count(distinct athlete_id) as riders
from pilot_observability_events
where severity = 'warning' and created_at > now() - interval '24 hours'
group by 1 order by events desc;

-- D3. Riders avec un plan courant et sans daily_run_succeeded depuis 3 jours
select a.id as athlete_id, a.name, max(e.created_at) as last_daily_run_ok
from training_plan_current_version c
join athletes a on a.id = c.athlete_id
left join pilot_observability_events e on e.athlete_id = a.id and e.event_type = 'daily_run_succeeded'
group by a.id, a.name
having max(e.created_at) is null or max(e.created_at) < now() - interval '3 days'
order by last_daily_run_ok nulls first;
```

D3 inclut aussi les comptes non-pilotes qui ont un plan (compte de test production, compte de Louis) : les ignorer.

---

## 5. Conditions d'arrêt

### STOP PILOT

Arrêt du pilote : prévenir les riders, suspendre l'usage, puis investiguer avant toute reprise.

1. **Safety invariant violation** : une suspicion de commotion déclarée au check-in du jour mène à autre chose que REST (règle A1). Autre cas : une commotion non résolue (flag `concussion_suspect` actif ou en suivi) mène à une séance DH (règle A5 : zéro DH tant que le flag n'est pas résolu).
2. **Cross-athlete data exposure** : un rider voit ou modifie les données d'un autre.
3. **Canonical plan corruption** : plus d'un plan courant pour un athlète, ou un plan courant qui appartient à un autre athlète.
4. **Plus de 3 erreurs 500 de daily-run en 24 h touchant au moins 2 riders.**
5. **Projection lineage corruption** : une séance prévue projetée pointe vers un plan qui n'est pas le plan courant du rider, ou vers le plan d'un autre athlète.

Contrôles (chaque requête doit renvoyer **0 ligne**) :

```sql
-- X1a. A1 : suspicion de commotion au check-in -> décision non REST (7 derniers jours)
select d.id, d.athlete_id, d.decision_date, d.daily_plan->>'decision' as decision
from decisions d join daily_checkins c on c.id = d.source_checkin_id
where c.suspected_concussion and d.created_at > now() - interval '7 days'
  and coalesce(d.daily_plan->>'decision', '') <> 'REST';

-- X1b. A5 : commotion non résolue -> séance DH (7 derniers jours)
select d.id, d.athlete_id, d.decision_date, d.final_session
from decisions d
join health_flags h on h.athlete_id = d.athlete_id and h.flag_type = 'concussion_suspect'
  and h.status in ('active', 'monitoring') and h.flag_date <= d.decision_date
where d.created_at > now() - interval '7 days' and d.final_session in ('DH_TECHNICAL', 'DH_PERFORMANCE');

-- X3. Plan canonique : un plan courant qui n'appartient pas à l'athlète
select c.athlete_id, c.plan_version_id, v.athlete_id as plan_owner
from training_plan_current_version c join training_plan_versions v on v.id = c.plan_version_id
where v.athlete_id <> c.athlete_id;

-- X4. Daily-run en erreur 24 h (hors check-in manquant) : STOP si events > 3 et riders >= 2
select count(*) as events, count(distinct athlete_id) as riders
from pilot_observability_events
where event_type = 'daily_run_failed' and created_at > now() - interval '24 hours'
  and coalesce(metadata->>'errorCode', '') <> 'no_checkin_for_date'
having count(*) > 3 and count(distinct athlete_id) >= 2;

-- X5. Lignée : séance projetée à venir qui ne pointe pas vers le plan courant du rider
select ps.athlete_id, ps.planned_date, ps.source_plan_version_id, c.plan_version_id as current_plan
from planned_sessions ps
left join training_plan_current_version c on c.athlete_id = ps.athlete_id
where ps.source_plan_version_id is not null and ps.planned_date >= current_date
  and ps.source_plan_version_id is distinct from c.plan_version_id;
```

La clé primaire de `training_plan_current_version` garantit déjà au plus un plan courant par athlète. X2 (exposition croisée) n'a pas de requête : il est couvert par la RLS et ne se détecte que par signalement. Tout signalement de ce type déclenche un STOP immédiat.

X5 : juste après une nouvelle acceptation, des séances futures de l'ancien plan peuvent encore apparaître jusqu'au daily-run suivant. Relancer X5 après ce daily-run avant de conclure.

### INDIVIDUAL SUPPORT ISSUE

Ces cas ne stoppent pas le pilote. On les traite au cas par cas avec le rider (§3) :

- génération bloquée pour un rider (`plan_generation_blocked`) ;
- échec de génération isolé (`plan_generation_failed`) ;
- échec d'enregistrement de séance (`session_completion_failed`) ;
- check-in manquant (`daily_run_failed` / `no_checkin_for_date`) ;
- question sur Adapter ou Remplacer ;
- problème visuel frontend isolé.

---

## 6. Indicateurs de succès

Les métriques utilisent uniquement les tables existantes : pas de dashboard, pas d'outil d'analytics. La cohorte est déclarée en tête de chaque requête avec les `athlete_id` et dates de départ du roster :

```sql
with cohort(athlete_id, start_date) as (values
  ('<ATHLETE_ID>'::uuid, '<START_DATE>'::date)
  -- , ('<ATHLETE_ID>'::uuid, '<START_DATE>'::date)
)
```

| # | Métrique | Définition | Source |
|---|---|---|---|
| 1 | Setup completion | riders avec un profil de performance et au moins une disponibilité, sur la taille de la cohorte | `athlete_performance_profiles`, `athlete_availability_windows` |
| 2 | Successful plan generation | `plan_generation_succeeded` hors rejeu, sur succeeded + failed + blocked | `pilot_observability_events` |
| 3 | Plan acceptance | riders avec un plan courant, sur les riders ayant généré au moins un plan | `training_plan_current_version`, événements |
| 4 | Daily-run error rate | `daily_run_failed` hors `no_checkin_for_date`, sur daily-runs réussis + ces échecs | `pilot_observability_events` |
| 5 | Weekly daily-run engagement | jours distincts avec `daily_run_succeeded`, par rider et par semaine | `pilot_observability_events` |
| 6 | Executable prescription on KEEP | `executablePrescriptionDelivered = true` parmi les `daily_run_succeeded` KEEP | `pilot_observability_events` |
| 7 | Session completion rate | jours avec séance enregistrée faite, partielle ou remplacée, sur les jours dont la dernière décision n'est pas REST | `decisions`, `completed_sessions` |
| 8 | Week 5–6 retention | riders avec au moins un `daily_run_succeeded` entre J+28 et J+41 de leur départ, sur la taille de la cohorte | `pilot_observability_events` |

La métrique 6 ne vise pas 100 % : un KEEP sur une séance aérobie n'a pas de prescription détaillée, par conception.

```sql
-- M1. Setup completion
with cohort(athlete_id, start_date) as (values ('<ATHLETE_ID>'::uuid, '<START_DATE>'::date))
select count(*) filter (where exists (select 1 from athlete_performance_profiles p where p.athlete_id = c.athlete_id)
                         and exists (select 1 from athlete_availability_windows w where w.athlete_id = c.athlete_id)) as setup_complete,
       count(*) as cohort_size
from cohort c;

-- M2. Successful plan generation
with cohort(athlete_id, start_date) as (values ('<ATHLETE_ID>'::uuid, '<START_DATE>'::date))
select count(*) filter (where e.event_type = 'plan_generation_succeeded' and e.metadata->>'idempotentReplay' = 'false') as succeeded,
       count(*) filter (where e.event_type = 'plan_generation_failed') as failed,
       count(*) filter (where e.event_type = 'plan_generation_blocked') as blocked
from pilot_observability_events e join cohort c on c.athlete_id = e.athlete_id
where e.event_type like 'plan_generation_%';

-- M3. Plan acceptance
with cohort(athlete_id, start_date) as (values ('<ATHLETE_ID>'::uuid, '<START_DATE>'::date))
select count(*) filter (where exists (select 1 from training_plan_current_version cv where cv.athlete_id = c.athlete_id)) as with_current_plan,
       count(*) filter (where exists (select 1 from pilot_observability_events e where e.athlete_id = c.athlete_id and e.event_type = 'plan_generation_succeeded')) as generated
from cohort c;

-- M4. Daily-run error rate
with cohort(athlete_id, start_date) as (values ('<ATHLETE_ID>'::uuid, '<START_DATE>'::date))
select count(*) filter (where e.event_type = 'daily_run_failed' and coalesce(e.metadata->>'errorCode', '') <> 'no_checkin_for_date') as failed,
       count(*) filter (where e.event_type = 'daily_run_succeeded') as succeeded
from pilot_observability_events e join cohort c on c.athlete_id = e.athlete_id
where e.event_type in ('daily_run_failed', 'daily_run_succeeded');

-- M5. Weekly daily-run engagement (jours distincts par rider et par semaine de pilote)
with cohort(athlete_id, start_date) as (values ('<ATHLETE_ID>'::uuid, '<START_DATE>'::date))
select c.athlete_id, (e.event_date - c.start_date) / 7 + 1 as pilot_week, count(distinct e.event_date) as days_with_daily_run
from pilot_observability_events e join cohort c on c.athlete_id = e.athlete_id
where e.event_type = 'daily_run_succeeded' and e.event_date >= c.start_date
group by 1, 2 order by 1, 2;

-- M6. Executable prescription on KEEP
with cohort(athlete_id, start_date) as (values ('<ATHLETE_ID>'::uuid, '<START_DATE>'::date))
select count(*) filter (where e.metadata->>'executablePrescriptionDelivered' = 'true') as delivered,
       count(*) as keep_runs
from pilot_observability_events e join cohort c on c.athlete_id = e.athlete_id
where e.event_type = 'daily_run_succeeded' and e.metadata->>'decision' = 'KEEP';

-- M7. Session completion rate (dernière décision du jour non REST)
with cohort(athlete_id, start_date) as (values ('<ATHLETE_ID>'::uuid, '<START_DATE>'::date)),
latest as (
  select distinct on (d.athlete_id, d.decision_date) d.athlete_id, d.decision_date, d.daily_plan->>'decision' as decision
  from decisions d join cohort c on c.athlete_id = d.athlete_id
  where d.decision_date >= c.start_date
  order by d.athlete_id, d.decision_date, d.created_at desc
)
select count(*) filter (where exists (select 1 from completed_sessions s where s.athlete_id = l.athlete_id and s.session_date = l.decision_date
                                        and s.completion_status in ('done', 'partial', 'replaced'))) as completed_days,
       count(*) as training_days
from latest l where coalesce(l.decision, '') <> 'REST';

-- M8. Week 5–6 retention
with cohort(athlete_id, start_date) as (values ('<ATHLETE_ID>'::uuid, '<START_DATE>'::date))
select count(*) filter (where exists (select 1 from pilot_observability_events e where e.athlete_id = c.athlete_id
                         and e.event_type = 'daily_run_succeeded' and e.event_date between c.start_date + 28 and c.start_date + 41)) as retained_w5_w6,
       count(*) as cohort_size
from cohort c;
```

---

## 7. Feedback

Formats et cadence : [FEEDBACK_TEMPLATE.md](FEEDBACK_TEMPLATE.md). Les retours sont consignés hors Git, comme le roster.
