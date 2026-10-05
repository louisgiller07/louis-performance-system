# UX-11R — Constats produit Session Model V2

> **Statut au 2026-10-05 : 3 bugs OUVERTS, non corrigés.**
> Non bloquants pour les tests internes (D2A, D2B). **Bloquants avant toute bêta payante.**
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

## Règles

- Aucun correctif dans le cadre du rollout UX-11R : le moteur et le planificateur ne changent pas pendant les approbations.
- Chaque correctif demandera une décision de spec (docs canoniques), un ticket, des tests, puis un nouveau cycle de release.
