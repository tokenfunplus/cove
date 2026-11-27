// Build static CoveWeb package pages and a signed index into a new directory.
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  mkdtemp,
  rename,
  rm,
  lstat,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const sequenceFlag = args.indexOf("--sequence");
const sequence = sequenceFlag < 0 ? NaN : Number(args[sequenceFlag + 1]);
if (sequenceFlag >= 0) args.splice(sequenceFlag, 2);
const [output, pem, ...files] = args;
if (
  !output ||
  !pem ||
  !files.length ||
  files.length > 128 ||
  !Number.isSafeInteger(sequence) ||
  sequence < 1
) {
  throw new Error(
    "Usage: node scripts/build-mini-app-catalog.mjs --sequence POSITIVE_INTEGER NEW_DIRECTORY ED25519_PRIVATE_PEM APP.coveapp [...]",
  );
}
const destination = resolve(output);
if (
  await lstat(destination).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  })
) {
  throw new Error("Choose a new catalog output directory.");
}
const key = createPrivateKey(await readFile(pem));
if (key.asymmetricKeyType !== "ed25519")
  throw new Error("An Ed25519 signing key is required.");
const escaped = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
const humanized = (value) =>
  String(value)
    .replace(/[._-]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
const styles = `
:root {
  color-scheme: light;
  --ink: #252b27;
  --muted: #647065;
  --line: #dce1da;
  --paper: #f5f6f1;
  --card: #fdfefb;
  --sage: #e5eddf;
  --green: #355840;
  --peach: #f0e7db;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  -webkit-font-smoothing: antialiased;
}
a {
  color: inherit;
  text-decoration: none;
}
button,a {
  -webkit-tap-highlight-color: transparent;
}
a:focus-visible,summary:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 5px;
  border-radius: 5px;
}
h1,h2,h3,p {
  margin: 0;
}
p {
  line-height: 1.75;
}
img {
  display: block;
  max-width: 100%;
}
.wrap {
  width: min(1060px,100% - 48px);
  margin: auto;
}
.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 28px 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -.03em;
}
.brand small {
  font-size: 14px;
  font-weight: 400;
  color: var(--muted);
}
.brand-mark {
  display: grid;
  grid-template-columns: repeat(2,5px);
  gap: 3px;
  place-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--green);
}
.brand-mark i {
  width: 5px;
  height: 5px;
  background: #fff;
  border-radius: 1px;
}
.header-link {
  font-size: 12px;
  color: var(--muted);
}
.nav {
  display: flex;
  gap: 28px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  color: var(--muted);
}
.nav a {
  padding: 18px 0;
}
.nav a[aria-current] {
  position: relative;
  color: var(--ink);
  font-weight: 600;
}
.nav a[aria-current]:after {
  content: "";
  height: 2px;
  background: var(--green);
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
}
.intro {
  padding: 48px 0 32px;
}
.eyebrow {
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--muted);
}
h1 {
  margin-top: 12px;
  font-size: clamp(30px,4.4vw,42px);
  font-weight: 650;
  line-height: 1.18;
  letter-spacing: -.055em;
}
.intro p:last-child {
  max-width: 540px;
  margin-top: 18px;
  font-size: 14px;
  color: var(--muted);
}
.app-grid {
  display: grid;
  grid-template-columns: repeat(2,minmax(0,1fr));
  gap: 26px;
}
.app-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--card);
  transition: transform .18s,border-color .18s,box-shadow .18s;
}
.app-card:hover {
  transform: translateY(-3px);
  border-color: #becaba;
  box-shadow: 0 18px 35px -30px #31473666;
}
.card-cover {
  display: block;
  border-bottom: 1px solid #dce1da99;
}
.card-body {
  padding: 24px;
}
.card-body h2 {
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -.035em;
}
.card-description {
  margin-top: 10px;
  color: var(--muted);
  font-size: 13px;
  min-height: 70px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-foot {
  margin-top: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.byline {
  font-size: 11px;
  color: var(--muted);
}
.text-link {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  font-weight: 600;
}
.text-link:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.preview {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  height: 274px;
  padding: 32px 32px 0;
  background: var(--peach);
  overflow: hidden;
}
.preview.practice {
  background: var(--sage);
}
.preview:before {
  content: "";
  position: absolute;
  inset: 0;
  opacity: .16;
  background-image: radial-gradient(var(--muted) .5px,transparent .5px);
  background-size: 9px 9px;
  pointer-events: none;
}
.preview-window {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 350px;
  border: 1px solid #a8b0a54d;
  border-radius: 10px;
  background: var(--card);
  box-shadow: 0 18px 30px -20px #46513d66;
  overflow: hidden;
  transform: rotate(-2deg);
}
.practice .preview-window {
  transform: rotate(2deg);
}
.preview-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 8px;
  color: var(--muted);
  background: #f3f5f0;
}
.window-dots {
  display: flex;
  gap: 3px;
}
.window-dots i {
  display: block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #ccd3c7;
}
.preview-body {
  padding: 18px;
  min-height: 220px;
}
.preview-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 10px;
  font-weight: 600;
}
.example-tag {
  font-size: 8px;
  font-weight: 400;
  border-radius: 20px;
  padding: 3px 7px;
  background: #eef1e9;
  color: var(--muted);
}
.sample-card {
  margin-top: 18px;
  padding: 20px 16px;
  display: grid;
  gap: 16px;
  justify-items: center;
  text-align: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
}
.sample-card small {
  font-size: 8px;
  font-weight: 400;
  letter-spacing: .17em;
  text-transform: uppercase;
  color: var(--muted);
}
.sample-question {
  font-family: Georgia,serif;
  font-size: 21px;
  line-height: 1.4;
}
.sample-answer {
  font-size: 9px;
  color: var(--green);
}
.sample-list {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}
.sample-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  font-size: 11px;
}
.sample-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #abc09f;
}
.sample-row strong,.sample-row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sample-row strong {
  font-weight: 500;
}
.sample-row small {
  margin-top: 5px;
  font-size: 9px;
  color: var(--muted);
}
.sample-row>span:last-child {
  min-width: 0;
}
.preview-tabs {
  display: flex;
  gap: 12px;
  margin-top: 18px;
  font-size: 8px;
  color: var(--muted);
}
.preview-empty {
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 30px 0;
  font-size: 11px;
  color: var(--muted);
}
.app-mark {
  display: grid;
  place-items: center;
  width: 44px;
  height: 52px;
  background: var(--sage);
  color: var(--green);
  border-radius: 6px 10px 10px 6px;
  box-shadow: inset 4px 0 #b7cab0;
  font-family: Georgia,serif;
  font-size: 19px;
  letter-spacing: -.08em;
}
.preview-asset {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.preview:has(.preview-asset) {
  padding: 0;
}
.back {
  display: inline-block;
  margin: 28px 0;
  font-size: 12px;
  color: var(--muted);
}
.detail-hero {
  display: grid;
  grid-template-columns: minmax(0,1.2fr) minmax(280px,.8fr);
  align-items: center;
  gap: 48px;
}
.detail-cover {
  border: 1px solid var(--line);
  border-radius: 24px;
  overflow: hidden;
}
.detail-cover .preview {
  height: 410px;
  align-items: center;
  padding: 35px;
}
.detail-cover .preview-window {
  transform: none;
  max-width: 390px;
}
.detail-cover .preview-body {
  min-height: 275px;
  padding: 24px;
}
.detail-cover .sample-card {
  padding: 26px 20px;
}
.detail-cover .sample-question {
  font-size: 25px;
}
.detail-cover .preview-asset {
  position: absolute;
  inset: 0;
}
.caption {
  margin-top: 13px;
  text-align: center;
  font-size: 11px;
  color: var(--muted);
}
.detail-copy h1 {
  margin-top: 14px;
  font-size: clamp(30px,4vw,39px);
}
.detail-description {
  margin-top: 20px;
  font-size: 14px;
  color: var(--muted);
}
.detail-byline {
  margin-top: 20px;
  font-size: 11px;
  color: var(--muted);
}
.facts {
  display: grid;
  gap: 13px;
  margin-top: 26px;
  padding-top: 26px;
  border-top: 1px solid var(--line);
  font-size: 13px;
}
.fact {
  display: flex;
  align-items: center;
  gap: 12px;
}
.fact-icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 1px solid #afbea6;
  border-radius: 6px;
  font-size: 11px;
  color: var(--green);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 28px;
}
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 40px;
  padding: 10px 19px;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--card);
  font-size: 12px;
  font-weight: 600;
}
.button.primary {
  background: var(--green);
  border-color: var(--green);
  color: white;
}
.button:hover {
  filter: brightness(.97);
}
.version-note {
  margin-top: 15px;
  font-size: 11px;
  color: var(--muted);
}
.detail-sections {
  display: grid;
  grid-template-columns: repeat(2,minmax(0,1fr));
  gap: 40px;
  margin-top: 48px;
  padding-top: 34px;
  border-top: 1px solid var(--line);
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -.01em;
}
.view-list {
  list-style: none;
  display: grid;
  gap: 16px;
  padding: 0;
  margin: 22px 0 0;
  font-size: 13px;
  color: var(--muted);
}
.view-list li:before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  background: #a7b99c;
  border-radius: 50%;
  margin-right: 13px;
  vertical-align: middle;
}
.privacy-card {
  padding: 25px;
  background: #eaf0e3;
  border-radius: 18px;
}
.privacy-card p {
  margin-top: 13px;
  font-size: 13px;
  color: var(--muted);
}
details {
  border-top: 1px solid var(--line);
  padding: 22px 0;
}
summary {
  cursor: pointer;
  list-style: none;
  font-size: 13px;
  font-weight: 550;
}
summary::-webkit-details-marker {
  display: none;
}
summary:after {
  content: "+";
  float: right;
  font-size: 16px;
  font-weight: 400;
  color: var(--muted);
}
details[open]>summary:after {
  content: "−";
}
.disclosures {
  margin-top: 32px;
}
.access-list {
  list-style: none;
  display: grid;
  gap: 18px;
  padding: 0;
  margin: 24px 0 5px;
}
.access-list strong {
  font-size: 13px;
  font-weight: 550;
}
.access-list p {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}
.history-row {
  margin-top: 22px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 15px;
  background: var(--card);
}
.history-row h3 {
  font-size: 14px;
  font-weight: 600;
}
.history-row p {
  margin-top: 8px;
  font-size: 12px;
  color: var(--muted);
}
.history-row .actions {
  margin-top: 16px;
}
.technical {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 12px;
  margin-top: 22px;
  font-size: 12px;
}
.technical dt {
  color: var(--muted);
}
.technical dd {
  margin: 0;
  overflow-wrap: anywhere;
}
code {
  font-family: ui-monospace,SFMono-Regular,monospace;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.site-footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 30px;
  margin: 56px 0 28px;
  padding-top: 24px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--muted);
}
.site-footer p {
  max-width: 530px;
}
.site-footer a {
  white-space: nowrap;
}
.collection-count {
  margin-bottom: 19px;
  font-size: 11px;
  color: var(--muted);
}
@media(max-width:700px) {
  .wrap {
    width: calc(100% - 36px);
  }
  .site-header {
    padding: 22px 0;
  }
  .header-link {
    font-size: 11px;
  }
  .brand small {
    display: none;
  }
  .intro {
    padding-top: 36px;
  }
  .app-grid,.detail-hero,.detail-sections {
    grid-template-columns: 1fr;
  }
  .app-grid {
    gap: 22px;
  }
  .detail-hero {
    gap: 28px;
  }
  .detail-cover .preview {
    height: 350px;
  }
  .detail-copy {
    padding: 0 4px;
  }
  .detail-sections {
    gap: 24px;
  }
  .site-footer {
    flex-direction: column;
    gap: 16px;
  }
  .preview {
    padding-left: 25px;
    padding-right: 25px;
  }
  .technical {
    grid-template-columns: 85px 1fr;
  }
  .card-description {
    min-height: 0;
  }
}
@media(prefers-reduced-motion:reduce) {
  * {
    transition: none!important;
  }
  .app-card:hover {
    transform: none;
  }
}
`;

function documentHTML(title, content, { detail = false } = {}) {
  const collection = detail ? "../../" : "./";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escaped(title)} · Cove Mini Apps</title>
<style>${styles}</style>
</head>
<body>
<div class="wrap">
<header class="site-header">
<a class="brand" href="${collection}" aria-label="Cove Mini Apps">
<span class="brand-mark" aria-hidden="true">
<i></i>
<i></i>
<i></i>
<i></i>
</span>Cove <small>/ Mini Apps</small>
</a>
<a class="header-link" href="cove://apps">Open Cove &nearr;</a>
</header>
<nav class="nav" aria-label="App collection">
<a href="${collection}"${detail ? "" : ' aria-current="page"'}>Discover</a>
</nav>
<main>${content}</main>
<footer class="site-footer">
<p>Apps save their records on your Mac. Optional model requests use the destination you allow in Cove.</p>
<a class="text-link" href="https://www.hicove.io/">Get Cove for Mac &nearr;</a>
</footer>
</div>
</body>
</html>`;
}

function appMark(app) {
  const initials = app.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase();
  return `<span class="app-mark" aria-hidden="true">${escaped(initials)}</span>`;
}

function publicPreview(app) {
  const page = app.pages[0];
  const query = page.practice?.query
    ? app.actions[page.practice.query]
    : page.actions
        .map((id) => app.actions[id])
        .find((action) => action.op === "query");
  const collection = query?.collection;
  const fields = collection ? (app.collections[collection]?.fields ?? {}) : {};
  const textFields = Object.entries(fields)
    .filter(([, type]) => type === "text")
    .map(([name]) => name);
  const front =
    page.practice?.front ??
    textFields.find((name) => name !== query?.reveal_field);
  const secondary = textFields.find(
    (name) => name !== front && name !== query?.reveal_field,
  );
  const rows = collection ? (app.seed?.[collection] ?? []).slice(0, 3) : [];
  const asset = app.assets?.[page.image];
  const practice = Boolean(page.practice || query?.reveal_field);
  if (asset)
    return `<div class="preview">
<img class="preview-asset" alt="${escaped(asset.alt)}" src="data:${escaped(asset.mime)};base64,${escaped(asset.data)}">
</div>`;
  const sample =
    practice && rows[0] && front
      ? `<div class="sample-card">
<small>A moment to practise</small>
<p class="sample-question">${escaped(rows[0][front])}</p>
<span class="sample-answer">Reveal answer &rarr;</span>
</div>`
      : rows.length
        ? `<div class="sample-list">${rows
            .map(
              (row) => `<div class="sample-row">
<span class="sample-dot" aria-hidden="true">
</span>
<span>
<strong>${escaped(front ? row[front] : "Saved item")}</strong>${secondary ? `<small>${escaped(row[secondary])}</small>` : ""}</span>
</div>`,
            )
            .join("")}</div>`
        : `<div class="preview-empty">${appMark(app)}<span>A fresh space for your ideas.</span>
</div>`;
  return `<div class="preview${practice ? " practice" : ""}">
<div class="preview-window" aria-label="${escaped(app.name)} example preview">
<div class="preview-toolbar">
<span class="window-dots" aria-hidden="true">
<i></i>
<i></i>
<i></i>
</span>
<span>${escaped(app.name)}</span>
<span aria-hidden="true">&#9671;</span>
</div>
<div class="preview-body">
<div class="preview-heading">
<span>${escaped(page.title)}</span>
<span class="example-tag">Example</span>
</div>${sample}<div class="preview-tabs">${app.pages
    .slice(0, 3)
    .map((item) => `<span>${escaped(item.title)}</span>`)
    .join("")}</div>
</div>
</div>
</div>`;
}

function releaseActions(app) {
  const uri = `cove://install/${app.publisher}/${app.app}?version=${encodeURIComponent(app.version)}`;
  return `<div class="actions">
<a class="button primary" data-action="open" href="${escaped(uri)}">Open in Cove <span aria-hidden="true">&nearr;</span>
</a>
<a class="button" data-action="download" download href="${escaped(app.version)}.coveapp">Download app</a>
</div>`;
}

