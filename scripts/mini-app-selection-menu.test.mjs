import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("selection menu preserves duplicate labels and their exact app targets", {
  skip: process.platform !== "darwin",
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-selection-menu-"));
  function run(command, args) {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  }
  try {
    const library = path.join(root, "apps/macos/Sources/CoveLauncher");
    const sources = (await readdir(library)).filter(name => name.endsWith(".swift")).map(name => path.join(library, name));
    run("swiftc", ["-emit-library", "-static", "-emit-module", "-module-name", "CoveLauncher",
      "-emit-module-path", path.join(directory, "CoveLauncher.swiftmodule"),
      "-o", path.join(directory, "libCoveLauncher.a"), ...sources]);
    const main = path.join(directory, "main.swift");
    await writeFile(main, `import AppKit

MainActor.assumeIsolated {
    _ = NSApplication.shared
    let targets = [
        MiniAppSelectionTarget(instance: "first", name: "My book", view: "inbox", action: "save", title: "Save text", field: "text", revision: 3),
        MiniAppSelectionTarget(instance: "second", name: "My book", view: "review", action: "add", title: "Save text", field: "text", revision: 9),
        MiniAppSelectionTarget(instance: "third", name: "Other book", view: "home", action: "receive", title: "Keep selection", field: "body", revision: 2),
    ]
    let menu = miniAppSelectionMenu(targets)
    precondition(menu.numberOfItems == targets.count, "Duplicate labels must remain separate choices")
    precondition(menu.itemTitle(at: 0) == menu.itemTitle(at: 1))
    for (index, expected) in targets.enumerated() {
        menu.selectItem(at: index)
        guard let selected = menu.selectedItem?.representedObject as? MiniAppSelectionTarget else {
            fatalError("The selected item lost its target")
        }
        precondition(selected == expected, "Selection must retain the exact instance, action, view, field and revision")
        let bytes = try! JSONEncoder().encode(selected)
        precondition(try! JSONDecoder().decode(MiniAppSelectionTarget.self, from: bytes) == expected)
    }
    precondition(miniAppSelectionMenu([]).selectedItem == nil)
}
`);
    const executable = path.join(directory, "check-selection-menu");
    run("swiftc", ["-I", directory, "-L", directory, "-lCoveLauncher",
      path.join(root, "apps/macos/Sources/CoveLauncherApp/MiniAppFilePicker.swift"), main,
      "-o", executable]);
    run(executable, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
