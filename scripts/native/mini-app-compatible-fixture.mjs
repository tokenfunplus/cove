import http from "node:http";
import { writeFile } from "node:fs/promises";

const output = process.argv[2];
if (!output) throw new Error("Supply the temporary endpoint output file.");
const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "native-fixture" }] }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 131072) { response.writeHead(413).end(); return; }
  }
  response.setHeader("Content-Type", "text/event-stream");
  const content = JSON.stringify([
    { question: "First fixture question", answer: "First fixture answer" },
    { question: "Second fixture question", answer: "Second fixture answer" },
  ]);
  response.end("data: " + JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
await writeFile(output, "http://127.0.0.1:" + server.address().port + "/v1", { mode: 0o600 });
process.on("SIGTERM", () => server.close());
