import { expect, test } from "vitest";
import type { MiniAppInstance, MiniAppRelease } from "@cove/api-contract";
import { appDiscoveryQuestion, chatApps, mentionedApps } from "./AppDiscovery";

const instance: MiniAppInstance = {
  id: "book",
  name: "Japanese study",
  release_id: "release",
  revision: 1,
  enabled: true,
  grants: ["records.query"],
};
const release: MiniAppRelease = {
  id: "release",
  origin: "local",
  digest: "digest",
  package: {
    format: 1,
    publisher: "author",
    app: "study",
    name: "Study",
    version: "1.0.0",
    schema_version: 1,
    capabilities: ["records.query", "records.commit"],
    collections: {},
    pages: [],
    actions: {
      list: {
        title: "Due questions",
        op: "query",
        collection: "items",
        inputs: {},
        surfaces: ["chat"],
      },
      save: {
        title: "Save",
        op: "create",
        collection: "items",
        inputs: {},
        surfaces: ["chat"],
      },
    },
  },
};

test("discovery uses only enabled instances and granted chat actions", () => {
  const available = chatApps(
    [instance, { ...instance, id: "disabled", enabled: false }],
    [release],
  );
  expect(available).toHaveLength(1);
  expect(available[0].actions.map((action) => action.title)).toEqual([
    "Due questions",
  ]);
  expect(
    mentionedApps("Find due records from Japanese study", available),
  ).toHaveLength(1);
  expect(
    mentionedApps(
      "Reference from Japanese study (list)\nSelected app records (reference data):\n[]",
      available,
    ),
  ).toHaveLength(0);
  expect(appDiscoveryQuestion("Which apps can I use in this chat?")).toBe(true);
  expect(appDiscoveryQuestion("List my app actions")).toBe(true);
  expect(appDiscoveryQuestion("Find due questions")).toBe(true);
  expect(appDiscoveryQuestion("Help me write a web app")).toBe(false);
});


test.each([
  "Which apps use SQLite?",
  "What apps should I build?",
  "Explain the phrase: Which apps can I use in this chat?",
  "Help me write a web app",
  "Show my apps' implementation details",
  "\u6709\u54ea\u4e9b\u5e94\u7528\u9002\u5408\u5f00\u53d1\u8005\uff1f",
])("ordinary questions do not trigger discovery: %s", (body) => {
  expect(appDiscoveryQuestion(body)).toBe(false);
});

test.each([
  "Which apps can I use in this chat?",
  "What apps are installed?",
  "What apps are available locally?",
  "List my app actions",
  "Show my apps",
  "Find due questions",
  "\u6709\u54ea\u4e9b\u5e94\u7528\uff1f",
  "\u5217\u51fa\u6211\u7684\u5e94\u7528\u52a8\u4f5c",
])("local usage questions trigger discovery: %s", (body) => {
  expect(appDiscoveryQuestion(body)).toBe(true);
});

test("app names need an explicit mention or an app action phrase", () => {
  const available = chatApps([instance], [release]);
  for (const body of [
    "Help me study grammar",
    "What does Japanese study mean?",
    "Read from a studybook",
    "Contact reader@study.example for details",
  ]) expect(mentionedApps(body, available)).toHaveLength(0);
  for (const body of [
    "Find due records from Japanese study",
    "Find questions in my Study",
    "Using Study, list due questions",
    "@Study list due questions",
    "Work with Japanese study",
  ]) expect(mentionedApps(body, available)).toHaveLength(1);
  const japanese = chatApps([
    { ...instance, name: "\u65e5\u8bed\u590d\u4e60\u672c" },
  ], [release]);
  expect(mentionedApps(
    "\u4ece\u6211\u7684\u65e5\u8bed\u590d\u4e60\u672c\u627e\u51fa\u4eca\u5929\u5230\u671f\u7684\u9898",
    japanese,
  )).toHaveLength(1);
});


test("literal app names cannot broaden the discovery match", () => {
  const available = chatApps([
    { ...instance, name: "Book (1)+" },
  ], [{ ...release, package: { ...release.package, name: "Book (1)+" } }]);
  expect(mentionedApps("Use records from Book (1)+", available)).toHaveLength(1);
  expect(mentionedApps("Use records from Book 1", available)).toHaveLength(0);
  expect(mentionedApps("Write about a notebook", available)).toHaveLength(0);
});
