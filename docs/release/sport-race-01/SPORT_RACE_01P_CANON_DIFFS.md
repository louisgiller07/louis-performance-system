# SPORT-RACE-01P — diffs canoniques proposés (pour approbation avant intégration)

**Pour** : HPM et Louis · **Statut** : proposés, **non appliqués** à `docs/03`, `docs/05` et `docs/10`.

**Base** : option P approuvée par l'HPM le 2026-10-19, comme contrat fonctionnel cible. Le code de la branche `fix/sport-race-01` l'implémente déjà, en local. Tant que ces diffs ne sont pas approuvés, le code est en avance sur le canon, qui dit encore « semaine de course : aucune séance normale ».

**Hors de ces diffs** :
- aucune dose ni aucun seuil sportif ne change ;
- `docs/04` est inchangé : les tables T-X sont déjà canoniques ;
- M1 est inchangé.

---

## 1. `docs/03_COACHING_MODEL.md` §6, politique de dose du plan V2

**Remplacer**

```
  - semaine de course : aucune séance normale.
```

**par**

```
  - jours d'avant-course (SPORT-RACE-01P, option P, HPM 2026-10-19) : pour une course A+, A ou B dont le format a un protocole T-X (`HOT_TRAIL_2DAY`, `IXS_3DAY`, `docs/04` §3), le plan place la séance du protocole les jours de T-7 à T-1 qui n'ont pas d'autre séance, seulement quand elle a un modèle V2 et une dose existante, sur un créneau de la bonne activité et une seule séance par jour :
    - T-7 Force haut du corps légère : dose Force de la semaine d'affûtage (45 min) ;
    - T-6 DH technique : dose DH de la semaine d'affûtage (légère, 60 min, 4 passages), jamais relevée ;
    - T-4 et T-3 récupération active : protocole `recovery_active_v1`, réservé à son minimum déclaré (20 min) ;
    - rien à T-5 (« endurance courte » de 30 min : aucune endurance V2 sous 45 min), aux jours REST, à l'activité officielle de T-1 (IXS), aux jours de course ni aux deux jours qui suivent une course ;
    - une DH de la semaine d'affûtage tombée sur un jour du protocole d'un autre type va au jour DH du protocole (T-6) quand il est libre et a un créneau vélo assez long ; une séance tombée sur un jour REST du protocole est retirée ;
    - format sans protocole (`SWISS_CUP`, `UCI_WC`, `UCI_WORLDS`, `OTHER`, absent) : aucune séance d'avant-course ; la préparation spécifique n'est pas définie, et aucun protocole générique n'est supposé ;
    - valeurs PROVISIONAL (politique `race-protocol-plan-v1`), à valider par un préparateur ;
  - semaine de course : en dehors des jours d'avant-course ci-dessus, aucune séance normale.
```

**Inchangé**, et rappelé explicitement dans la même section :

> « Un KEEP sans séance prévue (récupération par défaut, protocole avant course) n'a pas de prescription du jour : aucune séance n'est inventée. »

Les séances d'avant-course viennent du plan, jamais du moteur quotidien.

---

## 2. `docs/05_DATA_MODEL.md`

### 2.1 Snapshot de génération v2 (ligne 232)

**Remplacer**

```
le snapshot v1 plus `dhTechnicalTier` (`beginner` | `intermediate` | `advanced` | `null`).
```

**par**

```
le snapshot v1 plus `dhTechnicalTier` (`beginner` | `intermediate` | `advanced` | `null`) ; chaque course porte en plus `raceFormat`, le format déclaré (`race_calendar.race_format`), absent si le rider n'en a pas donné (SPORT-RACE-01P, JSON additif, aucune colonne ; un snapshot antérieur sans format ne place aucune séance d'avant-course).
```

### 2.2 Progression V2 (ligne 253)

**Ajouter** à la fin du paragraphe :

```
SPORT-RACE-01P : `reasonCodes` peut contenir `race_protocol_sessions` et la progression porte alors `raceProtocolPolicy` (`race-protocol-plan-v1`) ; une semaine `race` peut avoir `sessionCount` > 0 (séances d'avant-course du protocole), ses `targets` reprenant alors les doses d'affûtage de ce qui est placé.
```

### 2.3 Invariants des séances d'avant-course (nouveau paragraphe, après la lignée prévu → prescription du jour)

