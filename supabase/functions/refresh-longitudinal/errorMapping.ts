// V0.3_001A — maps any unexpected failure along the refresh-longitudinal
// path to a sanitized HTTP response. This endpoint takes no client input at
// all beyond the empty request body (no athleteId/date/range fields), so
// there is no rich client-correctable error taxonomy the way daily-run has
// for check-in/business validation — every failure here is, by
// construction, an unexpected/environmental one.
//
// MANDATORY (V0.3_001A spec, "internal vs HTTP error safety"): raw
// Postgres/RPC/SQL error text must never reach the browser. The real error
// (which may legitimately include a short Postgres error code, e.g. from
// SupabaseLongitudinalSourceAdapter's own `Error(...: ${error.code})`
// messages) is logged server-side via console.error only; the HTTP
// response always carries this fixed, sanitized message.
export interface MappedRefreshLongitudinalError {
  status: number;
  code: string;
  message: string;
}

export function mapRefreshLongitudinalError(_error: unknown): MappedRefreshLongitudinalError {
  return { status: 500, code: "internal_error", message: "An unexpected error occurred while refreshing longitudinal data." };
}
