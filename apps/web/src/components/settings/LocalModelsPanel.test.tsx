// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { LocalModelsPanel } from "./LocalModelsPanel";
import { localModelCatalog } from "@/lib/local-model-catalog";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("task, language, size, and search filters combine and can be reset", async () => {
  const user = userEvent.setup();
  render(<LocalModelsPanel />);
  await user.click(screen.getByRole("button", { name: "Filters" }));
  expect(screen.getAllByRole("article")).toHaveLength(localModelCatalog.filter(model=>model.availability==="ready").length+6);
  await user.selectOptions(screen.getByRole("combobox", { name: "Task" }), "search");
  await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "zh");
  await user.selectOptions(screen.getByRole("combobox", { name: "Model file size" }), "50");
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("article", { name: "Find Chinese documents by meaning" })).toBeTruthy();
  await user.type(screen.getByRole("searchbox"), "whisper");
  expect(screen.queryAllByRole("article")).toHaveLength(0);
  expect(screen.getByRole("heading", { name: "No models match these filters." })).toBeTruthy();
  await user.click(screen.getAllByRole("button", { name: "Reset filters" })[0]);
  expect(screen.getAllByRole("article")).toHaveLength(localModelCatalog.filter(model=>model.availability==="ready").length+6);
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  await user.type(screen.getByRole("searchbox"), "QWEN gguf");
  expect(screen.getAllByRole("article")).toHaveLength(4);
  await user.click(screen.getByRole("button", { name: "Available in Cove" }));
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.getByText("Qwen2.5 0.5B Instruct")).toBeTruthy();
  await user.clear(screen.getByRole("searchbox"));
  await user.click(screen.getByRole("button", { name: "All models" }));
  await user.type(screen.getByRole("searchbox"), "rerank");
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.getByText("MS MARCO MiniLM L6 v2")).toBeTruthy();
});

test("discovery stays offline and distinguishes source files from installed capabilities", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  render(<LocalModelsPanel />);
  await user.click(screen.getByRole("button", { name: "Filters" }));
  expect(screen.getByText(/Explore-only entries link to source files/)).toBeTruthy();
  const chinese = screen.getByRole("article", { name: "Find Chinese documents by meaning" });
  await user.click(within(chinese).getByText("Files and requirements"));
  expect(within(chinese).getByText("Community conversion")).toBeTruthy();
  expect(within(chinese).getByText("bge-small-zh-v1.5-q8_0.gguf")).toBeTruthy();
  const files = within(chinese).getByRole("link", { name: /View files/ });
  expect(files.getAttribute("href")).toContain("CompendiumLabs/bge-small-zh-v1.5-gguf/tree/5bf683e6");
  expect(files.getAttribute("target")).toBe("_blank");
  expect(files.getAttribute("rel")).toContain("noreferrer");
  await user.selectOptions(screen.getByRole("combobox", { name: "Task" }), "write");
  expect(screen.getAllByRole("article")).toHaveLength(5);
  expect(fetch).not.toHaveBeenCalled();
});

test("new task families combine with language, size, and integration filters", async () => {
  const user = userEvent.setup();
  render(<LocalModelsPanel />);
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Task" }), "translate");
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.getByText("OPUS-MT EN-ZH")).toBeTruthy();
  expect(screen.getByText("OPUS-MT ZH-EN")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Available in Cove" }));
  expect(screen.queryAllByRole("article")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Available in Cove" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Task" }), "speak");
  await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "zh");
  expect(screen.getByText("Kokoro 82M v1.1 \u00b7 Chinese",{exact:true})).toBeTruthy();
  await user.selectOptions(screen.getByRole("combobox", { name: "Model file size" }), "100");
  expect(screen.queryAllByRole("article")).toHaveLength(0);
  await user.selectOptions(screen.getByRole("combobox", { name: "Model file size" }), "250");
  const chineseSpeech = screen.getByRole("article", {name:"Read Chinese text aloud"});
  expect(screen.getAllByRole("article")).toHaveLength(2);
  await user.click(within(chineseSpeech).getByText("Files and requirements"));
  expect(within(chineseSpeech).getByText("voices.bin")).toBeTruthy();
  expect(within(chineseSpeech).getByText("model.int8.onnx")).toBeTruthy();
});

test("tiny image tools and text-language detection remain discoverable without network calls", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup(); render(<LocalModelsPanel />);
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Model file size" }), "10");
  await user.selectOptions(screen.getByRole("combobox", { name: "Task" }), "vision");
  expect(screen.getByText("MobileNetV4 Conv Small")).toBeTruthy();
  expect(screen.getByText("MODNet")).toBeTruthy();
  expect(screen.queryByText("DETR ResNet 50")).toBeNull();
  await user.selectOptions(screen.getByRole("combobox", { name: "Task" }), "classify");
  expect(screen.getByText("fastText Language ID 176")).toBeTruthy();
  expect(screen.getByText("~917 KB")).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

test("discovery separates integrated models and reveals more candidates without losing the result count", async () => {
  const user = userEvent.setup();
  render(<LocalModelsPanel />);
  expect(screen.getByRole("button", { name: "Filters" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
  const ready = screen.getByRole("region", { name: /Ready to use in Cove/ });
  const explore = screen.getByRole("region", { name: /Explore other models/ });
  expect(within(ready).getAllByRole("article")).toHaveLength(localModelCatalog.filter(model=>model.availability==="ready").length);
  expect(within(explore).getAllByRole("article")).toHaveLength(6);
  expect(within(explore).queryByRole("button", { name: /Download/ })).toBeNull();
  await user.click(within(explore).getByRole("button", { name: "Show 6 more models" }));
  expect(within(explore).getAllByRole("article")).toHaveLength(12);
  expect(screen.getByRole("status").textContent).toBe(`${localModelCatalog.length} of ${localModelCatalog.length} models`);
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Sort models" }), "size");
  expect(within(explore).getAllByRole("article")).toHaveLength(6);
  expect(within(explore).getAllByRole("article")[0].getAttribute("aria-labelledby")).toBe("local-model-fasttext-language");
  await user.selectOptions(screen.getByRole("combobox", { name: "Task" }), "voice");
  expect(screen.queryByRole("region", { name: /Ready to use in Cove/ })).toBeNull();
  expect(screen.getByText("No integrated model matches these filters yet.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "See available models" }));
  expect(screen.getAllByRole("article")).toHaveLength(localModelCatalog.filter(model=>model.availability==="ready").length);
  expect(screen.queryByRole("region", { name: /Explore other models/ })).toBeNull();
});
