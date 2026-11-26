import { expect, test } from "vitest";
import fixture from "../fixtures/provider-profile.json";
import type { ProviderProfile } from "./index";

test("the provider profile fixture is secret-free and compatible with the typed contract", () => {
  const profile = {
    ...fixture,
    kind: "nearai",
    auth_method: "bearer",
    transport_security: "tls"
  } satisfies ProviderProfile;

  expect(profile.endpoint).toBe("https://cloud-api.near.ai");
  expect(profile.configured).toBe(true);
  expect(profile).not.toHaveProperty("secret");
});
