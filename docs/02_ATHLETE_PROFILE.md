# 02 — Athlete Profile

**Athlète :** Louis Giller
**Version :** v0.1 (11 août 2026, post-onboarding complet)
**Statut :** canonique — seule référence pour les données factuelles sur Louis

## Règle épistémologique

Ce document sépare strictement trois catégories :

- **Faits** : mesurés ou déclarés lors de l'onboarding, vérifiables.
- **Hypothèses de coaching** : interprétations initiales révisables.
- **Patterns appris** : confirmés avec preuves longitudinales suffisantes.

**Aucune donnée ne doit être inventée.** Les informations manquantes sont marquées `UNKNOWN` ou `À VÉRIFIER`.

## Provenance des données

Pour chaque bloc factuel de ce document, la provenance doit être explicite. Aucune donnée ne doit être présentée comme "Fait" sans source vérifiable.

Sources possibles :
- **Onboarding [date]** : déclaration Louis lors de l'onboarding structuré du 11.08.2026
- **Supabase [table]** : donnée persistée dans une table de la DB V0.2
- **Déclaration Louis [date]** : déclaration ponctuelle datée hors onboarding structuré

Si la source exacte n'est pas retrouvable : **À VÉRIFIER**.

Claude Code doit considérer ce document comme la vérité sur l'athlète — il ne doit donc contenir que des informations dont la source est claire.

---

## 1. Identité

**Source principale** : Onboarding 11.08.2026 + Supabase table `athletes`

