import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
test("update discovery orders prereleases, keeps stable opt-in, and handles unavailable channels", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-update-checker-"));
  try {
    const main = path.join(directory, "main.swift");
    await writeFile(main, `import Foundation
final class Requester: UpdateRequesting {
    let data: Data
    let status: Int
    init(_ json: String, _ status: Int) { data = Data(json.utf8); self.status = status }
    func get(url: URL, completion: @escaping @Sendable (Data?, Int?) -> Void) { completion(data, status) }
}
final class ResultBox: @unchecked Sendable { var value: Result<AppUpdate?, Error>? }
func check(_ current: String, _ remote: String, _ channel: UpdateChannel = .beta, status: Int = 200, payload: String? = nil) -> Result<AppUpdate?, Error> {
    let json = payload ?? (channel == .beta
        ? "[{\\"tag_name\\":\\"v" + remote + "\\",\\"draft\\":false,\\"html_url\\":\\"https://untrusted.example/\\"}]"
        : "{\\"version\\":\\"" + remote + "\\",\\"download_url\\":\\"https://github.com/tokenfunplus/cove/releases\\"}")
    let requester = Requester(json, status)
    let box = ResultBox()
    UpdateChecker(currentVersion: current, manifestURL: URL(string: "https://updates.example.test/stable.json")!, requester: requester)
        .check(channel: channel) { box.value = $0 }
    return box.value!
}
for (older, newer) in [("0.1.0-beta.2", "0.1.0-beta.3"), ("0.1.0-beta.3", "0.1.0-beta.10"), ("0.1.0-beta.10", "0.1.0"), ("0.1.0-rc.2", "0.1.0-rc.10")] {
    guard case let .success(update?) = check(older, newer) else { fatalError("Newer prerelease was not offered") }
    precondition(update.version == newer)
    precondition(update.downloadURL.absoluteString == "https://github.com/tokenfunplus/cove/releases/tag/v" + newer)
    guard case .success(nil) = check(newer, older) else { fatalError("An older version was offered") }
    guard case .success(nil) = check(newer, newer) else { fatalError("The current version was offered") }
}
guard case .success(nil) = check("0.1.0", "0.2.0-beta.1", .stable) else { fatalError("Stable users must opt in to betas") }
guard case .success(_?) = check("0.1.0", "0.2.0-beta.1") else { fatalError("Explicit beta discovery failed") }
guard case .success(_?) = check("0.1.0-beta.10", "0.1.0", .stable) else { fatalError("A final release must upgrade its beta") }
guard case .success(nil) = check("0.1.0+build.1", "0.1.0+build.2", .stable) else { fatalError("Build metadata changed precedence") }
guard case .failure(UpdateError.channelUnavailable) = check("0.1.0", "", payload: "[]") else { fatalError("Missing channel metadata needs a fallback") }
guard case .failure(UpdateError.channelUnavailable) = check("0.1.0", "", status: 404) else { fatalError("Missing manifest needs a fallback") }
guard case .failure(UpdateError.requestFailed) = check("0.1.0", "", status: 503) else { fatalError("Network failure was not reported") }
guard case .failure = check("0.1.0", "", payload: "invalid") else { fatalError("Malformed metadata was accepted") }
guard case .failure(UpdateError.channelUnavailable) = check("0.1.0", "", payload: "[{\\"tag_name\\":\\"v0.2.0-beta.1\\",\\"draft\\":true}]") else { fatalError("A draft release was offered") }
`);
    const executable = path.join(directory, "check-updates");
    for (const [command, args] of [["swiftc", [path.join(root, "apps/macos/Sources/CoveLauncher/UpdateChecker.swift"), main, "-o", executable]], [executable, []]]) {
      const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
