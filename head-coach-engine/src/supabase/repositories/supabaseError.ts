/**
 * Shared error-propagation helper for repositories — not a generic
 * CRUD abstraction, just a single place to fail loudly on a Supabase
 * client error instead of letting `{ data: null, error }` leak silently
 * into a mapper expecting real data.
 */
export function assertNoSupabaseError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`Supabase read failed (${context}): ${error.message}`);
  }
}
