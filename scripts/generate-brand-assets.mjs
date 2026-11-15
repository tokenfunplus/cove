import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep every icon derived from the same editable vector mark.
const root = fileURLToPath(new URL("../", import.meta.url));
const asset = (relative) => path.join(root, relative);
if (process.platform !== "darwin") {
  throw new Error("Brand asset rasterization requires macOS sips.");
}
const markPath = asset("apps/web/public/assets/cove-mark.svg");
const mark = await readFile(markPath, "utf8");
const body = mark.replace(/^<svg[^>]*>\s*/, "").replace(/<\/svg>\s*$/, "");
const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
  <defs>
    <linearGradient id="tile" x1="190" y1="96" x2="830" y2="928" gradientUnits="userSpaceOnUse">
      <stop stop-color="#fffdfa"/>
      <stop offset="1" stop-color="#f4f3f0"/>
    </linearGradient>
    <filter id="tile-shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feGaussianBlur stdDeviation="9"/>
    </filter>
  </defs>
  <rect x="100" y="102" width="824" height="824" rx="182" fill="#173546" opacity="0.2" filter="url(#tile-shadow)"/>
  <rect x="100" y="90" width="824" height="824" rx="182" fill="url(#tile)" stroke="#d2dcde" stroke-width="2"/>
  <rect x="104" y="94" width="816" height="816" rx="178" stroke="#ffffff" stroke-width="2"/>
  <g transform="translate(256 246) scale(2)">
${body}  </g>
</svg>
`;
await writeFile(asset("apps/web/public/assets/favicon.svg"), mark);
await writeFile(asset("apps/macos/Resources/AppIcon.svg"), appIcon);

const temporary = await mkdtemp(path.join(tmpdir(), "cove-brand-"));
try {
  const menuSource = path.join(temporary, "menu.svg");
  const menuBody = body.replace(/<defs>[\s\S]*?<\/defs>\s*/, "")
    .replace(/fill="url\(#[^)]+\)"/g, 'fill="#000000"');
  await writeFile(menuSource, `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${menuBody}</svg>\n`);
  const menuDirectory = asset("apps/macos/Sources/CoveLauncherApp/Resources");
  await mkdir(menuDirectory, { recursive: true });
  const outputs = [
    [markPath, 32, asset("apps/web/public/assets/favicon.png")],
    [menuSource, 18, path.join(menuDirectory, "CoveMenuBarTemplate.png")],
    [menuSource, 36, path.join(menuDirectory, "CoveMenuBarTemplate@2x.png")],
  ];
  for (const [source, size, output] of outputs) {
    const result = spawnSync("sips", ["-s", "format", "png", "-z", String(size), String(size), source, "--out", output], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      throw new Error(`Could not rasterize ${path.relative(root, output)}: ${result.error?.message ?? result.stderr}`);
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log("Generated the Cove favicon, application icon, and menu-bar templates.");
