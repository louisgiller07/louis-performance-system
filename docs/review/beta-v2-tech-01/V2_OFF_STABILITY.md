# V2 OFF — stabilité de la suite complète d'intégration (revue finale, mission 1)

**Cadre** :
- pile jetable `nalynt-dhunit01` uniquement, **par le garde-fou**, pile neuve pour chaque passage ;
- worktree `C:/nx/betav2` ;
- aucune assertion ni aucun test modifié.

Les sondes sont hors dépôt (scratchpad `forkProbe.cjs`, chargée par `NODE_OPTIONS=--require`). Elles observent sans rien changer.

## Verdict

**Passage complet propre obtenu** : s18-2, le 29.10, sur pile neuve, sans aucun test ni aucune assertion modifiés.
- 1 254 réussis sur 1 254 non ignorés ; 0 échec, 0 test sans résultat, 0 erreur non gérée ;
- 0 worker mort, 0 rechargement du runtime ;
- code de sortie 0, en 471 s.

**Deux obstacles de l'environnement Windows de ce poste** restent intermittents. Aucun ne correspond à une assertion en échec ni à un fichier modifié :
1. **Morts de workers** : 5 passages sur 7 le 29.10. Le processus Node est arrêté par le système (`0xC0000409`). Cause native non identifiée sans vidage mémoire (§ 2).
2. **Rechargements parasites du runtime Edge** : 2 passages sur 7 (s17-1 sans effet ; s18-1, une requête coupée). Cause non démontrée (§ 3).

Sur 7 passages le 29.10, 2 se terminent normalement (s17-1, s18-2), et un seul est strictement propre (s18-2). Un passage propre sur ce poste reste donc une question de chance, pas une garantie.

## 1. Les passages complets (153 fichiers, 1 323 tests, 69 ignorés partout)

| Passage | Durée | Réussis | Échecs | Sans résultat (worker mort) | Rechargements du runtime |
|---|---|---|---|---|---|
| s10 (28.10) | 612 s | 1 218 | 0 | 36 : `sessionActivityResults` 0/6, `buildRawContext` 34/64 | 0 |
| s11 (28.10) | 632 s | 1 252 | **2** (`v2DhSportGate01c`, requêtes coupées par un rechargement) | 0 | **2** |
| s13 (28.10) | 627 s | 1 248 | 0 | 6 : `phys04MobilityBodyweight` 1/7 | 0 |
| s14 (29.10) | 470 s | 1 238 | 0 | 16 : `buildRawContext` 48/64 | 0 |
| s15 (29.10) | 464 s | 1 251 | 0 | 3 : `recentHistoryBridge` 0/3 | 0 |
| s16-1 (29.10) | 463 s | 1 215 | 0 | 39 : `buildRawContext` 25/64 | 0 |
| s16-2 (29.10) | 467 s | 1 252 | 0 | 2 : `consistency01TodayProgramme` 8/10 | 0 |
| s17-1 (29.10) | 493 s | **1 254** | 0 | 0 | 1 (`daily-run`, sans effet : la requête en vol avait déjà répondu) |
| s18-1 (29.10) | 466 s | 1 222 | **1** (`f6cStrengthCompletion` F : `fetch failed`, requête coupée par le rechargement, aucune assertion en cause) | 31 : `buildRawContext` 33/64 | **51 fichiers** `dist` d'un coup, au premier chargement de `daily-run` |
| **s18-2 (29.10)** | **471 s** | **1 254** | **0** | **0** | **0** |

Les tests « sans résultat » ne sont pas des échecs : le processus qui les portait a disparu avant de les exécuter. Chacun a réussi dans d'autres passages.

## 2. Morts de workers vitest : obstacle d'environnement Windows, cause native non identifiable sans vidage mémoire

vitest affiche seulement « Worker exited unexpectedly ». La sonde mesure ce qui suit pour les 5 morts du 29.10, sur 1 071 workers instrumentés.

| Mesure | Résultat |
|---|---|
| Code de sortie du processus | **3221226505 = `0xC0000409`** à chaque fois : arrêt immédiat (« fail-fast ») demandé au système, pas une sortie de Node |
| Sortie par Node (`process.exit`, fin normale) | aucune : l'événement `exit` de Node ne se produit pas |
| Exception JavaScript | aucune (`uncaughtExceptionMonitor`) |
| Rapport fatal de Node (`--report-on-fatalerror`) | aucun |
| Message sur la sortie d'erreur du worker | aucun ; la dernière ligne est la vérification de la cible locale, normale |
| Module natif chargé par les workers | **aucun** sur 918 workers instrumentés (`process.dlopen` : 0 appel) |
| Rapport d'erreur Windows (WER) ou événement système | aucun |
| Où | 8 morts en deux jours, dans 5 fichiers différents (`buildRawContext` 4 fois, à des tests différents), à des moments différents, entre deux tests ou au premier test ; worker vivant de 2 à 10 s |
| Mémoire libre du poste pendant les passages | 1,4 Go au minimum (31 Go au total ; 42 conteneurs des piles protégées tournent à côté) |
| Échec d'assertion | aucun, dans tous les passages sans rechargement |

