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

test("preset matching normalizes origins and preserves API paths", () => {
  for (const [endpoint, expected] of [
    ["https://api.openai.com:443/v1", "openai"],
    ["https://API.OPENAI.COM:443/v1///", "openai"],
    ["https://api.openai.com/", "openai"],
    ["https://openrouter.ai:443/api/v1", "openrouter"],
    ["https://api.minimax.cn:443/v1", "minimax"],
    ["http://127.0.0.1:11434/v1/", "ollama"],
    ["http://127.0.0.1:1234", "lmstudio"],
    ["https://api.openai.com:8443/v1", "openai_compatible"],
    ["https://api.openai.com/proxy/v1", "openai_compatible"],
    ["https://api.openai.com/v2", "openai_compatible"],
    ["https://api.openai.com/V1", "openai_compatible"],
    ["https://api.openai.com/v1?route=custom", "openai_compatible"],
    ["https://api.openai.com/v1#custom", "openai_compatible"],
    ["https://user@api.openai.com/v1", "openai_compatible"],
    ["https://api.openai.com.example/v1", "openai_compatible"],
    ["not a URL", "openai_compatible"],
  ]) {
    expect(providerPresetId({ kind: "openai_compatible", endpoint }), endpoint).toBe(expected);
  }
});
