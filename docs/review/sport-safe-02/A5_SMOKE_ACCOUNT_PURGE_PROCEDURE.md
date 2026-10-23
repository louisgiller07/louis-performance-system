# A5 — purge du compte jetable de smoke (procédure préparée, NON exécutée)

Statut : préparée le 2026-10-23, à exécuter par Louis seulement, après un GO explicite. Elle reprend la procédure P0-SAFE (purge `test29`, 2026-10-12). Ce document ne contient ni adresse, ni identifiant, ni mot de passe. Remplacer `<EMAIL>` par l'adresse du compte jetable au moment de l'exécution, sans la reporter dans un rapport.

## Données concernées (constat du 2026-10-23, compte jetable seulement)

- Check-ins : 5.
- Décisions : 14.
- Signaux : 1 (clos).
- Attestations : 3.
- Séances planifiées : 11, dont 2 manuelles.
- Course fictive : 1.
- Créneaux de disponibilité : 7.
- Profil de performance : 1.
- Version de programme : 1 (V1).
- Séances réalisées, exécutions : 0.

`purge_athlete_account` supprime l'athlète et, en cascade, ses check-ins, décisions, signaux et attestations (`health_flag_attestations` porte `athlete_id` : la vérification interne de la fonction le couvre). L'identité Auth se supprime à part.

## Bloc 0 — contrôle de la fonction (lecture seule)

```sql
select p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
       has_function_privilege('service_role', p.oid, 'execute') as service_role_exec
from pg_proc p where p.oid = 'public.purge_athlete_account(uuid)'::regprocedure;
```

Attendu : `true`, `false`, `false`, `true`.

## Bloc 1 — identification et comptages de référence (lecture seule)

```sql
with target as (
  select u.id as uid, a.id as athlete_id
  from auth.users u left join public.athletes a on a.user_id = u.id
  where lower(u.email) = lower('<EMAIL>')
)
select (select count(*) from target) as matches,
       (select count(*) from target where athlete_id is not null) as with_athlete,
       now() as t0,
       (select count(*) from public.athletes where id not in (select athlete_id from target where athlete_id is not null)) as others_athletes,
       (select count(*) from auth.users where id not in (select uid from target)) as others_auth_users,
       (select count(*) from public.daily_checkins where athlete_id not in (select athlete_id from target where athlete_id is not null)) as others_checkins,
       (select count(*) from public.decisions where athlete_id not in (select athlete_id from target where athlete_id is not null)) as others_decisions,
       (select count(*) from public.health_flags where athlete_id not in (select athlete_id from target where athlete_id is not null)) as others_health_flags,
       (select count(*) from public.health_flag_attestations where athlete_id not in (select athlete_id from target where athlete_id is not null)) as others_attestations;
```

Attendu : `matches = 1`, `with_athlete = 1`. Sinon : **STOP**. Noter `t0` et les comptages.

## Bloc 2 — purge (écriture, une seule fois)

```sql
do $$
declare
  v_athlete uuid;
  v_n int;
begin
  select count(*), min(a.id::text)::uuid into v_n, v_athlete
  from auth.users u join public.athletes a on a.user_id = u.id
  where lower(u.email) = lower('<EMAIL>');
  if v_n <> 1 then
    raise exception 'purge refused: % matching athlete(s)', v_n;
  end if;
  perform public.purge_athlete_account(v_athlete);
end $$;
```

La fonction vérifie elle-même qu'aucune ligne de l'athlète ne reste dans une table portant `athlete_id`. En cas d'erreur, la transaction est annulée en entier.

## Étape 3 — identité Auth

Supprimer l'utilisateur `<EMAIL>` dans le Dashboard Supabase (Authentication → Users).

## Bloc 4 — vérification (lecture seule)

```sql
select (select count(*) from auth.users where lower(email) = lower('<EMAIL>')) as auth_users_left,
       (select count(*) from auth.identities where lower(identity_data ->> 'email') = lower('<EMAIL>')) as identities_left,
       (select count(*) from public.athletes) as athletes_now,
       (select count(*) from public.health_flag_attestations) as attestations_now;
```

Attendu :
- `auth_users_left = 0` et `identities_left = 0` ;
- `athletes_now` égal à `others_athletes` du bloc 1, si aucun compte n'a été créé depuis `t0` ;
- `attestations_now` égal à `others_attestations` du bloc 1.

## Étape 5 — nettoyage local

Supprimer `D:/nx-tmp/ss02a5/prod_smoke_account.json` (mot de passe), ainsi que `a5-prod-smoke-state.json` et `a5-prod-smoke-history.json`.
