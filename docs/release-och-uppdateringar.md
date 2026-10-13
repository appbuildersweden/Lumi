# Lumi – installation, release och uppdateringar

Det här dokumentet beskriver hur en Windows-installation byggs, hur den
publiceras och hur versionskontrollen i appen fungerar.

**Inget är publicerat.** Ingen release finns på GitHub, ingen installationsfil
ligger ute och nedladdningsknappen på webbplatsen visar fortfarande
*Kommer snart*.

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

Tappas den privata nyckeln eller lösenordet bort kan inga fler uppdateringar
signeras – då måste användarna installera en ny version manuellt en gång.

Den förra nyckeln, som saknade lösenord, ligger kvar som
`%USERPROFILE%\.lumi\lumi-updater-utan-losenord.bak.key`. Den hör inte till
någon release och kan raderas.

## 3. Bygga en release lokalt

```bash
# 1. Höj versionen på båda ställena
#    package.json  → "version"
#    src-tauri/tauri.conf.json → "version"

# 2. Kontrollera att allt fungerar
npm run build
cd src-tauri && cargo test --all-targets && cd ..

# 3. Bygg installationsfilen
export TAURI_SIGNING_PRIVATE_KEY="$USERPROFILE/.lumi/lumi-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<lösenordet ur DPAPI-filen ovan>"
npm run tauri build -- --bundles nsis
```

Utan `TAURI_SIGNING_PRIVATE_KEY` avbryts bygget, eftersom
`createUpdaterArtifacts` är påslaget. Det är avsiktligt: en release utan
signatur kan inte uppdateras.

## 4. Publicera releasen

1. Skapa en release på GitHub med en tagg som `v0.1.0` (inte förhandsversion och
   inte utkast – `releases/latest` hoppar över båda).
2. Ladda upp filerna från `src-tauri/target/release/bundle/nsis/`.
3. Ladda också upp en kopia av installationsprogrammet med det fasta namnet
   `Lumi-setup.exe`. Webbplatsens nedladdningsknapp pekar på det namnet, så
   länken behöver inte ändras mellan versioner.
4. Skapa `latest.json` och ladda upp den i samma release:

```json
{
  "version": "0.1.0",
  "notes": "Kort om vad som är nytt.",
  "pub_date": "2026-10-13T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "innehållet i Lumi_0.1.0_x64-setup.exe.sig",
      "url": "https://github.com/appbuildersweden/Lumi/releases/download/v0.1.0/Lumi_0.1.0_x64-setup.exe"
    }
  }
}
```

Appen frågar efter
`https://github.com/appbuildersweden/Lumi/releases/latest/download/latest.json`
och jämför versionen i filen med den som körs.

## 5. Vad appen gör av uppdateringar

- Vid start görs en versionskontroll i bakgrunden. Den skriver bara en rad i
  terminalen om en nyare version finns, och påverkar inte starten.
- Kommandot `check_for_update` ger gränssnittet samma svar: den nya versionen,
  den nuvarande versionen och versionsanteckningarna.
- Appen **laddar inte ner eller installerar något av sig själv**. Det är ett
  medvetet val: en uppdatering ska ske efter ett beslut, inte i smyg. Vill man
  att appen ska sköta det automatiskt kopplas `download_and_install` till
  samma kontroll, och en rad i gränssnittet som visar vad som händer.

Signaturen verifieras av Tauri med den publika nyckeln innan något installeras.
Stämmer den inte avbryts uppdateringen.

## 6. Nedladdningsknappen på webbplatsen

I `website/src/content.ts`:

```ts
export const DOWNLOAD: DownloadInfo = {
  available: false,   // sätts till true när releasen finns
  url: "https://github.com/appbuildersweden/Lumi/releases/latest/download/Lumi-setup.exe",
  version: "0.1.0",   // fylls i vid publicering
  requirements: ["Windows 10 eller 11 (64-bitars)"],
  steps: ["Hämta filen", "Kör installationsprogrammet", "Starta Lumi"],
};
```

Adressen är den samma för varje version, eftersom kopian heter `Lumi-setup.exe`.
Så länge `available` är `false` visar knappen *Kommer snart* och ingen länk
skapas.
