import { expect, test } from "vitest";
import fixture from "../fixtures/error-envelope.json";
import type { ErrorEnvelope } from "./index";

test("the error envelope fixture remains compatible with the typed contract", () => {
  const errorEnvelope: ErrorEnvelope = fixture;

  expect(errorEnvelope).toEqual({
    error: {
      code: "not_found",
      message: "The requested API route does not exist.",
      details: null,
      request_id: "local"
    }
  });
});
