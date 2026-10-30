# PR2-DH-REVOCATION — corrections : état (HPM 2026-10-28)

**Appliquées localement** (commits non poussés) :
- statuts `docs/00` et `docs/12`, item P0 V2-DH-WITHDRAWAL, nouvelle entrée `docs/11` (les entrées antérieures restent telles quelles) ;
- dépendances du rapport et §6.3 de la procédure ;
- commentaire d'en-tête de la migration (aucun corps de fonction changé) ;
- en-tête et message du rollback (« a revocation is permanent: fix forward only »), assertion S3 sur le message complet ;
- les six diffs canoniques, dans un commit dédié, en attente d'approbation formelle.

**Reste à appliquer, au moment du push autorisé par Louis** : la description de la Draft PR #2 sur GitHub.
- Remplacer, dans « Known limits », la ligne :
  > « **Day without a decision.** If the first daily run of a day is refused, the rider has no decision that day until the forward fix. »
- Par :
  > « **No automatic restoration.** If the first daily run of a day is refused, the rider has no decision that day. The refusal repeats on every day whose prescription would contain the drill. Removing the drill from the code-level sign-offs does not restore the service. The concerned trainings stay suspended until the stored prescriptions are neutralised and safely replaced (V2-DH-WITHDRAWAL, reserve R1). A V2 → V1 switch is not a safe procedure: V1 shares the drill ids and does not read the revocation. »
- Ajouter :
  > « **Scope.** The revocation covers V2 prescriptions only; the V1 path never reads it. »
