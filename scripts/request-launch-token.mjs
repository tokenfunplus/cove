import { request } from "node:http";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function requestLaunchToken(serviceURL, controlToken) {
  const origin = new URL(serviceURL);
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(origin.hostname)
    || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Expected a loopback Local Service origin");
  }
  if (!controlToken) throw new Error("A control token is required");

  return new Promise((resolve, reject) => {
    const req = request(new URL("/internal/control/launch-token", origin), {
      method: "POST",
      agent: false,
      headers: { "X-Cove-Control-Token": controlToken },
      signal: AbortSignal.timeout(1000),
    }, (response) => {
      response.on("error", reject);
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error("Local Service rejected the launch-token request"));
        return;
      }
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 16384) response.destroy(new Error("Launch-token response is too large"));
      });
      response.on("end", () => {
        try {
          const token = JSON.parse(body)?.launch_token;
          if (typeof token !== "string" || !/^[A-Za-z0-9_-]+$/.test(token)) {
            throw new Error("Local Service returned an invalid launch token");
          }
          resolve(token);
        } catch {
          reject(new Error("Local Service returned an invalid launch-token response"));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    let controlToken = "";
    for await (const chunk of process.stdin) controlToken += chunk;
    process.stdout.write(await requestLaunchToken(process.argv[2], controlToken));
  } catch {
    console.error("Could not obtain a Local Service launch token");
    process.exitCode = 1;
  }
}
