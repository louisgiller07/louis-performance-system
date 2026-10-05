# UX-11R — Constats produit Session Model V2

> **Statut au 2026-10-05 : 7 constats OUVERTS, non corrigés.**
> BUG-V2-1 à 3 : non bloquants pour les tests internes, **bloquants avant toute bêta payante**. F-4 à F-7 : à qualifier.
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

## F-4 — Encart « Nouvelle version disponible » encore affiché après l'acceptation

**Constat (D2A, 2026-10-05)** : juste après l'acceptation réussie de `cd5cde79`, l'UI a brièvement continué d'afficher l'encart. Ce n'était pas une erreur serveur : 1 acceptation, plan courant correct.

**Hypothèse** : état client périmé (liste des brouillons non rechargée). À vérifier.

## F-5 — La page Aujourd'hui ne montre pas une séance guidée V2 terminée

**Constat (lecture du code, D2B1)** :
- la complétion V2 n'apparaît que sur `/today/session` ;
- sur Aujourd'hui, le bloc « après séance » (UX-08, ancien débrief) reste une invitation, et la semaine (`WeekStrip`) ne lit que `completed_sessions` ;
- un rider peut donc saisir aussi l'ancien débrief, ce qui crée une ligne `completed_sessions`. Le bridge préfère cette ligne à l'exécution V2.

**Attendu** : à définir dans la spec (une seule source de vérité pour « séance faite »).

## F-6 — Règles de la séance guidée appliquées par l'UI seulement

**Constat (lecture du code, D2B1)** :
- « au moins 1 passage pour terminer une séance DH » n'existe que dans l'UI : le serveur accepte `completed` sans passage ;
- après une exécution `completed`, le serveur accepterait une nouvelle exécution le même jour (seule une exécution non terminale bloque). C'est l'UI qui n'offre plus « Commencer ».

**Risque** : un autre client, ou un futur bug d'UI, contourne ces règles.

## F-7 — `projectedSessionCount` sans contexte

**Constat (D2A)** : 11 séances projetées pour un plan de 30. C'est le comportement prévu (fenêtre de 14 jours), mais l'événement ne le dit pas. Non bloquant ; à documenter dans l'observabilité.

## Règles

- Aucun correctif dans le cadre du rollout UX-11R : le moteur et le planificateur ne changent pas pendant les approbations.
- Chaque correctif demandera une décision de spec (docs canoniques), un ticket, des tests, puis un nouveau cycle de release.
