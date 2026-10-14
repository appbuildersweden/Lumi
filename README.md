# Lumi

En Windows-desktopapp för studier. Innehåller appens grund, den rosa
glassmorphism-designen för eleven, startsidan som personlig översikt,
navigation mellan kategorierna, en AI-lärare som skapar riktigt studiematerial
och en adminpanel i blått och vitt med elev- och personalregister, konton,
roller, scheman och uppgifter.

## Teknik

| Del          | Val                                                              |
| ------------ | ---------------------------------------------------------------- |
| Skal         | [Tauri 2](https://tauri.app) (Rust + WebView2)                   |
| Gränssnitt   | React 19 + TypeScript, byggt med Vite                            |
| Ikoner       | `lucide-react`                                                   |
| Typsnitt     | Plus Jakarta Sans, bundlat lokalt via `@fontsource`              |
| Styling      | Vanlig CSS i `src/styles/global.css` (inga ramverk)              |
| AI           | OpenRouter, via Lumis egen AI-tjänst i `ai-proxy/`               |
| AI-tjänst    | Cloudflare Worker + D1 (`ai-proxy/`)                             |

Allt körs lokalt i WebView2. Själva studiematerialet ligger på datorn; bara
AI-anropen går över nätet.

## AI och API-nyckeln

Lumi anropar aldrig OpenRouter direkt. Kedjan är:

```
appen (Rust)  ->  Lumis AI-tjänst på Cloudflare  ->  OpenRouter
```

Nyckeln till OpenRouter ligger som en **hemlighet hos tjänsten**. Den finns
alltså inte i appen, inte i installationsfilen, inte i det här repot och inte
på någon elevs dator. Källkoden till tjänsten ligger i `ai-proxy/`, och hur den
driftsätts står i [ai-proxy/README.md](ai-proxy/README.md).

Det appen skickar med varje anrop är två huvuden: en markering som visar att
anropet kommer från Lumis app, och ett hashat konto-id. Markeringen är ingen
nyckel – den kan läsas ur appen och bytas – men den gör att tjänsten kan
avvisa allt som inte kommer från Lumi och räkna anrop per konto.

Tjänsten gör fyra saker: släpper bara in Lumis app och inloggade konton,
begränsar takten (30 frågor per konto och minut, ett dygnstak för hela
tjänsten), vidarebefordrar anropet med nyckeln pålagd, och **byter automatiskt
till en gratismodell** om kontot inte kan använda betalmodellerna. Eleven ser
då en diskret rad i iChat och Plugga: *AI använder just nu en gratismodell …*.

Modellerna ställs in på ett enda ställe i koden: `config.rs` i appen och
`ALLOWED_MODELS` i tjänsten. Eleven kan välja en annan modell under
**Profil → Modell**; valet sparas i appens inställningar.

Under utveckling kan appen pekas mot en lokal tjänst med miljövariablerna
`LUMI_AI_URL` och `LUMI_AI_TOKEN`. Är bara en av dem satt används den
inbyggda tjänsten.

### Var datan sparas

I appens datamapp (`%APPDATA%\com.jenst.lumi\data`):

| Fil                    | Innehåll                            |
| ---------------------- | ----------------------------------- |
| `anvandare.json`       | konton med hashade lösenord         |
| `personer.json`        | elev- och personalregistret         |
| `schema.json`          | schemaposter per veckodag           |
| `uppgifter.json`       | uppgifter och deras tilldelning     |
| `inlamningar.json`     | inlämningar                         |
| `prov.json`            | prov                                |
| `provresultat.json`    | resultat per elev och prov          |
| `studiematerial.json`  | studiematerial, ett konto per post    |
| `resultat.json`        | resultat från quiz och prov, per konto |
| `installningar.json`   | modellval per konto + standarden     |
| `meddelanden.json`     | nyheter och meddelanden, med mottagare och vikt |
| `aktivitetslogg.json`  | administratörens ändringar          |

### Information till eleverna

Skolans information ligger i `meddelanden.json` och läses alltid genom
backend. Varje post har en mottagare – `alla`, `elever`, `lärare`, en eller
flera `klass`-er eller en `grupp` av enskilda elever – och en vikt
(`normal`, `viktig`, `akut`). Administratören når hela skolan och kan ändra
allt; en lärare når de klasser den undervisar enligt schemat och hanterar sina
egna poster; eleven läser bara det som gäller eleven eller elevens klass.
Poster som sparades innan fälten fanns läses som `alla` och `normal`.

### Egna data per konto

Studiematerial, quizresultat och modellval tillhör **kontot**, inte datorn. En
elev ser bara sitt eget, och ägaren sätts alltid av backend ur sessionen –
gränssnittet kan aldrig peka ut ett annat konto. En administratör kan läsa en
elevs resultat (det är elevöversikten), och inget annat.

Äldre poster som skapades innan kontona fanns saknar ägare. Ägaren går inte att
fastställa i efterhand, så de flyttas en gång till `studiematerial-aldre.json`
och `resultat-aldre.json`, med en säkerhetskopia bredvid. De raderas alltså inte
och blir heller inte synliga för alla elever. Flytten är idempotent – den körs
vid start, men gör ingenting andra gången.

Materialet finns kvar mellan omstarter. Lösenord lagras bara som Argon2id-hash,
AI-genererat innehåll valideras i backend både när det skapas och när det sparas,
och en ändring i panelen loggas utan adresser eller lösenord.

## Krav för att bygga

Rust-delen byggs med MSVC och behöver **Microsoft Visual Studio Build Tools
med Windows SDK**. Saknas SDK:ns `Lib`-mapp hittar länkaren inte
`kernel32.lib` och bygget stannar innan det har börjat. Kontrollera med:

```bat
dir "C:\Program Files (x86)\Windows Kits\10\Lib"
```

Installera vid behov arbetsbelastningen **Desktop development with C++** i
Visual Studio Installer.

## Starta i utvecklingsläge

```bash
npm install
npm run tauri dev
```

Första gången kompileras Rust-delen, vilket kan ta några minuter. Därefter
startar ett riktigt appfönster (inte en webbläsare).

Vill du bara se gränssnittet i en webbläsare går det snabbare:

```bash
npm run dev          # http://localhost:1420
```

I webbläsarläget finns ingen backend, så AI-funktionerna är avstängda och
sidorna visar sina tomma lägen.

## Kontroller

```bash
npm run typecheck                              # TypeScript
npm run build                                  # tsc + produktionsbygge av frontend
cd src-tauri && cargo check --all-targets      # Rust
cd src-tauri && cargo test --all-targets       # Rust, med testerna
cd src-tauri && cargo test --lib -- --ignored  # riktiga anrop mot AI-tjänsten
node --test ai-proxy/test                      # AI-tjänstens egna tester
```

Testerna som är märkta `#[ignore]` gör riktiga anrop mot den driftsatta
tjänsten. De behöver ingen lokal nyckel, och de kostar ingenting så länge
kontot använder gratismodellen.

## Bygga en Windows-installation

Signeringsnyckeln behövs för att uppdateringsfilerna ska kunna verifieras. Den
ligger utanför repot, se [docs/release-och-uppdateringar.md](docs/release-och-uppdateringar.md).

```bash
export TAURI_SIGNING_PRIVATE_KEY="$USERPROFILE/.lumi/lumi-updater.key"
npm run tauri build -- --bundles nsis
```

Resultatet hamnar i `src-tauri/target/release/bundle/nsis/`:

- `Lumi_<version>_x64-setup.exe` – installationsprogrammet, och samma fil som en
  uppdatering hämtar
- `Lumi_<version>_x64-setup.exe.sig` – signaturen som appen verifierar vid en
  uppdatering

Själva programfilen utan installation ligger i
`src-tauri/target/release/Lumi.exe` (kräver WebView2, som finns inbyggt i
Windows 10/11).

Installationen sker **för den aktuella användaren** och kräver därför varken
administratörsbehörighet eller ett lösenord (`installMode: "currentUser"` i
`src-tauri/tauri.conf.json`). MSI väljs bort med flit: MSI-installationen
kräver administratör.

Hur en ny version publiceras, och hur versionskontrollen i appen hänger ihop
med releasen, står i [docs/release-och-uppdateringar.md](docs/release-och-uppdateringar.md).

## Struktur

```
src/
  App.tsx                 navigation mellan kategorierna
  navigation.ts           kategorierna, ikoner och texter
  lib/backend.ts          typade anrop mot Rust-backend
  lib/info.ts             sortering och texter för skolans information
  components/
    Sidebar.tsx           rosa glassmorphism-meny
    ScrollCue.tsx         rund knapp som visar att det finns mer innehåll
    RichText.tsx          enkel visning av AI-text
    AiNotice.tsx          diskret rad när svaren kommer från en gratismodell
    InfoComposer.tsx      skapa och ändra information, för admin och lärare
  pages/
    Login.tsx             inloggning mot kontona i backend
    Home.tsx              startsidan: hero-banner, nyheter från skolan, framsteg
    Announcements.tsx     Information och Meddelanden från skolan
    TeacherChat.tsx       AI-lärare med strömmande svar och samtalsminne
    Study.tsx             Plugga: skapa, granska, spara och öppna material
    Schedule.tsx          Schema: elevens egna poster ur den gemensamma datan
    Progress.tsx          Framsteg: riktiga resultat från quiz och prov
    Profile.tsx           Elevens profil: läsbar, plus nyckel och modell
    PlaceholderPage.tsx   enhetlig sida för kategorier som ännu är tomma
  admin/
    AdminApp.tsx          adminpanelen: egen sidopanel och de sex kategorierna
    nav.ts                sidopanelens sju poster, i fast ordning
    PersonAdmin.tsx       elev- och personalregistret, med kontokoppling
    useAdminData.ts       hämtar panelens data en gång per omladdning
    ui.tsx                panel, tomt läge, återkoppling och bekräftelse
    derive.ts             datum, statusar och urval ur den gemensamma datan
    pages/                Startsida, Elever, Personal, Konton, Roller,
                          Scheman-hantering och Uppgifter
  styles/global.css       design, färger, glassmorphism och anpassning
ai-proxy/
  src/index.js            AI-tjänsten: grind, takt, vidarebefordran, reservmodell
  test/service.test.mjs   tjänstens tester, med nätverket utbytt mot en attrapp
  wrangler.toml           driftsättning och D1-bindningen
src-tauri/src/
  lib.rs                  startpunkt, state och registrerade kommandon
  config.rs               modellnamn och tjänstens adress (en plats)
  openrouter.rs           klient: chatt, strömning, scheman, felhantering
  chat.rs                 lärarprompten och samtalshistoriken
  materials.rs            materialtyper, JSON-scheman och validering
  storage.rs              läsning och skrivning av JSON-filerna
  auth.rs                 konton, roller, hashning och inloggningsskydd
  commands.rs             kommandona som gränssnittet anropar
  error.rs                fel som skickas till gränssnittet
```

## Webbplatsen

Lumis webbplats ligger i `website/` som ett eget Vite-projekt, skilt från
appen. Den innehåller startsida, funktioner, så fungerar Lumi, nedladdning och
om Lumi – ingen inloggning, databas eller AI.

```bash
cd website
npm install
npm run dev      # utvecklingsserver
npm run build    # typkontroll + statiskt bygge i website/dist
```

Nedladdningsknappen hämtar filen från
`releases/latest/download/Lumi-setup.exe`, så adressen är samma för varje
version. **Efter varje versionshöjning måste `DOWNLOAD` i
`website/src/content.ts` fyllas i och webbplatsen byggas och laddas upp igen**,
annars visar sidan det gamla versionsnumret. Mer i
[website/README.md](website/README.md).

## Vad som väntar

Adminpanelens sidopanel har sju poster: **Startsida**, **Elever**, **Personal**,
**Konton**, **Roller**, **Scheman-hantering** och **Uppgifter**. Den egna
profilen nås från profilområdet längst ned.

Följande är byggt men väntar på en egen plats, eller på att färdigställas:

| Del                  | Läget                                                       |
| -------------------- | ----------------------------------------------------------- |
| Elev-uppgifter       | inlämningar och status finns; egen vy väntar                |
| Elev-prov            | prov och resultat finns; egen vy väntar                     |
| Elev-kontroll        | uppföljningen finns i koden; egen vy väntar                 |
| Elevöversikt         | nås från elevregistret tills den får en egen plats          |
| Lärarvy              | inte byggd ännu                                             |

Schemats poster gäller en veckodag, inte ett enskilt datum, så kalendern
markerar veckodagar. Elever och lärare får sina uppgifter och sitt lösenord
hanterade av en administratör.

Äldre studiematerial som saknade kontoägare ligger bevarat i
`studiematerial-aldre.json` i appens datamapp. Det visas inte för någon elev.
Säg till om det i stället ska knytas till ett konto – det kräver ett medvetet
val, eftersom ägaren inte går att avgöra säkert.

Hur projektet kan gå vidare mot en webbplats och en färdig Windows-app finns
beskrivet i [docs/webbplats-och-exe.md](docs/webbplats-och-exe.md) – inklusive
vad som är bundet till Tauri och vilka beslut som måste fattas först.
