# P0-SAFE — diffs proposés aux documents canoniques (non appliqués)

**Pour** : HPM, validation avant application. **Statut** : proposé. Implémentation locale : ADR P0-SAFE (`docs/11_DECISION_LOG.md`), branche `fix/p0-safe-health-continuity`.

## `docs/04_DAILY_DECISION_ENGINE.md` — §2 Couche A

Table SAFETY : ajouter deux lignes après A5.

```diff
 | A5 | Retour post-commotion sans health_flag résolu | Zéro DH tant que non validé | HIGH |
+| A6 | `pain = true` ET `pain_intensity ≥ 6`, sans critère A2 / A4 (douleur forte non déclarée nouvelle) | REST + health_flag `injury_suspect` + orientation vers un professionnel de santé | HIGH |
+| A7 | health_flag `injury_suspect`, `illness` ou `pain_persistent` encore ouvert (actif / suivi) d'un jour précédent | REST + rappel du signal, aucun nouveau signal ; levé seulement par une clôture explicite du rider | HIGH |
```

Ajouter sous la table :

```diff
+**Ordre d'évaluation** : A1, A2, A3, A4, A6 (déclarations du jour), puis A7 (signaux ouverts des jours précédents), puis A5. A7 (REST) l'emporte sur A5 (zéro DH) quand les deux s'appliquent.
+
+**Clôture d'un signal (A7)** : explicite, par le rider (« la douleur / les symptômes ont disparu », consultation facultative déclarée), persistée sur le signal lui-même (`status = resolved`, `resolved_at`, `resolution_note`, `professional_consulted`). Ce n'est jamais une validation médicale. Aucun effacement automatique dans le temps. Un signal de commotion n'est pas clôturable par le rider (A5).
```

§« Douleur non-SAFETY » : préciser le périmètre.

```diff
-Une douleur **non-SAFETY** (légère/modérée, sans critère de gravité) doit :
+Une douleur **non-SAFETY** (intensité < 6/10, sans critère de gravité ; A6 couvre une douleur ≥ 6/10) doit :
```

## `docs/05_DATA_MODEL.md` — `health_flags`

```diff
+**Cycle de vie (P0-SAFE)** : créé par `persist_daily_run` (A1–A4, A6) ; lu par le moteur (type, statut, `flag_date`) ; clôturé uniquement par l'Edge Function `health-flag-resolution` (service role, athlète résolu par RLS), sauf `concussion_suspect`. Colonnes de clôture déjà existantes : `status`, `resolved_at`, `resolution_note`, `professional_consulted`. Aucune migration.
```

## `docs/06_ARCHITECTURE.md` — inventaire des Edge Functions

```diff
+- `health-flag-resolution` (P0-SAFE) : `POST { flagId, professionalConsulted? }` ; 200 `resolved` ; 400 corps invalide ; 401 sans JWT ; 404 `health_flag_not_found` (y compris le signal d'un autre athlète) ; 409 `health_flag_already_resolved` / `medical_validation_required` ; 503 `writes_suspended`.
```

## `CLAUDE.md`

Aucun changement de règle : P0-SAFE est une évolution M1 gouvernée (ADR, mandat HPM, tests et contre-preuves), comme `PLANNED_LOAD_CAP`. L'exemple peut être complété après validation.
