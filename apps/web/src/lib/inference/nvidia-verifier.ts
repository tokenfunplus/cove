import { browserSessionHeaders, fetchSameOrigin } from "@/api";

const NVIDIA_ISSUER = "https://nras.attestation.nvidia.com";
const NVIDIA_JWKS_URL = `${NVIDIA_ISSUER}/.well-known/jwks.json`;

type NvidiaVerifierOptions = {
  origin?: string;
  headers?: HeadersInit;
};

type NvidiaClaims = {
  iss: string;
  exp: number;
  nbf: number;
  iat: number;
  eat_nonce: string;
  "x-nvidia-overall-att-result": boolean;
};

/**
 * Relay opaque evidence through the Local Service, then independently verify
 * NVIDIA's signed verdict in the browser.
 */
export async function verifyNvidiaEvidenceViaSameOriginProxy(
  payload: string,
  options: NvidiaVerifierOptions = {},
): Promise<void> {
  const evidence = parseEvidence(payload);
  const origin =
    options.origin ??
    (typeof window === "undefined"
      ? "http://127.0.0.1"
      : window.location.origin);
  const headers = new Headers(options.headers ?? browserSessionHeaders());
  headers.set("Content-Type", "application/json");
  const response = await fetchSameOrigin(new URL("/api/verification/nvidia", origin), {
    method: "POST",
    headers,
    body: payload,
  });
  if (!response.ok)
    throw new Error(
      `NVIDIA NRAS request failed with status ${response.status}`,
    );

  const token = parseNrasToken(await response.json());
  const { header, claims, signingInput, signature } = parseJwt(token);
  if (
    header.alg !== "ES384" ||
    typeof header.kid !== "string" ||
    header.kid === ""
  ) {
    throw new Error("NVIDIA JWT uses an unsupported algorithm or key");
  }
  const jwksResponse = await fetch(NVIDIA_JWKS_URL);
  if (!jwksResponse.ok)
    throw new Error(
      `NVIDIA JWKS request failed with status ${jwksResponse.status}`,
    );
  const key = findVerificationKey(await jwksResponse.json(), header.kid);
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "ECDSA", namedCurve: "P-384" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-384" },
    cryptoKey,
    Uint8Array.from(signature),
    new TextEncoder().encode(signingInput),
  );
  if (!verified) throw new Error("NVIDIA JWT signature is invalid");

  validateClaims(claims, evidence.nonce);
}

function parseEvidence(payload: string): { nonce: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw new Error("NVIDIA evidence is not valid JSON");
  }
  if (
    !isRecord(raw) ||
    typeof raw.nonce !== "string" ||
    !/^(?:0x)?[0-9a-fA-F]{64}$/.test(raw.nonce)
  ) {
    throw new Error("NVIDIA evidence nonce is invalid");
  }
  return { nonce: raw.nonce.replace(/^0x/i, "").toLowerCase() };
}

function parseNrasToken(raw: unknown): string {
  if (
    !Array.isArray(raw) ||
    !Array.isArray(raw[0]) ||
    raw[0][0] !== "JWT" ||
    typeof raw[0][1] !== "string"
  ) {
    throw new Error("NVIDIA NRAS response is invalid");
  }
  return raw[0][1];
}

function parseJwt(token: string): {
  header: Record<string, unknown>;
  claims: unknown;
  signingInput: string;
  signature: Uint8Array;
} {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("NVIDIA JWT is invalid");
  try {
    const header = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(parts[0])),
    );
    const claims = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(parts[1])),
    );
    if (!isRecord(header)) throw new Error("invalid header");
    return {
      header,
      claims,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: decodeBase64Url(parts[2]),
    };
  } catch {
    throw new Error("NVIDIA JWT is invalid");
  }
}

function findVerificationKey(raw: unknown, kid: string): JsonWebKey {
  if (!isRecord(raw) || !Array.isArray(raw.keys))
    throw new Error("NVIDIA JWKS is invalid");
  const key = raw.keys.find(
    (candidate) => isRecord(candidate) && candidate.kid === kid,
  );
  if (!isRecord(key) || key.kty !== "EC" || key.crv !== "P-384")
    throw new Error("NVIDIA JWT signing key was not found");
  return key as JsonWebKey;
}

function validateClaims(
  raw: unknown,
  expectedNonce: string,
): asserts raw is NvidiaClaims {
  if (
    !isRecord(raw) ||
    raw.iss !== NVIDIA_ISSUER ||
    !Number.isInteger(raw.exp) ||
    !Number.isInteger(raw.nbf) ||
    !Number.isInteger(raw.iat) ||
    typeof raw.eat_nonce !== "string" ||
    !/^[0-9a-fA-F]{64}$/.test(raw.eat_nonce) ||
    typeof raw["x-nvidia-overall-att-result"] !== "boolean"
  ) {
    throw new Error("NVIDIA JWT claims are invalid");
  }
  const now = Date.now() / 1000;
  if ((raw.exp as number) <= now) throw new Error("NVIDIA JWT has expired");
  if ((raw.nbf as number) > now || (raw.iat as number) > now)
    throw new Error("NVIDIA JWT is not yet valid");
  if (raw.eat_nonce.toLowerCase() !== expectedNonce)
    throw new Error("NVIDIA JWT nonce does not match the evidence");
  if (!raw["x-nvidia-overall-att-result"])
    throw new Error("NVIDIA attestation was rejected");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(normalized);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
