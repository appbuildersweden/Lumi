# Lumi – vägen till webbplats och .exe

Det här dokumentet beskriver vad som redan går att återanvända och vad som måste
bestämmas innan Lumi finns som webbplats eller som färdig Windows-app.

**Läget har ändrats sedan det här dokumentet skrevs.** Webbplatsen ligger på
<https://lumi-webbplats.pages.dev>, och Windows-appen finns som installerbar
`.exe` med automatiska uppdateringar – se
[release-och-uppdateringar.md](release-och-uppdateringar.md). Ett undantag från
"ingen extern tjänst": AI:n går sedan 0.1.2 via Lumis egen AI-tjänst i
[ai-proxy/](../ai-proxy/README.md), som håller OpenRouter-nyckeln utanför appen.

Avsnitten 3–8 nedan är fortfarande en plan för en framtida gemensam
webbapplikation: de beskriver vad som skiljer desktopappen från en server, inte
vad som är gjort. Lagring och inloggning i appen ligger kvar precis som de är
tills en migreringsplan har godkänts.

## 1. Det som kan återanvändas rakt av

| Del | Var |
| --- | --- |
| Hela gränssnittet: sidor, adminpanel, designspråk, CSS | `src/` |
| Affärslogik och validering: konton, roller, register, schema, uppgifter, prov | `src-tauri/src/auth.rs`, `commands.rs` |
| AI-prompten, samtalsminnet och materialtyperna | `src-tauri/src/chat.rs`, `materials.rs` |
| Datamodellerna: konton, personer, schema, uppgifter, inlämningar, prov, resultat, meddelanden, aktivitetslogg | `src-tauri/src/storage.rs` |
| Felkontraktet mot gränssnittet (`kind` + svensk text) | `src-tauri/src/error.rs` |
| Testerna för reglerna (86 stycken, inga Tauri-beroenden) | `src-tauri/src/**/tests` |

Frontend vet i praktiken inte att den körs i Tauri: allt går genom
[backend.ts](../src/lib/backend.ts), och enda undantaget är flaggan
`runningInTauri` som stänger av anropen i webbläsarläget.

## 2. Det som är bundet till desktopappen

| Del | Varför den inte följer med | Vad webbplatsen behöver i stället |
| --- | --- | --- |
| `#[tauri::command]` och `invoke` | Tauri IPC mellan fönster och Rust | HTTP-endpoints med samma regler |
| `AppState`: session i minnet, `OpenRouterClient`, modellcache, `LoginGuard` | Lever i processen på användarens dator | Session per användare (signerad cookie/token) och delad cache |
| `storage.rs`: JSON-filer i `%APPDATA%\com.jenst.lumi\data` | Skriver till den lokala datorn | Databas på serversidan |
| `keyring` (Windows Credential Manager) | Windows-specifik nyckellagring | Hemligheter i servermiljön, aldrig i klienten |
| `require_session` / `require_admin` | Läser kontot ur den lokala databasen varje anrop | Samma kontroll, men mot den inloggades session |
| `capabilities/default.json`, `tauri-plugin-opener` | Bara desktop | – |
| CSP är avstängd i `tauri.conf.json` | Onödigt i ett eget fönster | Behövs på webben |

Bra att veta: `Storage` skriver atomiskt (temp-fil + byt namn), läser en trasig
fil som ett tydligt fel i stället för att skriva över, och migrerar inte data
vid uppstart. Det gör lagringen enkel att flytta till en databas utan att
risken för halva filer följer med.

## 3. Så kan webbplatsen senare använda samma konton och data

Tre nivåer, i stigande ordning:

1. **Samma kod, separata data.** JSON-lagringen flyttas bakom ett litet API.
   Dator och webb har var sin uppsättning konton. Bra för demo, inte för skolan.
2. **Delad databas, samma logik.** `storage.rs` byts mot en databas och
   Rust-reglerna (hashning, roller, validering) exponeras som ett API. Konton
   och data blir gemensamma. Det här är nivån vi vill nå.
3. **Samma klient mot båda.** `backend.ts` får två transportsätt: Tauri IPC i
   appen och HTTP i webbläsaren. Det är den enda platsen i gränssnittet som
   behöver röras.

Sådant som redan passar nivå 2:

- Lösenorden ligger som Argon2id-hashar med eget salt (`auth.rs`) och kan flyttas som de är.
- `PublicUser` (utan hash) och `AppError` (kind + text) fungerar som API-kontrakt.
- Rollmodellen `admin` / `lärare` / `elev` med behörighetskontroll i backend fungerar oförändrad.
- Studiematerial och resultat har redan ett ägarfält per konto (`ownerId`), satt av backend ur sessionen. Det motsvarar en `userId`-kolumn i en databas och gör flytten till en gemensam databas utan att ägandet måste byggas om.
- Modellval sparas per konto, så varje inloggad får sitt eget val även mot en delad server.
- Aktivitetsloggen har redan en fast form (`actorId`, `action`, `detail`, `atMs`).

Sådant som måste byggas nytt:

- Session som överlever mellan anrop utan att servern minns fönstret.
- Inloggningsskyddet (`LoginGuard`) i delad lagring, annars gäller låsningen bara i en instans.
- Sökvägar, filuppladdning och allt som i dag antar en lokal disk.
- En gemensam fråga för elevdata över flera enheter: i dag ägs posterna av ett konto på en dator, inte av ett konto i skolan.

