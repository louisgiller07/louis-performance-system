# P0-SEC-MAINTAIN — condition de version et décision (note de préparation)

**Date** : 2026-10-14 · **Pour** : HPM (via Louis) · **Statut** : approuvée en principe comme 8e migration de REL-01, **seulement si la version de production le justifie**. Rien n'est intégré à l'assemblage accepté (73 migrations, `rel/rel-01-assembly` `56b604e`, inchangé).

## 1. Condition exacte (clarification)
Le message de synthèse de la revue finale disait « sans effet **sous** PostgreSQL 17 ». La formulation est **inexacte**. Le rapport (§2) disait correctement « sans effet sur PostgreSQL **inférieur à** 17 ».

La condition réelle de la migration `20261014150000` et de son rollback est :

```sql
if current_setting('server_version_num')::int < 170000 then  -- PostgreSQL 15.x, 16.x
  raise notice '... has no MAINTAIN privilege, nothing to revoke';
  return;                                                      -- rien n'est modifié ; la migration est enregistrée
end if;
-- PostgreSQL 17.0 et plus (>= 170000) : révocation, privilèges par défaut, contrôle fail closed
```

| Version de production | Effet de la migration | Prouvé |
|---|---|---|
| **15.x ou 16.x** (`server_version_num` < 170000) | **aucun** : NOTICE, réussite, ACL inchangées ; le rollback est aussi sans effet | PostgreSQL **16.15**, conteneur jetable sans port, supprimé après l'essai. Contre-preuve : `revoke maintain` non protégé → « unrecognized privilege type "maintain" ». |
| **17.x et plus** | révocation de MAINTAIN pour `anon` (9 tables) et `authenticated` (12 tables), retrait des privilèges par défaut de `postgres`, vérification fail closed | PostgreSQL **17.6** (`nalynt-qa01`, 74 migrations) : 29/29, non-régression 121/121 et 18/18, rollback et ré-application |

## 2. Décision selon le relevé de Louis
Relevé en lecture seule : `docs/review/REL_01_PG_VERSION_AND_SENSITIVE_PRIVILEGES.sql`, partie 0, sur l'assemblage.

**Production en PostgreSQL 17 ou plus (décision HPM 5)** :
- assemblage local **distinct** préparé : `rel/rel-01-assembly-maintain`, depuis `56b604e`, plus cette migration en **8e** (`20261014150000`, après `20261014120000`) ;
- l'assemblage de 73 migrations n'est pas modifié ;
- à faire après confirmation de la version et GO : stack neuve vérifiée par le harnais QA-ISOLATION-01, 74 migrations, puis rejeu des tests affectés (`p0SecMaintain`, `p0SecTrigger`, `p0SecTruncate`, `athletesDeleteGrant`, P0-SAFE, P0-3, INT-01, purge, séances, web) et de la configuration de rollback vers C.

**Production en PostgreSQL 15 ou 16 (décision HPM 6)** : on conserve l'assemblage de 73 migrations. MAINTAIN n'est pas applicable :
- le droit MAINTAIN **n'existe pas** avant 17 (la migration ne pourrait que le constater) ;
- l'exposition décrite n'existe pas (**vérifié sur PostgreSQL 16.15**, rôle n'ayant que SELECT sur `decisions` : `LOCK … ACCESS EXCLUSIVE` → « permission denied », `REINDEX` → « must be owner », `VACUUM FULL` → « permission denied to vacuum …, skipping it ») :
  - VACUUM, ANALYZE, REINDEX et CLUSTER exigent d'être propriétaire de la table, et les rôles d'API ne le sont jamais ;
  - un verrou `ACCESS EXCLUSIVE` exige UPDATE, DELETE ou TRUNCATE ; `authenticated`, qui n'a que SELECT sur `decisions`, `health_flags` et `completed_sessions`, ne peut pas l'obtenir ;
- après toute montée de version majeure vers 17, relancer le script d'inventaire avant de décider d'appliquer cette migration. Point non prouvé ici, à vérifier à ce moment-là : la réapparition de MAINTAIN dépend de la façon dont les droits « ALL » sont restaurés.

## 3. Risques acceptés (décision HPM 2), sans nouveau correctif
Ces risques sont acceptés dans leur périmètre d'exposition démontré (rapport de revue finale §3 et §6) :
- **EXECUTE des fonctions déclencheuses** : aucune n'est appelable directement ni exposée en RPC ; la création de trigger est interdite depuis P0-SEC-TRIGGER.
- **REFERENCES** : inutilisable (aucun CREATE sur un schéma, pas de clé étrangère depuis une table temporaire).
- **Privilèges par défaut de `supabase_admin`** : ils ne concernent qu'une table `public` créée par `supabase_admin` (aucune aujourd'hui). Toute réapparition est détectée par les tests catalogue et le script d'inventaire.

Toute nouvelle preuve de risque significatif rouvrirait le sujet. Il n'y a pas de nouvel audit général.

**READY LOCAL ≠ READY PRODUCTION.** Aucun push, merge, déploiement, SQL distant ni flag.
