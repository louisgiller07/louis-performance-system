# Approbations sportives DH (V2-DH-RELEASE-GATES-01)

Ce dossier contient la preuve des validations sportives U, C, D, S et de la validation commune DH. Il est **vide** : aucune validation n'existe encore.

- `validators.json` : les valideurs autorisés. Pour chacun : identité, rôle, décisions qu'il peut signer, clé publique Ed25519, décision HPM qui l'autorise. Une entrée n'est ajoutée qu'après une décision HPM explicite.
- `records/<sujet>.<décision>.approval.json` : une décision d'un valideur. Elle contient le sujet (exercice ou `common`), la décision, le verdict `ACCEPT`, les versions du catalogue, l'empreinte sha256 du contenu exact approuvé et le dossier consulté (`chemin@commit`). Elle est signée avec la clé du valideur.
- `DH_SPORT_SIGNOFFS_V2` et `DH_SPORT_COMMON_SIGNOFF_V2` ne citent que ces enregistrements, sous la forme `approval:<sujet>/<décision>`.

## Cycle

1. **Préparer**, après avoir lu le dossier : `node tools/sportApprovalsCli.ts prepare <exercice|common> <unit|cue|dose|safety|common> <validatorId> <dossier@commit> [SECTION|FULL_RUN]`. La commande affiche le contenu exact servi aujourd'hui, l'enregistrement à signer et la ligne de table correspondante.
2. **Signer** : le valideur, et lui seul, avec sa clé privée qui ne quitte jamais son poste : `node tools/sportApprovalsCli.ts sign <record.json> <clé-privée.pem>`. Il dépose la sortie dans `records/`.
3. **Vérifier** : `npm run verify:sport-approvals`, appelé aussi par `build:release` de head-coach-engine. Tout écart échoue : référence sans enregistrement, valideur absent ou non autorisé pour cette décision, signature invalide, contenu, version ou dossier différents, verrou fermé sur le contenu servi.

Une modification de consigne, de dose ou de sécurité change l'empreinte. L'ancienne approbation ne vaut plus : il faut une nouvelle décision signée. Rien ne peut être accepté en silence.
