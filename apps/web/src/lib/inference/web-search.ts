import type { ModelTool, ModelToolCall, ModelToolDelta, ModelToolMessage, WebSearchPolicy } from "@cove/api-contract";
import type { SecureInferenceEvent, SecureInferenceInput, SecureInferenceTransport, SecureInferenceVerification } from "./secure-inference";
import { secureVerificationForContract } from "./verification-record";
import { executeWebTool } from "@/api/web-search";

export const webTools: ModelTool[] = [
  { type: "function", function: { name: "web_search", description: "Search the public web when fresh information or external evidence is needed. Cite saved source sections from results.", parameters: { type: "object", properties: { query: { type: "string", maxLength: 512 } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "read_webpage", description: "Read a public webpage supplied by the user or found in search for detail beyond a search excerpt.", parameters: { type: "object", properties: { url: { type: "string", maxLength: 8192 } }, required: ["url"], additionalProperties: false } } },
];

export class ToolCalls {
  private calls = new Map<number, ModelToolCall>();
  add(deltas: ModelToolDelta[]) {
    for (const delta of deltas) {
      if (!Number.isInteger(delta.index) || delta.index < 0 || delta.index >= 8) throw new Error("The model returned too many tool calls.");
      const call = this.calls.get(delta.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
      call.id += delta.id ?? "";
      call.function.name += delta.function?.name ?? "";
      call.function.arguments += delta.function?.arguments ?? "";
      if (call.id.length > 200 || call.function.name.length > 64 || call.function.arguments.length > 16384) throw new Error("The model tool request exceeded its size limit.");
      this.calls.set(delta.index, call);
    }
  }
  hasCalls() { return this.calls.size > 0; }
  values() {
    const values = [...this.calls].sort(([a], [b]) => a - b).map(([, call]) => call);
    if (values.some(call => !call.id || !call.function.name || !call.function.arguments)) throw new Error("The model returned an incomplete tool call.");
    return values;
  }
}

/** Verify each model response before allowing it to cause an external tool request. */
export async function* generateWithWebSearch(transport: SecureInferenceTransport, input: SecureInferenceInput, policy: WebSearchPolicy, generationId: string, signal?: AbortSignal, execute = executeWebTool): AsyncGenerator<SecureInferenceEvent> {
  const continuation: ModelToolMessage[] = [];
  let callsUsed = 0, rounds = 0;
  let totalInput: number | undefined = 0, totalOutput: number | undefined = 0;
  while (!signal?.aborted) {
    const finish = callsUsed >= policy.max_rounds;
    const tools = finish ? undefined : webTools;
    const messages = finish ? [...continuation, { role: "system" as const, content: "The web tool budget has been reached. Finish using existing evidence, cite supporting saved sections, and state information gaps." }] : continuation;
    if (JSON.stringify([input.context, input.message, messages, input.configuration.systemPrompt]).length > 240000) throw new Error("The web tool context limit has been reached.");
    let body = "", reasoning = "", verification: SecureInferenceVerification | undefined;
    let inputTokens: number | undefined, outputTokens: number | undefined;
    const calls = new ToolCalls();
    let responseId = "";
    for await (const event of transport.generate({ ...input, tools, continuation: messages }, signal)) {
      if (event.type === "tool_calls") calls.add(event.calls);
      else if (event.type === "completed") verification = event.verification;
      else if (event.type === "response_ready") responseId = event.completionId;
      else if (event.type === "verifying_response") { /* Intermediate verification stays inside the web phase. */ }
      else if (event.type === "usage") { if (event.inputTokens !== undefined) inputTokens = event.inputTokens; if (event.outputTokens !== undefined) outputTokens = event.outputTokens; }
      else {
        if (event.type === "delta") body += event.delta;
        if (event.type === "reasoning") reasoning += event.delta;
        if (event.type === "failed" && calls.hasCalls()) yield { type: "web_activity", activity: "Model tool verification failed", reset: true };
        if ((event.type !== "verifying_environment" && event.type !== "streaming") || rounds === 0) yield event;
        if (event.type === "failed") return;
      }
    }
    totalInput = totalInput !== undefined && inputTokens !== undefined ? totalInput + inputTokens : undefined;
    totalOutput = totalOutput !== undefined && outputTokens !== undefined ? totalOutput + outputTokens : undefined;
    if (!verification || signal?.aborted) return;
    const toolCalls = calls.values();
    if (!toolCalls.length) {
      yield { type: "usage", inputTokens: totalInput, outputTokens: totalOutput };
      yield { type: "response_ready", completionId: responseId };
      yield { type: "verifying_response" };
      yield { type: "completed", verification };
      return;
    }
    if (finish) throw new Error("The model continued tool calls after its budget.");
    const proof = await secureVerificationForContract(verification, input.mode);
    if (proof.status !== (input.mode === "private_tee" ? "verified_model" : "verified_gateway")) throw new Error("The model tool request did not pass verification.");
    continuation.push({ role: "assistant", content: body, reasoning_content: reasoning || undefined, tool_calls: toolCalls });
    yield { type: "web_activity", activity: "Preparing web research", reset: true };
    for (const call of toolCalls) {
      yield { type: "web_activity", activity: call.function.name === "web_search" ? "Searching the web" : "Reading a webpage" };
      const result = await execute(generationId, { call, messages: continuation, verification: proof }, signal);
      continuation.push({ role: "tool", content: result.content, tool_call_id: call.id });
      callsUsed++;
    }
    rounds++;
    yield { type: "web_activity", activity: "Preparing answer from web sources" };
  }
}
