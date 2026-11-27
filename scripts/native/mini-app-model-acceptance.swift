import CryptoKit
import Foundation

// Both modes use a synthetic passage. No profile or key is copied from the user's Cove.
func verifyManagedGeneration(_ client: LocalClient, instance: String, temp: URL, text: String) async throws {
    let env = ProcessInfo.processInfo.environment
    guard let file = env["COVE_ACCEPTANCE_GGUF"], let model = env["COVE_ACCEPTANCE_MANAGED_MODEL"],
          let models = try await client.json("/api/local-models") as? [[String: Any]],
          let entry = models.first(where: { $0["id"] as? String == model && $0["role"] as? String == "chat" }),
          let expected = entry["sha256"] as? String, let bytes = entry["bytes"] as? Int else {
        fputs("Supply a pinned chat GGUF and its Cove model ID.\n", stderr)
        throw FixtureFailure.mismatch
    }
    let source = URL(fileURLWithPath: file)
    let directory = temp.appendingPathComponent("models").appendingPathComponent(model)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let destination = directory.appendingPathComponent(expected + ".gguf")
    try FileManager.default.copyItem(at: source, to: destination)
    let handle = try FileHandle(forReadingFrom: destination)
    defer { try? handle.close() }
    var digest = SHA256()
    var total = 0
    while let part = try handle.read(upToCount: 1 << 20), !part.isEmpty {
        total += part.count
        digest.update(data: part)
    }
    guard total == bytes, digest.finalize().map({ String(format:"%02x", $0) }).joined() == expected else {
        fputs("The supplied model does not match this Cove release's pinned size and digest.\n", stderr)
        throw FixtureFailure.mismatch
    }
    try await exerciseModel(client, instance: instance, text: text, provider: "cove-local",
                            model: model, endpoint: "http://127.0.0.1", localOnly: true)
    print("Managed model generated two questions; both saved to the local review instance.")
}

func verifyCompatibleGeneration(_ client: LocalClient, instance: String, text: String) async throws {
    let env = ProcessInfo.processInfo.environment
    guard let endpoint = env["COVE_ACCEPTANCE_LOOPBACK_ENDPOINT"], let url = URL(string:endpoint),
          url.scheme == "http", url.host == "127.0.0.1", url.user == nil, url.password == nil,
          let model = env["COVE_ACCEPTANCE_LOOPBACK_MODEL"] else {
        fputs("Supply the explicit 127.0.0.1 test endpoint and model.\n", stderr)
        throw FixtureFailure.mismatch
    }
    let profile = try await client.call("/api/models", body: ["kind":"openai_compatible", "name":"Acceptance loopback",
        "endpoint":endpoint, "auth_method":"none"],status:201)
    guard let id = profile["id"] as? String, let selected = profile["endpoint"] as? String else {throw FixtureFailure.mismatch}
    try await exerciseModel(client, instance: instance, text: text, provider: id, model: model, endpoint: selected, localOnly:false)
    print("Configured loopback target generated and saved two questions.")
}

func verifyCloudGeneration(_ client: LocalClient, instance: String, text: String) async throws {
    let env = ProcessInfo.processInfo.environment
    guard let endpoint = env["COVE_ACCEPTANCE_CLOUD_ENDPOINT"], URL(string: endpoint)?.scheme == "https",
          let model = env["COVE_ACCEPTANCE_CLOUD_MODEL"], let key = env["COVE_ACCEPTANCE_CLOUD_KEY"], !key.isEmpty else {
        fputs("Supply the explicit HTTPS cloud test endpoint, model and test-only key.\n", stderr)
        throw FixtureFailure.mismatch
    }
    let profile = try await client.call("/api/models", body: ["kind":"openai_compatible", "name":"Acceptance cloud",
        "endpoint":endpoint, "auth_method":"bearer", "secret":key],status:201)
    guard let id = profile["id"] as? String, let selected = profile["endpoint"] as? String else { throw FixtureFailure.mismatch }
    try await exerciseModel(client, instance: instance, text: text, provider: id, model: model, endpoint: selected, localOnly: false)
    guard let old = try await client.call(instance)["instance"] as? [String:Any], let rev = old["revision"] as? Int,
          let grants = old["grants"] as? [String] else { throw FixtureFailure.mismatch }
    _ = try await client.call(instance + "/settings",body:["revision":rev, "enabled":true, "grants":grants.filter{$0 != "ai.generate"}])
    _ = try await client.call(instance + "/tasks",body:taskInput(text, id, model, selected, false),status:403)
    print("Cloud generation passed; revoking this instance's grant blocked a new request.")
}

private func taskInput(_ text: String, _ provider: String, _ model: String, _ endpoint: String, _ localOnly: Bool) -> [String:Any] {
    ["action":"review.suggestQuestions","input":["passage":text,"count":2], "operationId":UUID().uuidString,
     "providerId":provider, "modelId":model, "destination":endpoint, "localOnly":localOnly, "surface":"page"]
}

private func exerciseModel(_ client: LocalClient, instance: String, text: String, provider: String, model: String, endpoint: String, localOnly: Bool) async throws {
    if !localOnly {
        _ = try await client.call(instance + "/tasks", body:taskInput(text,provider,model,endpoint,true),status:409)
    }
    let input = taskInput(text,provider,model,endpoint,localOnly)
    var task = try await client.call(instance + "/tasks", body:input)
    guard let taskID = task["id"] as? String else { throw FixtureFailure.mismatch }
    let deadline = Date().addingTimeInterval(300)
    while task["state"] as? String == "running" && Date() < deadline {
        try await Task.sleep(nanoseconds: 250_000_000)
        task = try await client.call(instance + "/tasks/" + taskID)
    }
    guard task["state"] as? String == "completed", task["destination"] as? String == endpoint,
          (task["inputs"] as? [String: Any])?["passage"] as? String == text,
          let raw = task["result"] as? String,
          let candidates = try JSONSerialization.jsonObject(with: Data(raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"^```(?:json)?\s*([\s\S]*?)\s*```$"#, with:"$1", options:.regularExpression).utf8)) as? [[String:String]],
          candidates.count == 2 else { throw FixtureFailure.mismatch }
    let rows = try candidates.map { candidate -> [String:String] in
        guard let question = candidate["question"], !question.isEmpty, let answer = candidate["answer"], !answer.isEmpty else {throw FixtureFailure.mismatch}
        return ["question":question,"answer":answer,"sourceTitle":"Acceptance lesson","source":text]
    }
    var write: [String:Any] = ["inputs":[:],"items":rows,"operation_id":UUID().uuidString,"surface":"page"]
    let preview = try await client.call(instance + "/actions/review.addQuestions",body:write)
    guard let token = preview["confirmation"] as? String else {throw FixtureFailure.mismatch}
    write["confirm"] = token
    let saved = try await client.call(instance + "/actions/review.addQuestions",body:write)
    try expect((saved["records"] as? [[String:Any]])?.count == 2)
    let due = try await client.call(instance + "/actions/review.listDue",body:["inputs":[:],"surface":"chat","operation_id":UUID().uuidString])
    let stored = Set((due["records"] as? [[String:Any]] ?? []).compactMap{$0["id"] as? String})
    for row in saved["records"] as? [[String:Any]] ?? [] {
        guard let id = row["id"] as? String, stored.contains(id) else {throw FixtureFailure.mismatch}
    }
}
