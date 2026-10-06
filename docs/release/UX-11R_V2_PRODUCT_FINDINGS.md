# UX-11R — Constats produit Session Model V2

> **Statut au 2026-10-05 : F-4, F-5 et F-6 corrigés EN LOCAL (UX-11R.9, non déployés) ; les autres constats restent OUVERTS.** Classement HPM (2026-10-05) :
>
> | Constat | Classement | Traitement |
> |---|---|---|
> | BUG-V2-1 jours de ride | bloquant avant bêta payante | **implémenté en local** (branche `feat/bug-v2-1-availability`, ADR BUG-V2-1), non déployé |
> | BUG-V2-2 progression | bloquant avant bêta payante | **implémenté en local** (branche `feat/bug-v2-2-progression`, ADR BUG-V2-2), non déployé |
> | BUG-V2-3 séance le jour de la génération | à corriger avant bêta | **implémenté en local** (branche `feat/bug-v2-3-start-date`, ADR BUG-V2-3), non déployé |
> | F-4 brouillon périmé acceptable | priorité 2, bloquant avant bêta payante | hardening UX-11R.9 (UI + serveur) |
> | F-5 complétion V2 hors séance guidée + doublon legacy | **P0 avant bêta** | hardening UX-11R.9 (UI + serveur) |
> | F-6 règles de la séance guidée côté UI seulement | **P0 / intégrité serveur** | hardening UX-11R.9 (F-6A, F-6B) |
> | F-6C fin d'une séance Force côté serveur | **P0 avant bêta payante** | ticket séparé |
> | F-7 `projectedSessionCount` sans contexte | polish, non bloquant | plus tard |
> | F-5d écart pont M1 / web (`skipped` legacy puis V2 terminée) | P0, partie de UX-11R.9 | **CLOSED en local** (priorité canonique unique) |
> | F-8 en-tête « Ton plan actuel » sur la vue d'un brouillon | polish, antérieur au patch | plus tard |
> | F-9 skeleton permanent du bloc « après séance » si la lecture de la séance guidée échoue | non bloquant | plus tard |
> | F-10 libellé legacy des messages Edge (`completed_session_v2_exists`, anglais/français) | non bloquant | plus tard |
> | T-1 test `athletePurge` (UX-11R.1) instable en suite parallèle (trigger DDL sur `athletes`, deadlock) | dette de test, non bloquant | plus tard |
> Constatés sur le premier plan V2 de production (`cd5cde79`, compte interne de simulation, Approbation D1) et reproduits dans la répétition locale avec le même profil (preflight §31.F, §32).

Contexte du profil :
- palier DH `advanced` ; 5 terrains déclarés ;
- créneaux : dimanche 07–21, lundi 19:30–21, mardi 17–19, mercredi 19:30–21, jeudi 19:30–21, samedi 08–18 ; vendredi sans créneau.

## BUG-V2-1 — Jours de ride et disponibilités mal utilisés

**Constat** (chaque semaine du plan) :
- DH technique le lundi soir (créneau de 90 min) et le mardi soir (créneau de 120 min) ;
- samedi (créneau de 10 h) : seulement 45 min d'endurance ;
- dimanche (créneau de 14 h) : jamais utilisé ;
- les jours de ride déclarés par le rider ne sont pas consommés par le planificateur.

**Attendu** : le DH va d'abord sur les jours de ride déclarés et les longs créneaux du week-end ; les créneaux courts de semaine servent à la force ou à l'endurance courte.