**Conclusion** :
- le processus Node 24.15.0 du worker est arrêté par un fail-fast natif, à un moment quelconque, sans aucune trace exploitable ;
- aucun module natif n'est en jeu et aucun code JavaScript ne peut produire ce code de sortie : la cause est dans Node (V8, libuv, réseau) ou dans l'environnement Windows du poste ;
- les tests et le code métier ne sont pas en cause, mais la cause exacte (module, sous-code) **n'est pas identifiée**.

Il faut un vidage mémoire du processus pour l'identifier (§ 4).

## 3. Rechargements du runtime Edge : intermittents, cause non démontrée

**Symptôme** :
- `functions serve` signale « File change detected (WRITE) » et redémarre le runtime, alors que **ni le contenu ni la date d'écriture des fichiers ne changent** ;
- en s11, deux requêtes `session-execution` en vol ont échoué ; le fichier passe 3 fois sur 3 isolé.

**Ce qui est établi** :
- **Moment** : tous les événements observés (s11, s12, s17-1, s18-1) surviennent **au premier chargement d'une fonction** par le runtime, sur les fichiers de son graphe d'import (`session-execution/*`, `dist/.../pilotEvents.js`, `dist/.../planningModelRollout.js`, `daily-run/index.ts` et son dossier, 51 fichiers `dist` importés par `daily-run`).
- **Corrélation écartée** : les trois premiers tombaient 60 à 63 min après la dernière écriture des fichiers. En s17-1, `daily-run/index.ts` avait été écrit 16 h plus tôt et servi dans au moins quatre passages du 29.10 sans événement.
- **Hypothèse écartée** : la date de dernier accès NTFS. Témoin R3 valide (s16) : date d'accès reculée de 2 h, fonction réellement servie, date d'accès remise à jour, **0 événement**.
- **Fréquence** : 2 passages complets sur 7 le 29.10 (s17-1, sans effet ; s18-1 : 51 fichiers `dist` d'un coup, une requête coupée). Aucun dans le témoin R3. Tous les passages faisaient la pré-lecture des fichiers : son effet n'est pas démontré.
- **Origine probable** : une notification de changement parasite de la couche de partage de fichiers entre Windows et les conteneurs (Docker Desktop), lue par l'observateur de la CLI. Elle n'est pas démontrée.
- **Périmètre** : uniquement `supabase functions serve` sous Windows. La CI (Linux) ne sert pas les fonctions ; la production n'utilise pas `serve`.

**Garde-fou retenu** (sur la preuve, pas un correctif) : un passage n'est retenu que si le journal du runtime ne montre **aucun** rechargement pendant la suite. Sinon il est rejoué, jamais compté comme réussi.

**Erreur de méthode corrigée** : les premiers témoins (s14 R1/R2, s15 R3/R4) envoyaient leur requête avant que le runtime servi soit monté. Le 401 de disponibilité vient du runtime de la pile. Ils sont invalides et ne sont pas comptés. Seul s16 R3/R4 vérifie que la fonction a réellement été servie.

## 4. Pour aller plus loin (décisions de Louis)

| Piste | Ce qu'elle apporte | Ce qu'elle demande |
|---|---|---|
| Vidage mémoire automatique de `node.exe` par Windows (WER `LocalDumps`), le temps d'une campagne | le module fautif et le sous-code du fail-fast | une clé de registre machine (droits administrateur), retirée ensuite : **GO de Louis** |
| Même suite depuis Linux (WSL2, Node 24, même pile jetable) | confirme ou infirme un problème propre à Windows | une distribution WSL avec Node 24 : changement d'environnement |
| Job CI avec pile Supabase | une preuve hors de ce poste, et la confirmation GitHub Actions envisagée par le HPM | nouvelle infrastructure CI : décision de l'architecte ; push autorisé par Louis |
| Passage avec les piles protégées arrêtées (plus de mémoire) | teste l'hypothèse de la pression mémoire | toucher aux piles protégées : **GO de Louis** |
