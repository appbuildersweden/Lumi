// Förbereder en release: skriver uppdateringsmanifestet `latest.json` och
// kopierar installationsprogrammet till det fasta namnet `Lumi-setup.exe`.
//
// Signaturen läses ur `.sig`-filen som bygget skapade. Att skriva den för hand
// är lätt att glömma efter ett nytt bygge, och ett manifest med en gammal
// signatur gör att uppdateringen avbryts hos den som redan har Lumi. Därför
// hämtas den alltid från filen som hör till just den här installationsfilen.
//
// Körs efter `npm run tauri build -- --bundles nsis`:
//
//   node scripts/forbered-release.mjs

import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const config = JSON.parse(
  await readFile(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);
const version = config.version;

const bundle = path.join(root, "src-tauri", "target", "release", "bundle", "nsis");
const installer = path.join(bundle, `Lumi_${version}_x64-setup.exe`);
const signatureFile = `${installer}.sig`;
const notesFile = path.join(root, "docs", `versionsanteckningar-${version}.md`);

async function read(pathname, what) {
  try {
    return await readFile(pathname, "utf8");
  } catch {
    throw new Error(
      `${what} saknas: ${pathname}\n` + "Bygg releasen först: npm run tauri build -- --bundles nsis",
    );
  }
}

const signature = (await read(signatureFile, "signaturen")).trim();
const notes = (await read(notesFile, "versionsanteckningarna")).trim();

if (!signature) {
  throw new Error(`signaturen i ${signatureFile} är tom – bygg om releasen`);
}

// Adressen pekar på kopian med det fasta namnet, samma fil som webbplatsens
// nedladdningsknapp hämtar. Då behöver ingen adress ändras mellan versioner.
const url = `https://github.com/appbuildersweden/Lumi/releases/download/v${version}/Lumi-setup.exe`;

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  platforms: {
    "windows-x86_64": { signature, url },
  },
};

const manifestFile = path.join(bundle, "latest.json");
const fixedName = path.join(bundle, "Lumi-setup.exe");

await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile(installer, fixedName);

// Signaturen hör till filen den hör till. Kopian med det fasta namnet får sin
// egen signaturfil – annars ligger en äldre signatur kvar bredvid den nya
// installationsfilen, och den som kontrollerar för hand får fel svar.
await copyFile(signatureFile, `${fixedName}.sig`);

const bytes = await readFile(installer);
const hash = createHash("sha256").update(bytes).digest("hex");

console.log(`Version:        ${version}`);
console.log(`Installationsfil: ${path.basename(installer)} (${bytes.length} byte)`);
console.log(`Kopia:          ${path.basename(fixedName)}`);
console.log(`Signaturkopia:  ${path.basename(fixedName)}.sig`);
console.log(`Manifest:       ${path.basename(manifestFile)}`);
console.log(`Nedladdning:    ${url}`);
console.log(`SHA-256:        ${hash}`);
