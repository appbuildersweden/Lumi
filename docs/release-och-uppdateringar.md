# Lumi – installation, release och uppdateringar

Det här dokumentet beskriver hur en Windows-installation byggs, hur den
publiceras och hur versionskontrollen i appen fungerar.

**Version 0.1.0 är publicerad.** Releasen ligger på
<https://github.com/appbuildersweden/Lumi/releases/tag/v0.1.0>,
installationsfilen går att hämta från
<https://github.com/appbuildersweden/Lumi/releases/latest/download/Lumi-setup.exe>
och nedladdningsknappen på webbplatsen är aktiv.

## 1. Vad som byggs

| Fil | Vad den är |
| --- | --- |
| `Lumi_<version>_x64-setup.exe` | Installationsprogrammet som eleven kör – och samma fil som uppdateringen hämtar |
| `Lumi_<version>_x64-setup.exe.sig` | Signaturen som appen verifierar innan en uppdatering installeras |

Båda hamnar i `src-tauri/target/release/bundle/nsis/`. Installationsprogrammet
begär `asInvoker` i sin inbäddade manifest, alltså ingen behörighetshöjning.

Installationen sker för den aktuella användaren (`installMode: "currentUser"`),
till `%LOCALAPPDATA%\Lumi`. Varken installation, uppdatering eller start kräver
administratörsbehörighet. WebView2 används som redan finns i Windows 10 och 11.

## 2. Signeringsnyckeln

Uppdateringar verifieras med en minisign-nyckel. Den **publika** nyckeln står i
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) och får ligga i repot.

Den **privata** nyckeln får aldrig ligga i appen, i GitHub-repot, i en
release eller på webbplatsen. Den används bara när en release byggs.

Nyckeln hör till den publika nyckeln i konfigurationen och ligger utanför
repot. Den skapades med ett eget lösenord:

```bash
npx tauri signer generate -w "$USERPROFILE/.lumi/lumi-updater.key"
```

Filen ligger i `%USERPROFILE%\.lumi\lumi-updater.key`. `*.key` är spärrat i
`.gitignore`, så en nyckel som råkar hamna i projektmappen kan inte checkas in.

Lösenordet ligger inte i klartext någonstans. Det förvaras DPAPI-krypterat i
`%USERPROFILE%\.lumi\lumi-updater-password.dpapi`, och bara den Windows-användare
som skapade filen kan läsa den. Hämta det till en byggsession så här:

```powershell
$s = Get-Content "$env:USERPROFILE\.lumi\lumi-updater-password.dpapi" | ConvertTo-SecureString
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
```