const accessCopy = {
  "records.query": [
    "Read saved items",
    "View the items saved in your copy of the app.",
  ],
  "records.commit": [
    "Save changes",
    "Add, edit or remove items after you review the changes.",
  ],
  "ai.generate": [
    "Use AI tools",
    "Run a task with a model and destination you choose in Cove.",
  ],
  "models.list": [
    "Choose a model",
    "See the models you have configured in Cove.",
  ],
  "chat.attach": [
    "Add items to a chat",
    "Place items you select into a chat draft for review.",
  ],
  "mac.files.pick": [
    "Choose files",
    "Import a file through the Mac file picker when you ask.",
  ],
  "blobs.import": [
    "Keep attachments",
    "Store files with your app on this Mac.",
  ],
  "mac.selection.receive": [
    "Receive selected Mac text",
    "Use text you send through the macOS Services menu.",
  ],
  "documents.search": [
    "Search selected documents",
    "Search documents you explicitly choose in Cove.",
  ],
  "speech.speak": [
    "Read text aloud",
    "Use local speech to read text you select.",
  ],
};

function detailHTML(releases) {
  const latest = releases[0];
  const history = releases.slice(1);
  const access = latest.capabilities
    .map((capability) => {
      const [title, description] = accessCopy[capability] ?? [
        humanized(capability),
        "Allow this feature when you request it in Cove.",
      ];
      return `<li>
<strong>${escaped(title)}</strong>
<p>${escaped(description)}</p>
</li>`;
    })
    .join("");
  return documentHTML(
    latest.name,
    `<a class="back" href="../../">&larr; Back to Discover</a>
<section class="detail-hero" data-release-version="${escaped(latest.version)}">
<div>
<div class="detail-cover">${publicPreview(latest)}</div>
<p class="caption">Example content from the app. Your copy has its own data.</p>
</div>
<div class="detail-copy">
<p class="eyebrow">From the app collection</p>
<h1>${escaped(latest.name)}</h1>
<p class="detail-description">${escaped(latest.description)}</p>
<p class="detail-byline">Publisher ID: ${escaped(latest.publisher)}</p>
<div class="facts">
<p class="fact">
<span class="fact-icon" aria-hidden="true">&#9633;</span>Saved on your Mac</p>
<p class="fact">
<span class="fact-icon" aria-hidden="true">&#10003;</span>You choose its permissions</p>
</div>${releaseActions(latest)}<p class="version-note">Version ${escaped(latest.version)} &middot; Latest release</p>
</div>
</section>
<section class="detail-sections">
<div>
<h2 class="section-title">App screens</h2>
<ul class="view-list">${latest.pages.map((page) => `<li>${escaped(page.title)}</li>`).join("")}</ul>
</div>
<div class="privacy-card">
<h2 class="section-title">A copy that belongs to you</h2>
<p>Your saved items stay separate from other copies. Updating the app keeps them in place. Model access is yours to enable.</p>
</div>
</section>
<div class="disclosures">
<details>
<summary>Access this app can request</summary>
<ul class="access-list">${access}</ul>
<p class="caption">Access starts off. Choose permissions when installing, then change them at any time in Cove.</p>
</details>${
      history.length
        ? `<details class="version-history">
<summary>Version history <span>(${history.length})</span>
</summary>${history
            .map(
              (
                app,
              ) => `<article class="history-row" data-release-version="${escaped(app.version)}">
<h3>Version ${escaped(app.version)}</h3>
<p>${escaped(app.description)}</p>${releaseActions(app)}</article>`,
            )
            .join("")}</details>`
        : ""
    }<details>
<summary>Technical details</summary>
<dl class="technical">
<dt>Publisher</dt>
<dd>${escaped(latest.publisher)}</dd>
<dt>App ID</dt>
<dd>
<code>${escaped(latest.app)}</code>
</dd>
<dt>Package format</dt>
<dd>${escaped(latest.format)}</dd>
<dt>Capabilities</dt>
<dd>
<code>${latest.capabilities.map(escaped).join(", ")}</code>
</dd>
</dl>
</details>
</div>`,
    { detail: true },
  );
}

