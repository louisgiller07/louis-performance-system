# T4 — suspension générale des prescriptions V2 (conception, non développée)

**Statut** : solution minimale proposée. Elle **n'est pas développée dans ce lot** ; c'est une condition avant toute invitation de pilotes externes.

## Besoin

Arrêter vite l'exécution de prescriptions **déjà acceptées**, y compris hors DH (par exemple une dose de Force erronée) :
- sans supprimer ni réécrire de données ;
- avec une information explicite au pilote ;
- jamais déguisée en repos.

## Ce qui existe

| Moyen | Couvre | Ne couvre pas |
|---|---|---|
| Révocation DH (PR2) | un exercice DH : jours refusés, exécutions bloquées | hors DH ; définitive, sans retour |
| Coupure de génération | nouveaux programmes V2 | programmes acceptés (et, après T2, ne lève plus la protection DH) |
| `NALYNT_WRITES_SUSPENDED` | écritures de `session-execution`, `completed-session`, `accept-training-plan`, `health-flag-resolution` (503 neutre) | `daily-run` continue de servir les prescriptions ; message générique, sans motif sportif |
| Suspension santé (Safety A5 à A7) | un rider, pour un motif de santé | une erreur de contenu |

## Proposition minimale

**Un secret serveur de suspension par famille** : `NALYNT_V2_PRESCRIPTIONS_SUSPENDED`.
- **Valeur** : liste fermée de familles (`strength`, `endurance`, `dh`, `power`, `mobility`), ou `all`.
- **Absent ou vide** : comportement actuel.
- **Valeur invalide** : tout suspendre (fail-closed). Ce choix est à confirmer.

### Effets

1. **`daily-run`**, pour un document V2 d'une famille suspendue :
   - la décision du jour est conservée ;
   - aucune prescription finale n'est créée ;
   - statut explicite `suspended_by_nalynt` avec la famille, **jamais `REST`** : M1 n'est pas touché, seul le statut de la prescription finale V2 change ;
   - les jours des autres familles sont servis.
2. **`session-execution`** :
   - refuse `start` et `resume` pour une prescription d'une famille suspendue : 409 `prescriptions_suspended`, rien n'est écrit ;
   - `pause` et `abandon` restent permis ;
   - les résultats déjà enregistrés sont conservés.
3. **Web**, sur Aujourd'hui et dans la séance en cours, bannière explicite : « NALYNT a suspendu temporairement ses séances de <famille>, le temps de vérifier leur contenu. Tes données sont conservées. Tu peux t'entraîner librement en attendant. »
4. **Traçabilité** : événement pilote `prescriptions_suspended` (famille, date). Aucune donnée supprimée ni modifiée.
5. **Levée** : retirer le secret. Les programmes reprennent tels quels ; un contenu corrigé passe par une nouvelle version de catalogue et une régénération.

### Ce qui reste hors de cette proposition

- La suspension d'**un seul** exercice ou d'une seule dose : une table de suspensions par contenu, comme la révocation de PR2 mais réversible. Plus fine, mais plus lourde : migration, RPC, verrous.
- La suspension par pilote.

## Tests à prévoir (à l'implémentation)

- Secret absent : sorties identiques (différentiel).
- Chaque famille suspendue : statut `suspended_by_nalynt`, aucune prescription finale, jamais `REST` ; les autres familles sont servies.
- `start` et `resume` refusés en 409, `pause` et `abandon` permis, résultats conservés.
- Valeur invalide : tout est suspendu.
- Bannière web.
- Levée : reprise à l'identique, rien n'a été réécrit.

## Décisions nécessaires

1. **Granularité** : famille (proposé), ou exercice et dose (table).
2. **Valeur invalide** : tout suspendre, ou ignorer.
3. **Texte** du message au pilote.
4. **Statut quotidien** : `suspended_by_nalynt` est un nouveau terme. Il faut l'ajouter à `docs/07` après approbation.