Lösenordet behövs också som hemlighet i GitHub (Settings → Secrets → Actions,
namnen `TAURI_SIGNING_PRIVATE_KEY` och `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) om
releaser ska byggas automatiskt. Kopiera det då från kommandot ovan – det visas
inte någon annanstans. Den 13 oktober 2026 låg hemligheterna ännu inte i GitHub,
eftersom releasen byggdes lokalt.

Utan lösenordet går det inte att signera: `tauri signer sign` svarar
*Wrong password for that key*. Det är avsiktligt – nyckelfilen är värdelös för
den som kommer över den utan lösenordet.

Skriv aldrig lösenordet på en kommandorad som sparas i en loggfil. Kommandot
`tauri signer generate -p <lösenord>` visar lösenordet i sin egen utskrift, så
om utskriften sparas (till exempel med `> fil`) ligger hemligheten i klartext i
filen. Loggen från nyckelgenereringen den 13 oktober 2026 innehöll lösenordet av
den anledningen och skrevs ren. Använd DPAPI-filen ovan i stället.

Tappas den privata nyckeln eller lösenordet bort kan inga fler uppdateringar
signeras – då måste användarna installera en ny version manuellt en gång.

Den förra nyckeln ligger kvar som
`%USERPROFILE%\.lumi\lumi-updater-utan-losenord.bak.key`. Den hör inte till den
publicerade nyckeln i `tauri.conf.json` och kan raderas; så länge den ligger kvar
är det värt att veta att den inte används av någon release.

## 3. Bygga en release lokalt

```bash
# 1. Höj versionen på tre ställen
#    package.json              → "version"
#    src-tauri/tauri.conf.json → "version"
#    src-tauri/Cargo.toml      → [package] version

# 2. Kontrollera att allt fungerar
npm run build
cd src-tauri && cargo test --all-targets && cd ..

# 3. Bygg installationsfilen
export TAURI_SIGNING_PRIVATE_KEY="$USERPROFILE/.lumi/lumi-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<lösenordet ur DPAPI-filen ovan>"
npm run tauri build -- --bundles nsis

# 4. Skriv uppdateringsmanifestet och kopian med det fasta namnet
npm run release:forbered
```

Utan `TAURI_SIGNING_PRIVATE_KEY` avbryts bygget, eftersom
`createUpdaterArtifacts` är påslaget. Det är avsiktligt: en release utan
signatur kan inte uppdateras.

`npm run release:forbered` läser signaturen ur
`Lumi_<version>_x64-setup.exe.sig`, skriver `latest.json` och kopierar
installationsfilen till `Lumi-setup.exe`. Versionsanteckningarna hämtas från
`docs/versionsanteckningar-<version>.md`, som också kan användas som texten i
GitHub-releasen. Skriptet skriver ut SHA-256 för installationsfilen, så att
samma fil kan kontrolleras efter uppladdningen.

## 4. Publicera releasen

1. Skapa en release på GitHub med en tagg som `v0.1.1` (inte förhandsversion och
   inte utkast – `releases/latest` hoppar över båda).
2. Ladda upp filerna från `src-tauri/target/release/bundle/nsis/`:
   `Lumi_<version>_x64-setup.exe`, `Lumi_<version>_x64-setup.exe.sig`,
   `Lumi-setup.exe` och `latest.json`.
3. Kontrollera att adressen
   `releases/latest/download/Lumi-setup.exe` ger samma SHA-256 som skriptet
   skrev ut.

`latest.json` ser ut så här:

```json
{
  "version": "0.1.1",
  "notes": "Kort om vad som är nytt.",
  "pub_date": "2026-10-13T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "innehållet i Lumi_0.1.1_x64-setup.exe.sig",
      "url": "https://github.com/appbuildersweden/Lumi/releases/download/v0.1.1/Lumi-setup.exe"
    }
  }
}
```

Appen frågar efter
`https://github.com/appbuildersweden/Lumi/releases/latest/download/latest.json`
och jämför versionen i filen med den som körs. Signaturen måste höra till just
den uppladdade installationsfilen – ett manifest med en gammal signatur gör att
uppdateringen avbryts hos alla som redan har Lumi. Det är därför
`release:forbered` skriver manifestet i stället för att det skrivs för hand.

## 5. Vad appen gör av uppdateringar

- **Vid start** kontrolleras versionen i bakgrunden. Finns en nyare version
  hämtas den, signaturen verifieras och installationen startar av sig själv.
  Ingen behöver besöka webbplatsen eller köra en installationsfil. Att det sker
  just vid start är avsiktligt: ingen har hunnit börja arbeta ännu.
- **Under en pågående session installeras inget.** En omstart mitt i arbetet
  vore ett avbrott, så en ny version som hittas då installeras i stället vid
  nästa start. Kontrollen görs om var sjätte timme.
- **Gränssnittet får veta vad som händer.** Händelserna
  `lumi://update-available`, `lumi://update-progress` och `lumi://update-failed`
  berättar att en uppdatering är på väg, hur långt nedladdningen har kommit och
  om något gick fel. Kommandot `check_for_update` ger samma svar som förut.
- **Inget installeras utan verifiering.** Tauri kontrollerar signaturen mot den
  publika nyckeln i `tauri.conf.json` innan filen godkänns.

Misslyckas något – inget nät, servern svarar inte, manifestet går inte att läsa,
**signaturen stämmer inte** eller installationen startar inte – avbryts
uppdateringen och Lumi kör vidare precis som förut. Felet skrivs i terminalen och
skickas till gränssnittet; det finns ingen väg där en overifierad fil installeras.
Nästa start gör ett nytt försök.

Den här delen av installationen kan bara testas mot en riktig release, eftersom
manifest och signatur kommer från GitHub. `cargo test -- --ignored` verifierar
signaturen i manifestet mot installationsfilens `.sig` och mot den publika
nyckeln i konfigurationen – samma kontroll som appen gör.

## 6. Nedladdningsknappen på webbplatsen

I `website/src/content.ts`:

```ts
export const DOWNLOAD: DownloadInfo = {
  available: true,    // false tills releasen finns
  url: "https://github.com/appbuildersweden/Lumi/releases/latest/download/Lumi-setup.exe",
  version: "0.1.0",   // fylls i vid publicering
  requirements: ["Windows 10 eller 11 (64-bitars)"],
  steps: ["Hämta filen", "Kör installationsprogrammet", "Starta Lumi"],
};
```

Adressen är den samma för varje version, eftersom kopian heter `Lumi-setup.exe`.
Så länge `available` är `false` visar knappen *Kommer snart* och ingen länk
skapas.