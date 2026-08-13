# 00 — Project Status

**Dernière mise à jour :** 13 août 2026
**Version canonique en cours :** V0.2
**Phase actuelle :** M1 — Vertical Slice locale du Head Coach Engine (implémentée, en attente de revue Louis)

## Où on en est réellement

### DONE

- **Onboarding athlète complet** (11 blocs), source de vérité pour `02_ATHLETE_PROFILE.md`
- **DB Supabase V0.2 déployée et validée** : 12 tables, enums, RLS, triggers, seed data Louis
- **Spec Head Coach Engine V0.2 consolidée** (dans les échanges Claude Project) avec tous les principes canoniques :
  - Multidimensional athlete state
  - Décisions basées sur les causes
  - Prévention du double-counting
  - T-X en tant que default framework
  - Support courses multi-jours
  - SAFETY reformulée
  - Soft constraints réellement arbitrables
  - Douleur non-SAFETY produit monitoring/protection/adaptation
  - Séparation DB `session_type` vs `TrainingIntervention` interne

### IN PROGRESS

- **Export des documents canoniques dans `/docs`** — cette Passe 1 est le début. Les Passes 2 et 3 suivront.

### IMPLÉMENTÉ LOCALEMENT — en attente de revue Louis et de commit

- **Vertical Slice locale du Head Coach Engine** dans `head-coach-engine/` : pipeline complet `RawContext → DailyPlan` (dimensions, SAFETY A1-A5, mode + race/event context + protocole T-X, domaines Training + Recovery, arbitrage KEEP/MODIFY/REPLACE/REST, mapping `TrainingIntervention ↔ DbSessionType`), fixtures Louis, CLI de démonstration.
- **Tests** : 74/74 verts (`npm test`), couvrant T1-T8 + T10 de `docs/10_TEST_PLAN.md` + tests unitaires complémentaires (signaux systemic causaux, garanties A5/override_reason, arbitrage des soft constraints strong). T9 (ActiveExperiment runtime) non implémenté, conforme au scope P1.
- **Build** : `npm run build` (TypeScript strict) sans erreur.
- **Rien n'est encore commité/poussé sur GitHub** — en attente de validation de Louis avant commit, conformément à `CLAUDE.md` §Communication avec Louis.

### NOT STARTED

- Connexion Supabase read-only (M2).

## Prochaines étapes (ordre)

1. **Terminer l'export des documents canoniques** (Passes 2 et 3) et pousser sur GitHub.
2. **Lancer Claude Code** dans le repo pour la vertical slice locale du Head Coach Engine.
3. **Valider la vertical slice** par les tests de `docs/10_TEST_PLAN.md`.
4. **Connexion Supabase read-only** (lecture du contexte réel Louis).
5. **Écriture des `decisions`** dans Supabase.
6. **Edge Function ou API légère** exposant le moteur.
7. **Première interface de check-in** (Today screen).
8. **LLM comme couche E, UI mobile, intégrations wearables** — plus tard, après validation des étapes précédentes.

## Prochain milestone

**M1 — Vertical Slice locale complète et testée**

Statut : **IMPLÉMENTÉ LOCALEMENT — en attente de revue Louis avant commit/push et décision Go/No-Go M2**

Critères de sortie M1 :
- [x] Pipeline `RawContext → DailyPlan` implémenté selon `docs/04_DAILY_DECISION_ENGINE.md`.
- [x] Tous les tests T1–T8 + T10 de `docs/10_TEST_PLAN.md` passent au vert (51/51).
- [x] T9 (ActiveExperiment runtime) est P1, pas M1 — non implémenté, concept documenté.
- [x] Tests déterministes (aucune sortie alternative acceptée).
- [x] CLI locale de démonstration fonctionnelle (`npm run run:example <scenario>`).
- [x] Build TypeScript sans erreur (`npm run build`).
- [ ] Revue Louis.
- [ ] Commit / push.
- [ ] Décision Go/No-Go M2.

Sortie de M1 déclenche :
- Mise à jour de ce fichier
- Revue Louis
- Décision Go / No-Go pour M2 (connexion Supabase read-only)

## Règle

**Ne pas marquer une étape comme `DONE` avant qu'elle existe réellement dans Git.**