function listingCard(app) {
  const path = escaped(app.publisher + "/" + app.app + "/");
  return `<article class="app-card" data-app="${escaped(app.publisher + "/" + app.app)}">
<a class="card-cover" href="${path}" aria-label="View ${escaped(app.name)}">${publicPreview(app)}</a>
<div class="card-body">
<h2>${escaped(app.name)}</h2>
<p class="card-description">${escaped(app.description)}</p>
<div class="card-foot">
<span class="byline">Publisher ID: ${escaped(app.publisher)}</span>
<a class="text-link" href="${path}">View app <span aria-hidden="true">&rarr;</span>
</a>
</div>
</div>
</article>`;
}
const pages = new Map();
const artifacts = new Map();
const packages = [];
for (const file of files) {
  const data = await readFile(file);
  const check = spawnSync(
    join(root, "scripts/go"),
    ["run", "./cmd/coveapp", "validate", "-"],
    {
      cwd: join(root, "services/local-service"),
      encoding: "utf8",
      input: data,
    },
  );
  if (check.status !== 0)
    throw new Error(check.stderr.trim() || "Package validation failed.");
  const app = JSON.parse(data);
  const id = app.publisher + "/" + app.app;
  const releases = pages.get(id) ?? [];
  if (releases.some((release) => release.version === app.version))
    throw new Error("Duplicate release: " + id + " " + app.version);
  artifacts.set(id + "/" + app.version, data);
  releases.push(app);
  pages.set(id, releases);
  packages.push(data.toString("base64"));
}
const issued = Date.now();
const payload = Buffer.from(
  JSON.stringify({
    format: 2,
    sequence,
    issued_at: new Date(issued).toISOString(),
    expires_at: new Date(issued + 30 * 86400000).toISOString(),
    packages,
  }),
);
const envelope = JSON.stringify({
  payload: payload.toString("base64"),
  signature: sign(null, payload, key).toString("base64"),
});
if (Buffer.byteLength(envelope) > 8 * 1024 * 1024)
  throw new Error("Signed catalog exceeds the host limit.");
