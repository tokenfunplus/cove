import { afterEach, expect, test, vi } from "vitest";
import { verifyNvidiaEvidenceViaSameOriginProxy } from "./nvidia-verifier";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("NVIDIA evidence uses the same-origin relay and verifies the signed NRAS verdict in the browser", async () => {
  const nonce = "ab".repeat(32);
  const { privateKey, publicJwk } = await signingFixture();
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(privateKey, {
    iss: "https://nras.attestation.nvidia.com",
    eat_nonce: nonce,
    "x-nvidia-overall-att-result": true,
    iat: now,
    nbf: now - 1,
    exp: now + 60
  });
  const requests: Request[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url === "http://127.0.0.1/api/verification/nvidia") {
      expect(request.method).toBe("POST");
      expect(request.headers.get("X-Cove-CSRF-Token")).toBe("fixture-csrf");
      expect(await request.text()).toBe(JSON.stringify({ nonce, evidence: "opaque" }));
      return new Response(JSON.stringify([["JWT", token]]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (request.url === "https://nras.attestation.nvidia.com/.well-known/jwks.json") {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
    }
    throw new Error(`unexpected request: ${request.url}`);
  }));

  await expect(verifyNvidiaEvidenceViaSameOriginProxy(
    JSON.stringify({ nonce, evidence: "opaque" }),
    { origin: "http://127.0.0.1", headers: { "X-Cove-CSRF-Token": "fixture-csrf" } }
  )).resolves.toBeUndefined();

  expect(requests.map((request) => request.url)).toEqual([
    "http://127.0.0.1/api/verification/nvidia",
    "https://nras.attestation.nvidia.com/.well-known/jwks.json"
  ]);
  expect(requests.some((request) => request.url.endsWith("/v3/attest/gpu"))).toBe(false);
});

test("NVIDIA evidence rejects a signed NRAS verdict for a different nonce", async () => {
  const nonce = "ab".repeat(32);
  const { privateKey, publicJwk } = await signingFixture();
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(privateKey, {
    iss: "https://nras.attestation.nvidia.com",
    eat_nonce: "cd".repeat(32),
    "x-nvidia-overall-att-result": true,
    iat: now,
    nbf: now - 1,
    exp: now + 60
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new Request(input).url;
    if (url.endsWith("/api/verification/nvidia")) return new Response(JSON.stringify([["JWT", token]]));
    return new Response(JSON.stringify({ keys: [publicJwk] }));
  }));

  await expect(verifyNvidiaEvidenceViaSameOriginProxy(
    JSON.stringify({ nonce }),
    { origin: "http://127.0.0.1", headers: {} }
  )).rejects.toThrow("nonce");
});

async function signingFixture(): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
  const publicJwk = { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid: "fixture-key" };
  return { privateKey: pair.privateKey, publicJwk };
}

async function signJwt(privateKey: CryptoKey, claims: Record<string, unknown>): Promise<string> {
  const header = encodeBase64Url(JSON.stringify({ alg: "ES384", kid: "fixture-key" }));
  const payload = encodeBase64Url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-384" },
    privateKey,
    new TextEncoder().encode(signingInput)
  ));
  return `${signingInput}.${encodeBase64Url(signature)}`;
}

function encodeBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
