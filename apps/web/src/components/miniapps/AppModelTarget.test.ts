import { expect, test } from "vitest";
import { loopbackEndpoint } from "./AppModelTarget";

test.each([
  ["http://localhost:11434/v1", true],
  ["http://127.0.0.1:11434/v1", true],
  ["http://127.31.4.8/v1", true],
  ["http://[::1]:11434/v1", true],
  ["http://[::ffff:127.0.0.1]:11434/v1", true],
  ["http://[::ffff:127.31.4.8]/v1", true],
  ["http://[::ffff:128.0.0.1]/v1", false],
  ["http://192.168.1.3/v1", false],
  ["https://localhost.example/v1", false],
  ["https://model.example/v1", false],
  ["invalid", false],
])("classifies model destination %s consistently with the host", (endpoint, expected) => {
  expect(loopbackEndpoint(endpoint as string)).toBe(expected);
});
