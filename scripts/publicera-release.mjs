// Publicerar en byggd release till GitHub.
//
// Skriptet skapar releasen som ett **utkast**, laddar upp filerna och gör den
// offentlig först när alla filer ligger på plats. Ett utkast syns inte i
// `releases/latest`, så ingen installerad Lumi kan råka hämta ett manifest
// medan installationsfilen ännu saknas.
//
//   node scripts/publicera-release.mjs            # publicera den byggda versionen
//   node scripts/publicera-release.mjs --kontroll  # visa bara vad som finns
//
// Inloggningen hämtas från `git credential fill` om ingen `GITHUB_TOKEN` finns
// i miljön. Värdet skrivs aldrig ut.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repository = "appbuildersweden/Lumi";
const checkOnly = process.argv.includes("--kontroll");

const config = JSON.parse(
  await readFile(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")
);
const version = config.version;
const tag = `v${version}`;

const bundle = path.join(root, "src-tauri", "target", "release", "bundle", "nsis");
const notesFile = path.join(root, "docs", `versionsanteckningar-${version}.md`);

/** Filerna som hör till en release, i den ordning de laddas upp. */
const assets = [
  `Lumi_${version}_x64-setup.exe`,
  `Lumi_${version}_x64-setup.exe.sig`,
  "Lumi-setup.exe",
  "Lumi-setup.exe.sig",
  // Manifestet sist: det är filen apparna frågar efter.
  "latest.json",
];

/** Inloggningen till GitHub. Läses ur miljön eller ur git credential fill. */
function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  const answer = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });

  const line = answer.split("\n").find((row) => row.startsWith("password="));
  if (!line) throw new Error("ingen GitHub-inloggning kunde hämtas");
  return line.slice("password=".length);
}

const auth = token();
const headers = {
  Authorization: `Bearer ${auth}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "Lumi-release",
};

async function api(url, options = {}) {
  const response = await fetch(`https://api.github.com${url}`, { ...options, headers });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${url} gav ${response.status}: ${body.slice(0, 300)}`);
  }

  return body ? JSON.parse(body) : null;
}

async function upload(releaseId, name, file) {
  const content = await readFile(file);
  const response = await fetch(
    `https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/octet-stream" },
      body: content,
    }
  );

  if (!response.ok) {
    throw new Error(`uppladdningen av ${name} gav ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  return response.json();
}

// -- Kontrollera att filerna finns innan något laddas upp -------------------

const sizes = [];
for (const name of assets) {
  const file = path.join(bundle, name);
  try {
    sizes.push({ name, size: (await stat(file)).size });
  } catch {
    throw new Error(`filen saknas: ${file}\nBygg releasen först: npm run tauri build -- --bundles nsis`);
  }
}

console.log(`Version: ${version}  tagg: ${tag}`);
for (const file of sizes) console.log(`  ${file.name}  ${file.size} byte`);

if (checkOnly) {
  const releases = await api(`/repos/${repository}/releases`);
  console.log("\nPublicerade releaser:");
  for (const release of releases) {
    console.log(`  ${release.tag_name}  utkast: ${release.draft}  filer: ${release.assets.map((a) => a.name).join(", ") || "(inga)"}`);
  }
  process.exit(0);
}

// -- Skapa utkastet, ladda upp och gör det offentligt ----------------------

const notes = await readFile(notesFile, "utf8");
const existing = (await api(`/repos/${repository}/releases`)).find(
  (release) => release.tag_name === tag
);

if (existing) {
  throw new Error(`releasen ${tag} finns redan (${existing.html_url})`);
}

const release = await api(`/repos/${repository}/releases`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({
    tag_name: tag,
    name: `Lumi ${version}`,
    body: notes,
    draft: true,
    prerelease: false,
    target_commitish: "main",
  }),
});

console.log(`\nUtkast skapat: ${release.html_url}`);

for (const name of assets) {
  const uploaded = await upload(release.id, name, path.join(bundle, name));
  console.log(`  uppladdad: ${uploaded.name} (${uploaded.size} byte)`);
}

const published = await api(`/repos/${repository}/releases/${release.id}`, {
  method: "PATCH",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ draft: false }),
});

console.log(`\nPublicerad: ${published.html_url}`);

// -- Kontrollera det som apparna faktiskt hämtar --------------------------

const manifestUrl = `https://github.com/${repository}/releases/latest/download/latest.json`;
const installerUrl = `https://github.com/${repository}/releases/latest/download/Lumi-setup.exe`;

const manifest = await (await fetch(manifestUrl, { headers: { "User-Agent": "Lumi-release" } })).json();
const installer = Buffer.from(
  await (await fetch(installerUrl, { headers: { "User-Agent": "Lumi-release" } })).arrayBuffer()
);

const local = await readFile(path.join(bundle, `Lumi_${version}_x64-setup.exe`));
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

console.log(`\nlatest.json:        version ${manifest.version} (${manifest.version === version ? "stämmer" : "STÄMMER INTE"})`);
console.log(`nedladdningen:      ${installer.length} byte (${installer.length === local.length ? "stämmer" : "STÄMMER INTE"})`);
console.log(`SHA-256:            ${hash(installer)}`);
console.log(`samma fil som byggdes: ${hash(installer) === hash(local)}`);
