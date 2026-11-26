import { expect, test } from "vitest";
import { allowsNoAuthentication, providerPresetId } from "./provider-presets";

test("keyless setup is offered only for loopback URLs", () => {
  for (const endpoint of ["http://localhost:11434/v1", "http://127.0.0.1:1234/v1", "http://[::1]:1234/v1"]) {
    expect(allowsNoAuthentication(endpoint)).toBe(true);
  }
  for (const endpoint of ["", "https://api.openai.com/v1", "http://127.evil:1234/v1", "https://localhost.example/v1", "http://192.168.1.2:1234/v1"]) {
    expect(allowsNoAuthentication(endpoint)).toBe(false);
  }
});

test("saved connection labels follow the endpoint rather than the editable name", () => {
  expect(providerPresetId({ kind: "openai_compatible", endpoint: "https://api.openai.com" })).toBe("openai");
  expect(providerPresetId({ kind: "openai_compatible", endpoint: "https://other.example/v1" })).toBe("openai_compatible");
  expect(providerPresetId({ kind: "nearai", endpoint: "https://cloud-api.near.ai" })).toBe("nearai");
});
