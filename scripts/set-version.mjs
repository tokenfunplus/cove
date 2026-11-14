import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageFiles = ["package.json", "apps/web/package.json", "packages/api-contract/package.json"];
const plistFile = "apps/macos/Resources/Info.plist";
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;

function plistValue(contents, key) {
  const expression = new RegExp(`(<key>${key}</key>\\s*<string>)([^<]+)(</string>)`);
  const match = contents.match(expression);
  if (!match) throw new Error(`Missing string value for ${key}`);
  return { expression, value: match[2] };
}

export async function setReleaseVersion(root, version, requestedBuild) {
  if (typeof version !== "string" || !versionPattern.test(version)) {
    throw new Error("Expected a version such as 0.1.0, 0.1.0-beta.1, or 0.1.0-rc.1");
  }
  const plistPath = path.join(root, plistFile);
  const plist = await readFile(plistPath, "utf8");
  const currentBuild = plistValue(plist, "CFBundleVersion").value;
  if (!/^[1-9]\d*$/.test(currentBuild) || !Number.isSafeInteger(Number(currentBuild))) {
    throw new Error("The current CFBundleVersion must be a positive integer");
  }
  const build = String(requestedBuild ?? Number(currentBuild) + 1);
  if (!/^[1-9]\d*$/.test(build) || !Number.isSafeInteger(Number(build))) {
    throw new Error("The build number must be a positive integer without leading zeroes");
  }
  const marketingVersion = version.split("-")[0];
  let nextPlist = plist;
  for (const [key, value] of Object.entries({
    CoveReleaseVersion: version,
    CFBundleShortVersionString: marketingVersion,
    CFBundleVersion: build,
  })) {
    const { expression } = plistValue(nextPlist, key);
    nextPlist = nextPlist.replace(expression, (_, before, _old, after) => before + value + after);
  }
  // Validate every metadata file before writing any of them.
  const packages = await Promise.all(packageFiles.map(async file => {
    const filename = path.join(root, file);
    const contents = JSON.parse(await readFile(filename, "utf8"));
    if (typeof contents.version !== "string") throw new Error(`${file} has no version`);
    return { filename, contents: JSON.stringify({ ...contents, version }, null, 2) + "\n" };
  }));
  await Promise.all([
    ...packages.map(file => writeFile(file.filename, file.contents)),
    writeFile(plistPath, nextPlist),
  ]);
  return { version, marketingVersion, build, tag: "v" + version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [version, build, extra] = process.argv.slice(2);
    if (!version || extra !== undefined) throw new Error("Usage: set-version.mjs VERSION [BUILD]");
    const result = await setReleaseVersion(fileURLToPath(new URL("../", import.meta.url)), version, build || undefined);
    console.log(`Set ${result.tag}, marketing version ${result.marketingVersion}, build ${result.build}`);
  } catch (error) {
    console.error(`set-version: ${error.message}`);
    process.exitCode = 1;
  }
}