await mkdir(dirname(destination), { recursive: true });
const staging = await mkdtemp(destination + ".staging-");
try {
  await writeFile(join(staging, "catalog.json"), envelope);
  const listing = [];
  const groups = [...pages.entries()].sort(([, first], [, second]) =>
    first[0].name.localeCompare(second[0].name),
  );
  for (const [id, releases] of groups) {
    const directory = join(staging, "apps", id);
    await mkdir(directory, { recursive: true });
    releases.sort((a, b) =>
      b.version.localeCompare(a.version, "en", { numeric: true }),
    );
    for (const release of releases) {
      await writeFile(
        join(directory, release.version + ".coveapp"),
        artifacts.get(id + "/" + release.version),
      );
    }
    await writeFile(join(directory, "index.html"), detailHTML(releases));
    listing.push(listingCard(releases[0]));
  }
  await writeFile(
    join(staging, "apps/index.html"),
    documentHTML(
      "Discover",
      `<section class="intro">
<p class="eyebrow">The app collection</p>
<h1>Find your next little helper.</h1>
<p>Pick an app, make your own copy, and keep what you save on your Mac.</p>
</section>
<p class="collection-count">${listing.length} ${listing.length === 1 ? "app" : "apps"} to make your own</p>
<section class="app-grid" aria-label="Available apps">${listing.join("")}</section>`,
    ),
  );
  await rename(staging, destination);
} finally {
  await rm(staging, { recursive: true, force: true });
}
const publicKey = createPublicKey(key).export({ format: "jwk" });
console.log(
  "Catalog verification key: " +
    Buffer.from(publicKey.x, "base64url").toString("base64"),
);