**Cause probable** : placement glouton (séances DH d'abord, première date libre qui convient), sans lecture des jours de ride.

## BUG-V2-2 — Aucune progression

**Constat** : les 6 semaines sont toutes `development` et toutes les séances sont MODERATE, avec la même rotation chaque semaine (2 DH, 2 force, 1 endurance). Aucune progression de charge, de volume ou de difficulté.

**Attendu** : une structure de bloc (progression, puis décharge) et une charge qui évolue d'une semaine à l'autre.

## BUG-V2-3 — Séance le jour même de la génération

**Constat** : la semaine 1 commence le jour de la génération (2026-10-05) et contient une séance DH 90 min ce même jour.

**Attendu** : à définir dans la spec. Soit le plan commence le lendemain, soit une séance du jour n'est proposée que si le créneau du jour est encore à venir.

## F-4 — Brouillon plus ancien présenté comme « Nouvelle version disponible », et acceptable

**Constat (D2A, confirmé en D2B1)** : sur le plan accepté, l'encart reste affiché, même après un refresh.

**Cause (lecture du code)** :
- la page recharge bien après l'acceptation ;
- l'encart montre le brouillon `draft` le plus récent ; ici, c'est le plan V1 généré pendant l'Approbation C (08:26), **plus ancien** que le V2 courant (08:54) ;
- « Voir la nouvelle version » permettrait de l'accepter et de remplacer le V2.

**Correctif** : hardening UX-11R.9.
- Serveur : `stale_plan_version`.
- UI : un brouillon n'est « nouveau » que s'il est plus récent que le plan courant.

## F-5 — La page Aujourd'hui ne montre pas une séance guidée V2 terminée

**Constat (lecture du code, D2B1)** :
- la complétion V2 n'apparaît que sur `/today/session` ;
- sur Aujourd'hui, le bloc « après séance » (UX-08, ancien débrief) reste une invitation, et la semaine (`WeekStrip`) ne lit que `completed_sessions` ;
- un rider peut donc saisir aussi l'ancien débrief, ce qui crée une ligne `completed_sessions`. Le bridge préfère cette ligne à l'exécution V2.

**Correctif** : hardening UX-11R.9.
- Lecture web « séance faite » commune.
- Garde serveur `completed_session_v2_exists`.

**Question ouverte (F-5b)** : le doublon inverse, une ligne legacy d'abord puis une séance V2, n'est pas couvert par le contrat validé (preflight §37.C).

## F-6 — Règles de la séance guidée appliquées par l'UI seulement

**Constat (lecture du code, D2B1)** :
- « au moins 1 passage pour terminer une séance DH » n'existe que dans l'UI : le serveur accepte `completed` sans passage ;
- après une exécution `completed`, le serveur accepterait une nouvelle exécution le même jour (seule une exécution non terminale bloque). C'est l'UI qui n'offre plus « Commencer ».

**Risque** : un autre client, ou un futur bug d'UI, contourne ces règles.

**Correctif** : hardening UX-11R.9, `dh_pass_required` (F-6A) et `session_already_completed` (F-6B).

## F-6C — Fin d'une séance Force sans résultat (ticket séparé)

**Constat** : la règle « au moins un résultat de travail actif avant la fin » d'une séance Force (UX-11C.2) n'existe que dans l'UI. Le serveur accepte `completed` sans série.

**Classement** : P0 avant bêta payante. Ticket séparé, pour ne pas élargir le hardening UX-11R.9.

## F-7 — `projectedSessionCount` sans contexte

**Constat (D2A)** : 11 séances projetées pour un plan de 30. C'est le comportement prévu (fenêtre de 14 jours), mais l'événement ne le dit pas. Non bloquant ; à documenter dans l'observabilité.

## Règles

- Aucun correctif dans le cadre du rollout UX-11R : le moteur et le planificateur ne changent pas pendant les approbations.
- Chaque correctif demandera une décision de spec (docs canoniques), un ticket, des tests, puis un nouveau cycle de release.

## F-5d — Écart entre le pont M1 et le web pour un jour `skipped` puis terminé en séance guidée (CLOSED en local, UX-11R.9)

**Constat (UX-11R.9, lecture du code)** : une ligne legacy `skipped` ne bloque pas une séance V2 (décision HPM).
- Si la séance V2 est ensuite terminée, le web (`dayCompletion.ts`) compte la journée comme réalisée.
- Le pont M1 (`recentSessionsForDailyContext.ts`) garde la ligne legacy : « une date avec une ligne `completed_sessions` ne prend aucune entrée V2 ». M1 voit donc un `skipped`.

**Impact** : rare (un `skipped` saisi puis une séance faite le même jour), mais la charge récente vue par M1 sous-estime ce jour-là.

**Correctif (UX-11R.9, patch final)** : priorité canonique unique.
1. ligne legacy non `skipped` ;
2. sinon V2 terminée ;
3. sinon `skipped` ;
4. sinon rien.

- `legacyRowsAfterGuidedPrecedence` est appliqué au pont (`recent_sessions`) et au contexte de récupération ; le web utilise `dayCompletion.ts`.
- Le moteur M1 figé n'est pas modifié.
- Tests unitaires, d'intégration et navigateur.

## F-8 — En-tête « Ton plan actuel » sur la vue d'un brouillon (observation, antérieure au patch)

**Constat (navigateur réel, UX-11R.9)** : quand on ouvre une ancienne version ou un brouillon, l'en-tête de Programme affiche « Ton plan actuel », alors que la carte en dessous dit « Version non active » ou « Version plus ancienne que ton plan actif ». `ProgramHero.tsx` n'a pas changé depuis `6d01c88`.

**Classement proposé** : polish, non bloquant ; hors de UX-11R.9.
