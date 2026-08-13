/**
 * Utilitaires de dates — parsing manuel (pas `new Date(isoString)`) pour
 * éviter toute ambiguïté de fuseau horaire : toutes les dates du moteur sont
 * des dates calendaires (YYYY-MM-DD), sans notion d'heure.
 */
function toUtcDays(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year as number, (month as number) - 1, day as number) / 86_400_000;
}

/** Nombre de jours entre deux dates ISO (b - a). Positif si b est après a. */
export function daysBetween(a: string, b: string): number {
  return toUtcDays(b) - toUtcDays(a);
}

/** 0 = lundi ... 6 = dimanche (ISO weekday, indépendant du fuseau local). */
export function isoWeekday(iso: string): number {
  const days = toUtcDays(iso);
  // Date.UTC(1970,0,1) = jeudi (weekday ISO 3, index 0-based)
  return ((days % 7) + 7 + 3) % 7;
}
