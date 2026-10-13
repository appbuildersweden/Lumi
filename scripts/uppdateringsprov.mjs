// Serverar uppdateringsmanifestet lokalt, så att en äldre version kan möta en
// nyare utan att releasen ligger på GitHub.
//
// Skriptet läser det riktiga `latest.json` och den riktiga installationsfilen
// från `src-tauri/target/release/bundle/nsis/`, skriver om adressen i
// manifestet till den lokala adressen och serverar båda.
//
//   node scripts/uppdateringsprov.mjs                 # riktig signatur
//   node scripts/uppdateringsprov.mjs --trasig        # förstörd signatur
//   node scripts/uppdateringsprov.mjs --port 8765
//
// Signaturen är den samma som i releasen: det är samma fil och samma manifest
// som publiceras, bara adressen som byts. Med `--trasig` ändras ett tecken i
// signaturen, och då ska ingenting installeras.
//
// Provet körs med en testvariant av appen som pekar på den här adressen:
//
//   npm run tauri build -- --no-bundle --config '{"version":"0.1.1",
//     "bundle":{"createUpdaterArtifacts":false},
//     "plugins":{"updater":{"endpoints":["http://127.0.0.1:8765/latest.json"],
//     "dangerousInsecureTransportProtocol":true}}}'
//
// `dangerousInsecureTransportProtocol` och den lokala adressen får aldrig
// finnas i `tauri.conf.json` – den riktiga konfigurationen använder https.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const bundle = path.join(root, "src-tauri", "target", "release", "bundle", "nsis");

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const broken = process.argv.includes("--trasig");
const port = Number(argument("--port", "8765"));
const origin = `http://127.0.0.1:${port}`;

const manifest = JSON.parse(await readFile(path.join(bundle, "latest.json"), "utf8"));
const installerName = "Lumi-setup.exe";

for (const platform of Object.values(manifest.platforms ?? {})) {
  platform.url = `${origin}/${installerName}`;
  if (broken) {
    // Ett enda tecken ändrat räcker: signaturen hör inte längre till filen.
    platform.signature = `${platform.signature.slice(0, -1)}A`;
  }
}

const installer = await readFile(path.join(bundle, installerName));

createServer((request, response) => {
  const name = new URL(request.url, origin).pathname;

  if (name === "/latest.json") {
    console.log(`${new Date().toISOString()}  latest.json  (version ${manifest.version}${broken ? ", trasig signatur" : ""})`);
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  if (name === `/${installerName}`) {
    console.log(`${new Date().toISOString()}  ${installerName}  (${installer.length} byte)`);
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": installer.length,
    });
    response.end(installer);
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("nej");
}).listen(port, "127.0.0.1", () => {
  console.log(`Serverar version ${manifest.version}${broken ? " med trasig signatur" : ""} på ${origin}`);
  console.log("Stäng med Ctrl+C när provet är klart.");
});