```
*Séances d'avant-course (SPORT-RACE-01P)* : ce sont des séances générées ordinaires de la version courante.
- **Lignée et prescription** : KEEP copiable (le T-X de M1 a le même type et la même charge ; la DH MODERATE du protocole est plafonnée à la DH LIGHT prévue par `PLANNED_LOAD_CAP`). Prescription du jour, exécution, verrou de jour utilisé, suspension santé et historique : règles existantes, sans exception.
- **Récupération** (type `RECOVERY_ACTIVE`, sans charge) : 0 minute dans l'historique V2 de la génération (V2-L2), comme toute récupération.
- **Moteur quotidien inchangé** : un jour du protocole sans séance planifiée reste une recommandation sans prescription (`no_planned_session`) ; fatigue, douleur, Safety et P0-SAFE adaptent ou remplacent la séance planifiée comme toute autre.
- **Course ajoutée, déplacée ou annulée après la génération** : le plan n'est jamais modifié silencieusement. Seule une nouvelle génération, explicite et acceptée, recalcule les jours d'avant-course. Les jours utilisés, les exécutions, les décisions et les prescriptions figées ne sont jamais réécrits (projection PILOT_022, CONSISTENCY-01, verrou de jour). Sans régénération, les séances déjà planifiées restent des séances légères ordinaires (course annulée ou déplacée) ou les séances normales de la semaine (course ajoutée), et M1 applique chaque jour le T-X de la course réelle.
```

---

## 3. `docs/10_TEST_PLAN.md`, nouveau T67 (après T66)

```
### T67. SPORT-RACE-01P — jours d'avant-course planifiés depuis le protocole de course (HPM 2026-10-19)
Règles : `docs/03` §6 (jours d'avant-course), `docs/05` (snapshot v2 `raceFormat`, invariants des séances d'avant-course), `docs/04` §3 (T-X, inchangé).
- **Acceptation, unitaires** (`sportRace01pRaceProtocolPlacement.test.ts`, `sportRace01pProtocolMirror.test.ts`) :
  - HOT_TRAIL_2DAY du samedi, créneaux vélo le week-end : la DH d'affûtage passe de J-7 à J-6, même dose ; récupération à J-4 et J-3 ; rien à J-5, J-2, J-1 ni les jours de course ;
  - IXS_3DAY du vendredi : Force haut LIGHT 45 à J-7 sur un créneau physique, DH d'affûtage à J-6, récupération à J-4 et J-3 ;
  - trois créneaux (mardi et jeudi physique, samedi vélo) : la DH de J-7 reste (aucun créneau vélo à J-6), récupération à J-4 ;
  - course du lundi : la DH tombée sur le REST de J-2, sans créneau pour la déplacer, est retirée ;
  - deux courses rapprochées : rien les jours de la première course ni les deux jours qui suivent ;
  - jour indisponible, course C, format sans protocole : rien ; plan identique (empreinte) à celui d'une course sans format ;
  - une séance par jour au plus ; contenus V2 existants (`recovery_active_v1`, gabarit Force haut LIGHT, DH à 4 passages) ;
  - la table du planificateur est celle de M1, jour par jour (contre-preuve : les autres formats n'ont rien dans les deux).
- **Acceptation, intégration** (`sportRace01.integration.test.ts`, chemins réels) : les jours planifiés sont des KEEP `created` (Force à J-7, DH plafonnée LIGHT à J-6, récupération à J-4 et J-3) ; J-5, J-2 et J-1 restent des recommandations `no_planned_session` ; fatigue et douleur adaptent la séance planifiée ; Safety prioritaire ; course ajoutée : aucun changement avant une régénération explicite, puis séances d'avant-course placées, jour utilisé, exécution et décision intacts ; course annulée : séances déjà planifiées ordinaires ; aucun doublon.
- **Non-régression** : plans sans course ou sans format identiques à la production ; quotidien inchangé (`daily-run` : même bundle, différentiel flags OFF `phys00FlagsOffEquivalence.test.ts` inchangé) ; V1 inchangé.
- **Web** (`sportRace01p.test.tsx`) : un jour sans séance prévue n'affiche jamais la durée de M1 (« 4 h ») comme une prescription ; bandeau « Préparation spécifique non définie » à 7 jours ou moins d'une course sans protocole ; explication du plan traduite.
```

---

## 4. Textes rider proposés (à valider avec ces diffs)

| Où | Texte |
|---|---|
| Aujourd'hui, mission d'un jour sans séance prévue | « Ton programme ne prévoit pas de séance ce jour-là : c'est un conseil, sans séance guidée ni durée prescrite. » |
| Bandeau de course, 7 jours ou moins, format sans protocole | « Préparation spécifique non définie pour ce format de course : NALYNT ne planifie pas de séance les jours qui la précèdent. » |
| Explication du plan | « Les jours avant la course suivent son protocole : séances placées quand le format, le jour et tes disponibilités le permettent. » |
| Bande de la semaine, jour sans séance prévue | « Pas de séance guidée » (texte existant de SPORT-SAFE-RELEASE-01), sans durée |