## 4. Behövs en gemensam backend?

För delade konton och data: **ja**. En webbplats kan inte läsa eller skriva
användarens `%APPDATA%`, och två klienter kan inte dela JSON-filer.

En gemensam backend behöver minst:

- Endpoints som motsvarar dagens kommandon, med samma regler och samma feltexter.
- Inloggning som sätter en session och kontrollerar rollen vid varje anrop (precis som `require_admin` i dag).
- Hashning av lösenord med Argon2id, aldrig klartext och aldrig hash till klienten.
- Ett skydd mot upprepade inloggningsförsök som gäller mellan instanser.
- Databas med samma modeller som `storage.rs`, plus revision av ändringar.

## 5. AI säkert från både app och webbplats

Sedan 0.1.2 går all AI genom en egen tjänst i stället för direkt till
OpenRouter:

```
appen (Rust)  ->  lumi-ai på Cloudflare  ->  OpenRouter
```

- Nyckeln ligger som en hemlighet hos tjänsten. Den finns inte i appen, inte i
  installationsfilen och inte i repot – den behöver därför inte längre sättas i
  någons miljövariabler, och inget bygge kan råka få med den.
- Appen skickar bara en markering (`X-Lumi-Client`) och ett hashat konto-id
  (`X-Lumi-User`). Markeringen är ingen nyckel: den kan läsas ur appen och bytas.
- Tjänsten avvisar anrop utan markering, begränsar takten per konto och per
  dygn, tillåter bara kända modeller och en begränsad anropsstorlek.
- Alla AI-kommandon (`chat_stream`, `generate_material`, `check_api_key`,
  `list_models`) kräver fortfarande en inloggad användare i appen.
- Saknar kontot krediter byter tjänsten automatiskt till en gratismodell och
  märker svaret (`X-Lumi-Fallback`), så att gränssnittet kan berätta det i
  stället för att svaret ser ut att komma från en dyrare modell.

På webben:

- Samma tjänst kan användas av en framtida webbklient. Då behöver tjänsten
  kunna kontrollera användaren på riktigt (en signerad session i stället för ett
  id som klienten själv uppger), annars gäller samma svaghet som i dag: den som
  har appen kan låna markeringen.
- Taket per konto finns redan; med riktiga konton kan förbrukningen dessutom
  loggas per användare.
- Beslut kvar: en gemensam nyckel för installationen, eller en nyckel per
  skola? Om tjänsten betalar för allt bör förbrukningen följas upp.

## 6. Cloudflare Pages specifikt

Cloudflare Pages hostar statiska filer och kan köra serverkod, men **varken
databas, inloggning eller AI följer med automatiskt**. Alla tre måste väljas och
kopplas separat, och inget av dem är valt här.

Det som kräver anpassning om vi väljer Pages:

- SPA-fallback: alla rutter måste falla tillbaka på `index.html`. (Den nya
  landningssidan har inga klientsidor och behöver därför ingen sådan regel.)
- API-bas-URL i produktion, och en CSP som passar appen.
- Sessionscookies över domänen, samt regler för vilka anrop som får komma från varifrån.
- Bygget får inte innehålla några hemligheter; nycklar ska ligga i servermiljön.

Den första versionen av webbplatsen är förberedd för Pages: `website/wrangler.toml`
anger byggkommando och utmapp, `website/public/_headers` sätter säkerhetsrubriker
och cachning, och bygget är helt statiskt. Att lägga upp den kräver en inloggning
till Cloudflare och ett godkännande – inget är uppladdat.

## 7. Beslut som måste fattas innan en gemensam databas eller inloggning

1. Ska konton och data delas mellan desktopappen och webbplatsen, eller är de två åtskilda miljöer?
2. Var ska kontona bo: en gemensam databas, eller synkronisering mellan två?
3. Hur skapas det första administratörskontot i en riktig installation? I dag krävs `LUMI_ADMIN_EMAIL` och `LUMI_ADMIN_PASSWORD`, annars går ingen att logga in med.
4. ~~Ska elevens studiematerial och resultat vara personliga per konto?~~ **Klart:** de är personliga per konto, med ägarfält satta av backend. Äldre poster utan ägare ligger bevarade i `*-aldre.json` och visas inte för någon – säg till om de ska knytas till ett konto i stället.
5. Ska eleven kunna logga in från webben, eller bara lärare och administratörer?
6. Vem betalar AI-anropen – skolan eller eleven?
7. Ska appen fungera offline med synk i efterhand, eller bara med nät?
8. Var får elevuppgifter lagras, och vad säger personuppgiftsreglerna om det?

## 8. Vad som återstår innan en .exe

- Första administratörskontot måste gå att skapa i en färdig installation.
- `.env` får inte följa med i paketet: nyckeln ska sättas i Windows miljövariabler eller i Credential Manager.
- Ikoner, versionsnummer, signering och hur uppdateringar ska nå ut.
- WebView2 finns i Windows 10 och 11, men kravet ska kontrolleras mot skolans datorer.
- Kvarvarande buggar ska vara åtgärdade och användarflödena testade i det riktiga appfönstret först. `.exe` byggs i ett senare steg, efter godkännande.
