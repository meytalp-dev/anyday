import { describe, it, expect } from "vitest";
import { parseAuthFragment } from "../auth-fragment";

/**
 * Supabase hands a session back in one of two shapes: `?code=` in the query
 * (PKCE), or `#access_token=` in the URL fragment (implicit). A fragment is
 * never transmitted to the server, so the callback ROUTE cannot see it — on
 * 2.9 a perfectly valid login link landed on a page that concluded nothing had
 * arrived. This parser is the browser half that reads the shape the server is
 * blind to.
 */
describe("parseAuthFragment", () => {
  it("reads a session out of an implicit-flow fragment", () => {
    const r = parseAuthFragment("#access_token=abc123&refresh_token=xyz789&token_type=bearer");
    expect(r).toEqual({ kind: "session", accessToken: "abc123", refreshToken: "xyz789" });
  });

  it("works whether or not the leading # is included", () => {
    const withHash = parseAuthFragment("#access_token=a&refresh_token=b");
    const without = parseAuthFragment("access_token=a&refresh_token=b");
    expect(without).toEqual(withHash);
  });

  it("reads an error the auth server reported", () => {
    const r = parseAuthFragment(
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"
    );
    expect(r).toEqual({
      kind: "error",
      code: "otp_expired",
      description: "Email link is invalid or has expired",
    });
  });

  it("decodes a percent-encoded description", () => {
    const r = parseAuthFragment("#error=x&error_description=Token%20has%20expired");
    expect(r).toMatchObject({ kind: "error", description: "Token has expired" });
  });

  // A half-formed session is not a session. Calling setSession with a missing
  // refresh token yields a login that dies at the first refresh, which is a
  // far more confusing failure than being told plainly that it did not work.
  it("refuses a fragment carrying only an access token", () => {
    expect(parseAuthFragment("#access_token=abc&token_type=bearer")).toEqual({ kind: "none" });
  });

  it("refuses a fragment carrying only a refresh token", () => {
    expect(parseAuthFragment("#refresh_token=xyz")).toEqual({ kind: "none" });
  });

  it.each([
    ["an empty string", ""],
    ["a bare hash", "#"],
    ["unrelated content", "#section-2"],
  ])("reports nothing for %s", (_label, hash) => {
    expect(parseAuthFragment(hash)).toEqual({ kind: "none" });
  });

  it("prefers reporting the error when a fragment somehow carries both", () => {
    const r = parseAuthFragment("#error=access_denied&access_token=a&refresh_token=b");
    expect(r.kind).toBe("error");
  });
});
