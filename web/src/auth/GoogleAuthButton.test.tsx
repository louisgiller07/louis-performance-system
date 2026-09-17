import { describe, expect, it, afterEach } from "vitest";
import { readOAuthCallbackError } from "./GoogleAuthButton";

afterEach(() => {
  window.history.pushState({}, "", "/");
});

// Unit coverage for the URL-parsing helper itself, independent of any page
// that uses it — LoginPage.test.tsx covers the access_denied case end to
// end; this covers the other branches directly.
describe("readOAuthCallbackError", () => {
  it("returns null and leaves the URL untouched when there is no error param", () => {
    window.history.pushState({}, "", "/login");

    expect(readOAuthCallbackError()).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("returns a generic curated message for a non-access_denied error code", () => {
    window.history.pushState({}, "", "/login?error=server_error&error_code=unexpected_failure");

    expect(readOAuthCallbackError()).toBe("Impossible de se connecter avec Google. Réessaie.");
  });

  it("strips the query string after reading it so a refresh doesn't re-show the message", () => {
    window.history.pushState({}, "", "/login?error=access_denied&error_code=access_denied");

    readOAuthCallbackError();

    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/login");
  });
});
