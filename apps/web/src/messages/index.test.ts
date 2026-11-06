import { applicationMessages } from "@/messages";
import { expect, test } from "vitest";

test("pre-submit privacy copy discloses selected context for legacy locale preferences", () => {
  for (const [locale, context] of [
    ["en", "selected context"],
    ["zh", "selected context"],
    ["ja", "selected context"],
  ] as const) {
    const copy = applicationMessages(locale);
    expect(copy.composerFoot).toContain(context);
    expect(copy.composerFoot).toContain("Provider");
  }
});

test("system and legacy language preferences consistently render English", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    for (const [language, locale] of [
      ["zh-CN", "zh"],
      ["ja-JP", "ja"],
      ["en-US", "en"],
    ] as const) {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { language },
      });
      expect(applicationMessages("system").settings).toBe(
        applicationMessages(locale).settings,
      );
    }
    expect(applicationMessages("en").settings).toBe("Settings");
    expect(applicationMessages("zh")).toEqual(applicationMessages("en"));
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
