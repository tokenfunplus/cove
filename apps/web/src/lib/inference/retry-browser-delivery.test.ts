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

test.each(["internal_error", "mini_app_error", "service_unavailable"])(
  "a %s retries the same frozen delivery",
  async (code) => {
    vi.useFakeTimers();
    const error = { envelope: { error: { code } } };
    const send = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const result = retryBrowserDelivery(send, new AbortController().signal);
    await vi.runAllTimersAsync();
    await result;
    expect(send).toHaveBeenCalledTimes(2);
  },
);

test("an already aborted signal still allows one terminal delivery without retry", async () => {
  const controller = new AbortController();
  controller.abort();
  const error = new Error("Disconnected");
  const send = vi.fn().mockRejectedValue(error);
  await expect(retryBrowserDelivery(send, controller.signal)).rejects.toBe(
    error,
  );
  expect(send).toHaveBeenCalledOnce();
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


test("an explicit policy caps each delay and returns the final delivery error", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const times: number[] = [];
  const errors = [new Error("First"), new Error("Second"), new Error("Third"), new Error("Final")];
  const send = vi.fn(async () => {
    times.push(Date.now());
    throw errors[times.length - 1];
  });
  const rejected = expect(retryBrowserDelivery(send, new AbortController().signal, { maxAttempts: 4, maxDelayMs: 150 })).rejects.toBe(errors[3]);
  await vi.runAllTimersAsync();
  await rejected;
  expect(times).toEqual([0, 100, 250, 400]);
  expect(vi.getTimerCount()).toBe(0);
});

test("the default Debate policy keeps its five-send, 1.5-second backoff bound", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const times: number[] = [];
  const error = new Error("Unavailable");
  const send = vi.fn(async () => { times.push(Date.now()); throw error; });
  const rejected = expect(retryBrowserDelivery(send, new AbortController().signal)).rejects.toBe(error);
  await vi.runAllTimersAsync();
  await rejected;
  expect(times).toEqual([0, 100, 300, 700, 1500]);
});
