/**
 * Traçabilité des signaux consommés — empêche le double-counting.
 * Voir docs/03_COACHING_MODEL.md §3 et docs/06_ARCHITECTURE.md.
 *
 * Implémentation choisie : classe mutable passée en argument à travers le
 * pipeline. C'est l'exception documentée à la règle "fonctions pures par
 * défaut" (docs/08_CONVENTIONS.md §Structure du code).
 *
 * Contrat : un signal ne peut être "consommé" (`consume`) qu'une seule fois.
 * Un appelant qui reçoit `false` doit s'abstenir de citer ce signal comme
 * cause d'une nouvelle adaptation indépendante.
 */
export class SignalTrace {
  private readonly consumedBy = new Map<string, string>();

  /** Tente de consommer `signal` au nom de `ruleId`. Retourne false si déjà consommé. */
  consume(signal: string, ruleId: string): boolean {
    if (this.consumedBy.has(signal)) {
      return false;
    }
    this.consumedBy.set(signal, ruleId);
    return true;
  }

  has(signal: string): boolean {
    return this.consumedBy.has(signal);
  }

  consumedByRule(signal: string): string | undefined {
    return this.consumedBy.get(signal);
  }
}