| Champ | Valeur | Source |
|---|---|---|
| Nom | Louis Giller | Onboarding + `athletes.name` |
| Date de naissance | 06.07.2007 | Onboarding |
| Âge au 11.08.2026 | 19 ans | Dérivé |
| Nationalité | Suisse | Onboarding + `athletes.nationality` |
| Région | Canton de Fribourg | Onboarding + `athletes.region` |
| Résidence | À VÉRIFIER (code postal 1609 déclaré à l'onboarding, adresse précise non vérifiée) | Onboarding |
| Instagram | @louis.giller | Onboarding |
| Website | louisgiller.ch | Onboarding |
| Discipline | VTT Downhill / gravity racing | Onboarding + `athletes.discipline` |
| Stade compétitif 2026 | Elite (transition U19 → Elite en cours) | Onboarding + `athletes.current_stage` |

---

## 2. Contexte professionnel et scolaire

**Source principale** : Onboarding 11.08.2026 (blocs 1, 5, 10)

| Champ | Valeur | Source |
|---|---|---|
| Statut | Apprenti informaticien | Onboarding bloc 1 |
| Taux d'activité | 100% déclaré à l'onboarding | Onboarding bloc 1 — À VÉRIFIER si contrat exact non re-confirmé |
| Rythme cours/entreprise | ~10 semaines de cours/an à partir de février | Onboarding bloc 5 |
| Horaires typiques | 07h30–17h00 | Onboarding bloc 1 |
| Trajet | ~20 min aller | Onboarding bloc 1 |
| Impact du travail sur entraînement | Très léger (déclaration Louis) | Onboarding bloc 1 |

### Disponibilité hebdomadaire

**Source** : Onboarding blocs 1 et 5

- **Lundi à jeudi** : soirée disponible à partir de ~17h30, jusqu'à ~22h30
- **Vendredi PM** :
  - Semaine en entreprise : libre selon déclaration Louis
  - Semaine en cours (~10 sur ~52 semaines) : travaillé jusqu'à 17h
- **Samedi et dimanche** : disponibilité complète

La disponibilité hebdomadaire précise est stockée par semaine dans Supabase table `weekly_availability`.

### Contraintes 2027 identifiées

- **TPI (examen d'apprentissage) juin 2027** : 2 semaines à disponibilité fortement réduite. Date exacte À VÉRIFIER.
- **10 semaines de cours à partir de février 2027** : dates exactes À VÉRIFIER.

---

## 3. Historique médical et santé

**Source principale** : Onboarding bloc 2 (11.08.2026)

⚠️ **Aucune donnée médicale n'a été confirmée par un professionnel de santé dans le cadre de ce système.** Toutes les informations ci-dessous proviennent de déclarations de Louis à l'onboarding.

### Blessures passées (déclarations Louis)

| Blessure | Date déclarée | Traitement déclaré | Séquelles déclarées | Source |
|---|---|---|---|---|
| Fracture pouce | ~2024 | Immobilisation | Aucune | Onboarding bloc 2 |
| Fracture scaphoïde | Octobre 2025 | Opérée, 3 mois récupération | Aucune | Onboarding bloc 2 |

### Statut actuel (déclarations Louis, onboarding bloc 2)

| Champ | Valeur | Source |
|---|---|---|
| Commotions (historique) | Aucune déclarée | Onboarding bloc 2 |
| Douleurs actuelles | Aucune déclarée | Onboarding bloc 2 |
| Mouvements limités | Aucun déclaré | Onboarding bloc 2 |
| Traitement médical en cours | Aucun déclaré | Onboarding bloc 2 |
| Médicaments réguliers | Aucun déclaré | Onboarding bloc 2 |
| Allergies / conditions | Aucune déclarée | Onboarding bloc 2 |
| Suivi médical de référence | Disponible et accessible selon Louis | Onboarding bloc 2 |

### Zones à surveiller (Hypothèse de coaching)

Deux fractures du membre supérieur en 2 ans (pouce + scaphoïde). Bien qu'aucune séquelle ne soit déclarée, le moteur applique une vigilance renforcée sur les zones poignet/main/pouce/avant-bras.

Cette vigilance est une **hypothèse de coaching**, pas une règle médicale. Voir `03_COACHING_MODEL.md` et `04_DAILY_DECISION_ENGINE.md`.

---

## 4. Historique physique et niveau actuel

### 4.1 Musculation (Faits)

**Source** : Onboarding bloc 3

| Champ | Valeur |
|---|---|
| Ancienneté musculation structurée | 1.5 an, continue |
| Encadrement | Autonome (YouTube, IA) |
| Périodisation | Aucune (split fixe depuis 1.5 an) |

**Split déclaré** : Lun haut / Mar bas / Mer pumptrack / Jeu cardio / Ven repos ou léger ou DH / Sam DH / Dim DH

**Split réel récent (4 dernières semaines)** : Lun muscu haut / Mar muscu jambes / Mer pumptrack / Jeu **repos** (au lieu de cardio) / Ven DH léger / Sam DH intense / Dim DH fun + 1-2 runs full

### 4.2 Baseline force au 11.08.2026 (Faits)

**Source** : Onboarding bloc 3 + Supabase `athlete_baselines`

| Mesure | Valeur | Contexte |
|---|---|---|
| Poids | 71 kg | Onboarding |
| Squat 1RM approx | 120 kg | Déclaration Louis |
| Deadlift 1RM approx | 100 kg | Type à préciser (classique vs roumain) |
| Développé couché 1RM approx | 65–70 kg | Déclaration Louis |
| Tractions max à poids de corps | 15 reps propres | Déclaration Louis |
| Dead hang max time | 1min15 (~75 sec) | À vide, deux mains, à la barre |

### 4.3 Baseline cardio

**Source** : Onboarding bloc 7

| Champ | Valeur | Statut |
|---|---|---|
| FTP (puissance seuil vélo) | Inconnu | UNKNOWN — test prévu inter-saison |
| FC max réelle | Inconnu | UNKNOWN |
| Modalités disponibles | Course extérieur + home trainer smart Zwift | Fait |
| Volume cardio récent | 0-1 séance/semaine | Fait |

### 4.4 Réactivité à l'entraînement (Déclarations Louis)

**Source** : Onboarding bloc 3

| Métrique | Valeur déclarée |
|---|---|
| Récupération jambes lourdes (habitué) | ~24h |
| Récupération jambes lourdes (déshabitué) | ~48h |
| Progression rapide sur | Squat |
| Progression bloquée sur | Développé couché |

**Note épistémologique** : ces valeurs sont des **déclarations subjectives** à valider avec les données longitudinales du checkin quotidien. Elles ne sont pas encore des patterns confirmés.

---

## 5. Matériel d'entraînement (Faits)

**Source** : Onboarding bloc 4

### Home gym (0 min de trajet, accès libre 24/7)

| Élément | Détail |
|---|---|
| Rack squat + barre olympique | Oui |
| Barre spéciale développé couché | Plafond 80 kg |
| Disques disponibles | 0.5, 1, 2.5, 5, 10, 20, 25 kg |
| Barre de traction | Oui |
| Haltères réglables | Jusqu'à 42 kg / bras |
| Banc plat | Oui |
| Banc inclinable | Oui, 30° |
| Machine à câbles | Poulie haute + basse |
| Presse / hack squat | Non |
| Espace saut / plyo | Oui |
| Gilet lesté | Jusqu'à 30 kg |
| Élastiques | Oui |
| Medicine ball | Non |

### Cardio à domicile

- Home trainer smart Zwift (mesure de puissance précise)
- Course à pied extérieure disponible

---

## 6. Sommeil, récupération, nutrition (Faits)

**Source** : Onboarding bloc 6

### 6.1 Sommeil

| Champ | Valeur déclarée |
|---|---|
| Coucher semaine | ~23h |
| Réveil semaine | ~7h |
| Durée effective | ~8h si bon sommeil |
| Coucher weekend | ~23h si session lendemain, ~24h sinon |
| Réveil weekend | ~8h (alarme) |
| Qualité ressentie | Bonne |
| Endormissement | Facile sauf si esprit pensif (rare) |
| **Réveils nocturnes** | **Fréquents pour toilettes, jusqu'à 1-2h du matin** |

### 6.2 Nutrition

| Champ | Valeur déclarée |
|---|---|
| Repas par jour (travail) | 2 + petit snack matin |
| Repas pré-DH | Digestion parfois compliquée |
| Compléments | Créatine + whey post-entraînement |
| Hydratation | ~2 L/jour |
| Stimulants | Red Bull occasionnel |

### 6.3 Récupération active habituelle

| Pratique | Fréquence |
|---|---|
| Étirements | Surtout en course |
| Sieste | Avant runs importants |
| Mobilité structurée | Aucune |
| Rouleau / auto-massage | Aucun |
| Bain froid / sauna | Aucun |

### 6.4 Plainte récupération principale (Fait déclaré)

**Douleur avant-bras / main sur volume DH cumulé** — spécifiquement course iXS 3 jours (trackwalk vendredi + entraînement/quali samedi + entraînement/finale dimanche).

---

## 6bis. Experiments actifs

**Source** : `03_COACHING_MODEL.md` §Experiments

### `sleep-liquids-cutoff-2026-08`

- **Hypothèse** : la coupure des liquides à 21h + arrêt Red Bull réduit les réveils nocturnes de Louis
- **Start date** : 2026-08-11
- **Intervention** : plus de liquides après 21h, zéro Red Bull
- **Metrics** : `sleep_wake_ups` dans le checkin quotidien
- **Review date** : À VÉRIFIER (~3-4 semaines après start_date)
- **Status** : active

Cette expérimentation influence le moteur tant que son statut est `active`. Après review, elle sera soit validée (devient heuristique permanente), soit rejetée, soit prolongée.

---

## 7. Profil technique DH

**Source** : Onboarding bloc 8

### 7.1 Forces techniques (Déclarations Louis)

- Génération de vitesse par pompage et engagement dans les virages relevés (berms)
- Pompage dans les bosses pour générer de la vitesse en sections plates

Correspond au profil du pilote bikepark rapide sur pistes travaillées.

### 7.2 Faiblesses techniques (Déclarations Louis)

- Sections rapides et précises : tendance au surfreinage par peur
- Sections techniques légères : manque de précision fine
- Engagement en conditions humides sur passages engageants (sauts, drops, raides)

**Note** : Louis est bon en boueux facile. La peur est spécifique au danger perçu en conditions difficiles.

### 7.3 Pattern de perte de temps en course (Déclarations Louis)

- **Pistes très physiques** : perte concentrée sur la fin de course
- **Autres pistes** : perte "globalement partout"

### 7.4 Course flow de référence

**Wiriehorn (Coupe Suisse)** : run où tout s'alignait mentalement. Dérailleur cassé → chrono impacté par la mécanique, pas par la performance mentale ou technique.

Utilisation dans le moteur : cue de départ "Comme à Wiriehorn." en phase PRE_EVENT, toutes priorités de course (hypothèse actuelle, révisable — voir `03_COACHING_MODEL.md` C2.1).

---

## 8. Mental et comportement en course (Déclarations Louis)

**Source** : Onboarding bloc 8

| Moment | État |
|---|---|
| Pit / attente avant départ | **Très stressé** (pic principal) |
| Au moment de partir | Meilleur, gérable |
| Pendant le run | Fonctionnel |
| Après erreur en run | Fragile — parfois "sort du mood" |
| Après course | 2-3 jours de digestion si mauvais résultat |

### Actifs mentaux identifiés

- **"Finaliste"** : meilleur en finale qu'en qualif (pattern rare et positif)
- **Motivation intrinsèque** haute actuellement
- **Course flow Wiriehorn** exploitable comme cue

### Hypothèses de coaching

- Le stress est concentré sur l'anticipation, pas sur l'action → point d'amélioration = protocole pit avant départ, pas gestion mentale au sens large.
- Cue post-erreur : technique plutôt qu'émotionnelle (à intégrer progressivement).
- Périodes de repos long non structurées = risque de creux mental (déclaration Louis sur les vacances).

---

## 9. Spots d'entraînement accessibles (Faits)

**Source** : Onboarding bloc 9

### Bikeparks

| Spot | Trajet | Coût marginal | Notes |
|---|---|---|---|
| Les Pléiades (Black Metal) | 15 min | Magic Pass | Piste de référence hivernale |
| La Berra | 25 min | Magic Pass | Local, course A+ 15-16 août 2026 |
| Leysin | 35 min | Magic Pass | Piste de référence saison |
| Verbier | 45 min | Abonnement saison | Course A+ 11-13 sept 2026 |
| Champéry | 45 min | Magic Pass | Anti-faiblesses (technique fine, humide) |
| Morgins | 50 min | Magic Pass | Variation |
| Macolin | 1h30 | 30-40 CHF | **Éviter mai-septembre** |

### Pumptracks

| Spot | Trajet | Disponibilité |
|---|---|---|
| Lieu de travail | 5 min | Pause / après travail |
| Bulle | 20 min | Weekend |
| St-Légier | 15 min | À partir de septembre 2026 |

---

## 10. Matériel vélo (Faits)

**Source** : Onboarding bloc 4

### Vélo DH principal

| Élément | Détail |
|---|---|
| Modèle | Santa Cruz V10 2025 |
| Configuration roues | Mullet (29" AV / 27.5" AR) |
| Fourche | Fox 40 Kashima GRIP X2 2025 |
| Amortisseur | Fox DHX2, ressort 500 lbs |
| Pneus | Continental — Kryptotal / Magic Mary / Shredda selon conditions |
| Freins | SRAM Maven, disques 220/200 |
| Roues | Reserve DH |

### Vélo secondaire prévu

- **Santa Cruz Bullit** (arrivée prochaine, date `UNKNOWN`)
- Usage : répétition de sections aux Pléiades (15 min trajet, sessions courtes possibles semaine)

### Politique setup

Louis gère 100% de son setup vélo en autonomie. **Le Head Coach ne fait aucune recommandation setup, ne stocke aucune donnée de setup, ne pose aucune question de suivi setup.** Ce périmètre est explicitement exclu du système.

Les événements mécaniques (crevaison, dérailleur cassé, frein défaillant) peuvent être loggés comme contexte de session/course afin d'éviter d'attribuer un mauvais chrono au physique ou au mental à tort.

---

## 11. Calendrier compétitif

### 11.1 Courses restantes 2026 (Faits)

**Source** : Supabase `race_calendar`

| Course | Série | Dates | Priorité | Format |
|---|---|---|---|---|
| La Berra | Hot Trail Series (Swiss DH Cup) | 15-16 août 2026 | A+ | HOT_TRAIL_2DAY |
| Verbier | iXS European Cup | 11-13 sept 2026 | A+ | IXS_3DAY |
| St-Luc | Hot Trail Series (Swiss DH Cup) | 26-27 sept 2026 | A | HOT_TRAIL_2DAY |
| Bellwald | iXS DHC | 2-4 oct 2026 | A | IXS_3DAY |

Maribor iXS EDC (25-27 sept 2026) : **retirée** (conflit St-Luc).

### 11.2 Objectifs saison 2027 (Déclarations Louis)

**Source** : Onboarding bloc 10

| Objectif | Cible déclarée réaliste | Cible stretch |
|---|---|---|
| Hot Trail Series (Swiss DH Cup) en Elite | Top 7 | Top 5 |
| iXS European Cup | Top 40 sur 1-2 courses idéales | — |
| Verbier iXS EDC (si maintenu 2027) | Meilleur résultat EDC de la saison | — |

### 11.3 Fenêtres critiques 2026

- **Race cluster 11 août → 4 octobre 2026** : 4 courses en 56 jours, mode opérationnel `RACE_CLUSTER` actif.
- **Enchaînement Verbier → St-Luc = 13 jours** : mode maintenance + T-X.
- **Enchaînement St-Luc → Bellwald = 5 jours** : pas de vraie récupération possible.
- **Après Bellwald** : fenêtre décharge complète prévue.

---

## 12. Priorités de développement identifiées (Hypothèses de coaching)

Ces priorités sont **des hypothèses initiales** issues de l'onboarding, à valider avec les données. Elles ne sont pas des vérités confirmées.

1. **Grip endurance** — potentiellement sous-développé (post-scaphoïde) et corrélé avec la douleur avant-bras sur volume DH cumulé.
2. **Deadlift** — ratio 1.41× BW inférieur au squat (1.69× BW), potentiellement sous-développé.
3. **Capacité aérobie structurée** — 0-1 séance cardio/semaine, aucune calibration objective. Test FTP prévu inter-saison.
4. **Confiance sections rapides / précises** — faiblesse technique la plus clairement identifiée.
5. **Nutrition** — 2 repas + snack potentiellement sous-alimentés vu la charge d'entraînement.
6. **Réveils nocturnes** — test coupure liquides 21h en cours.
7. **Débloquer développé couché** — plateau depuis un moment, hypothèse : manque de variation de stimulus.
8. **Introduction périodisation** — absence de périodisation depuis 1.5 an.

Ordre de priorité **provisoire**, à confirmer selon retours saison 2026 et évaluation post-Bellwald.

---

## 13. UNKNOWN / À VÉRIFIER

Champs à compléter ou confirmer progressivement :

- Adresse précise (code postal 1609 déclaré, rue à confirmer)
- Type de deadlift habituel (classique vs roumain)
- FTP (test cyclisme)
- FC max réelle
- Date exacte arrivée Bullit
- Date exacte TPI juin 2027
- Calendrier Hot Trail Series 2027 confirmé
- Calendrier iXS EDC 2027 confirmé
- Effet coupure liquides 21h sur réveils nocturnes (en test)
- Review date exacte de l'experiment `sleep-liquids-cutoff-2026-08`
- Baseline farmer's walk
- Baseline mobilité (hanches, thoracique)

---

## Versioning

- **v0.1** — 11 août 2026 — première formalisation post-onboarding complet
- **v0.2** — prévu post-La Berra (18 août 2026) — intégration du premier retour de course Elite
- **v0.3** — post-Bellwald (5-10 oct 2026) — synthèse complète des 4 courses restantes 2026
- **v1.0** — décembre 2026 — version stabilisée pour saison 2027

Toute modification importante de ce document est tracée dans `11_DECISION_LOG.md`.
