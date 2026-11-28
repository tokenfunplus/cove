// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import * as api from "@/api";
import { providerKeys } from "@/api/queryKeys";
import { AppModelTarget, useAppModelTarget } from "./AppModelTarget";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  cache.setQueryData(providerKeys.list, [
    { id: "local", kind: "local", name: "Local", configured: true },
  ]);
  function Picker() {
    const target = useAppModelTarget(false);
    return (
      <>
        <AppModelTarget target={target} />
        <output aria-label="Admitted model">{target.model || "None"}</output>
      </>
    );
  }
  render(
    <QueryClientProvider client={cache}>
      <Picker />
    </QueryClientProvider>,
  );
  return cache;
}
test("a removed model is no longer admitted even before the user chooses another one", async () => {
  vi.spyOn(api, "getProviderCatalog").mockResolvedValue({
    models: ["original"],
  });
  const cache = mount();
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Model provider" }),
    "local",
  );
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Model" }),
    "original",
  );
  expect(screen.getByLabelText("Admitted model").textContent).toBe("original");
  await act(async () => {
    cache.setQueryData(providerKeys.catalog("local"), {
      models: ["replacement"],
    });
  });
  await waitFor(() => expect(screen.getByLabelText("Admitted model").textContent).toBe("None"));
  expect(
    (screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement)
      .value,
  ).toBe("");
});
test("catalog failure is visible and an explicit retry recovers the model list", async () => {
  const catalog = vi
    .spyOn(api, "getProviderCatalog")
    .mockRejectedValueOnce(new Error("Catalog unavailable"))
    .mockResolvedValue({ models: ["recovered"] });
  mount();
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Model provider" }),
    "local",
  );
  await screen.findByText("Catalog unavailable");
  await userEvent.click(
    screen.getByRole("button", { name: "Retry model list" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("option", { name: "recovered" })).toBeTruthy(),
  );
  expect(catalog).toHaveBeenCalledTimes(2);
});
