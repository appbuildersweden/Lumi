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
| AI           | [OpenRouter](https://openrouter.ai) via `reqwest` i Rust         |
| Nyckellagring| Windows Credential Manager via `keyring`                         |

Allt körs lokalt i WebView2. Själva studiematerialet ligger på datorn; bara
AI-anropen går över nätet.

## AI och API-nyckeln

Lumi anropar OpenRouter **från Rust-backend**, aldrig från gränssnittet.
Nyckeln skickas därför varken in i frontend-koden eller med i en färdig
`.exe`-fil.

Nyckeln letas upp i den här ordningen:

1. **Windows Credential Manager** – lägg in den under **Profil → OpenRouter-nyckel**.
   Den kontrolleras mot OpenRouter innan den sparas.
2. **Miljövariabeln `OPENROUTER_API_KEY`** – används om ingen nyckel finns i
   Credential Manager.

Exempel på miljövariabel i Windows (öppna en ny terminal efteråt):

```bat
setx OPENROUTER_API_KEY "sk-or-v1-..."
```

I utvecklingsläge läser Lumi även `.env` i projektroten om den finns. Filen
är gitignorerad och ska aldrig checkas in.

Modellen ställs in på ett enda ställe i koden:
`DEFAULT_MODEL` i `src-tauri/src/config.rs`. Eleven kan välja en annan modell
under **Profil → Modell**; valet sparas i appens inställningar.

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
| `meddelanden.json`     | meddelanden                         |
| `aktivitetslogg.json`  | administratörens ändringar          |

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
cd src-tauri && cargo test -- --ignored        # testerna som läser .env
```

## Bygga en Windows-installation eller .exe

```bash
npm run tauri build
```

Resultatet hamnar i `src-tauri/target/release/bundle/`:

- `msi/Lumi_0.1.0_x64_en-US.msi` – Windows-installation
- `nsis/Lumi_0.1.0_x64-setup.exe` – installationsprogram (`.exe`)

Själva programfilen utan installation ligger i
`src-tauri/target/release/Lumi.exe` (kräver WebView2, som finns inbyggt i
Windows 10/11).

Vill du bara bygga installationsprogrammet för `.exe`:

```bash
npm run tauri build -- --bundles nsis
```

## Struktur

```
src/
  App.tsx                 navigation mellan kategorierna
  navigation.ts           kategorierna, ikoner och texter
  lib/backend.ts          typade anrop mot Rust-backend
  components/
    Sidebar.tsx           rosa glassmorphism-meny
    ScrollCue.tsx         rund knapp som visar att det finns mer innehåll
    RichText.tsx          enkel visning av AI-text
  pages/
    Login.tsx             inloggning mot kontona i backend
    Home.tsx              startsidan: hero-banner, uppdateringar, framsteg, schema
    TeacherChat.tsx       AI-lärare med strömmande svar och samtalsminne
    Study.tsx             Plugga: skapa, granska, spara och öppna material
    Schedule.tsx          Schema: elevens egna poster ur den gemensamma datan
    Progress.tsx          Framsteg: riktiga resultat från quiz och prov
    Profile.tsx           Elevens profil: läsbar, plus nyckel och modell
    PlaceholderPage.tsx   enhetlig sida för Information och Meddelanden
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
src-tauri/src/
  lib.rs                  startpunkt, state och registrerade kommandon
  config.rs               modellnamn och API-inställningar (en plats)
  openrouter.rs           klient: chatt, strömning, scheman, felhantering
  chat.rs                 lärarprompten och samtalshistoriken
  materials.rs            materialtyper, JSON-scheman och validering
  storage.rs              läsning och skrivning av JSON-filerna
  auth.rs                 konton, roller, hashning och inloggningsskydd
  commands.rs             kommandona som gränssnittet anropar
  error.rs                fel som skickas till gränssnittet
```

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
| Meddelanden          | platshållare                                                |
| Information          | platshållare                                                |

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
