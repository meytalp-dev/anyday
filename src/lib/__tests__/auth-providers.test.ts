import { describe, it, expect } from "vitest";
import { isProviderEnabled } from "../auth-providers";

/**
 * A login button for a provider the project has switched off is worse than no
 * button: the visitor clicks, nothing happens, and they conclude the product is
 * broken. That is exactly what a customer met on 2.9 — Google was `false` in
 * the Supabase project and the button was rendered anyway.
 *
 * So the rule these tests pin down is FAIL CLOSED: show the button only when
 * the project positively confirms the provider is on.
 */
describe("isProviderEnabled", () => {
  it("is true when the project reports the provider as on", () => {
    expect(isProviderEnabled({ external: { google: true } }, "google")).toBe(true);
  });

  it("is false when the project reports the provider as off", () => {
    expect(isProviderEnabled({ external: { google: false } }, "google")).toBe(false);
  });

  it("is false when the provider is absent from the list entirely", () => {
    expect(isProviderEnabled({ external: { github: true } }, "google")).toBe(false);
  });

  it("does not confuse one provider for another", () => {
    const settings = { external: { google: false, github: true } };
    expect(isProviderEnabled(settings, "google")).toBe(false);
    expect(isProviderEnabled(settings, "github")).toBe(true);
  });

  // Every shape below means "we could not confirm" — a failed fetch, an error
  // body, an old gateway. None of them may light the button up.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an error body", { error: "unauthorized" }],
    ["a string", "google"],
    ["external as a non-object", { external: "google" }],
    ["a truthy non-boolean value", { external: { google: "yes" } }],
  ])("is false for %s", (_label, settings) => {
    expect(isProviderEnabled(settings, "google")).toBe(false);
  });
});
