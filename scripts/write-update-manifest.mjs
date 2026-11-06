import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function updateManifest(version, downloadURL) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(version)) {
    throw new Error("Expected a release version such as 0.1.0 or 0.1.0-rc.1");
  }
  const url = new URL(downloadURL);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Update downloads must use HTTPS without URL credentials");
  }
  return { version, download_url: url.href };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, downloadURL, output] = process.argv.slice(2);
  if (!version || !downloadURL || !output) throw new Error("Usage: write-update-manifest.mjs VERSION DOWNLOAD_URL OUTPUT");
  await writeFile(output, `${JSON.stringify(updateManifest(version, downloadURL), null, 2)}\n`);
}
