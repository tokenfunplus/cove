import { afterEach, expect, test, vi } from "vitest";
import { retryBrowserDelivery } from "./retry-browser-delivery";

afterEach(() => vi.useRealTimers());

test("a lost delivery retries identical verified values without invoking inference", async () => {
  vi.useFakeTimers();
  const payload = {
    claim_id: "claim",
    body: "Verified answer",
    verification: { status: "verified_model" },
  };
  const deliver = vi
    .fn()
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValue(undefined);
  const result = retryBrowserDelivery(
    () => deliver(payload),
    new AbortController().signal,
  );
  await vi.runAllTimersAsync();
  await result;
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(deliver.mock.calls[0][0]).toBe(deliver.mock.calls[1][0]);
});

test("permanent authorization and state errors do not retry", async () => {
  const error = { envelope: { error: { code: "invalid_session" } } };
  const send = vi.fn().mockRejectedValue(error);
  await expect(
    retryBrowserDelivery(send, new AbortController().signal),
  ).rejects.toBe(error);
  expect(send).toHaveBeenCalledOnce();
});

test("a temporary Local Service storage error retries the same delivery", async () => {
  vi.useFakeTimers();
  const error = { envelope: { error: { code: "internal_error" } } };
  const send = vi
    .fn()
    .mockRejectedValueOnce(error)
    .mockResolvedValue(undefined);
  const result = retryBrowserDelivery(send, new AbortController().signal);
  await vi.runAllTimersAsync();
  await result;
  expect(send).toHaveBeenCalledTimes(2);
});

test("delivery retries stop after a bounded number of attempts", async () => {
  vi.useFakeTimers();
  const error = new Error("Service is unavailable");
  const send = vi.fn().mockRejectedValue(error);
  const rejected = expect(
    retryBrowserDelivery(send, new AbortController().signal),
  ).rejects.toBe(error);
  await vi.runAllTimersAsync();
  await rejected;
  expect(send).toHaveBeenCalledTimes(5);
});

test("cancellation stops a pending retry and leaves the original result unchanged", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const error = new Error("Temporary disconnect");
  const send = vi.fn().mockRejectedValue(error);
  const result = retryBrowserDelivery(send, controller.signal);
  const rejected = expect(result).rejects.toBe(error);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await rejected;
  expect(send).toHaveBeenCalledOnce();
});
