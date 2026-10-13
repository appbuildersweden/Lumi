# Lumi – vägen till webbplats och .exe

Det här dokumentet beskriver vad som redan går att återanvända och vad som måste
bestämmas innan Lumi finns som webbplats eller som färdig Windows-app.

**Inget i det här dokumentet är byggt.** Ingen webbplats är publicerad, ingen
extern tjänst är inkopplad och ingen `.exe` är skapad. Lagring och inloggning
ligger kvar precis som de är tills en migreringsplan har godkänts.

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

I dag:

- Nyckeln läses bara i Rust: Windows Credential Manager, annars miljövariabeln `OPENROUTER_API_KEY`, och `.env` i utvecklingsläge.
- Nyckeln skickas bara till OpenRouter. Gränssnittet får status (`ai_status`) och förbrukning (`check_api_key`) – aldrig nyckeln.
- Alla AI-anrop (`chat_stream`, `generate_material`, `check_api_key`, `list_models`) kräver en inloggad användare.
- Vid modellfel byter chatten till en reservmodell; vid nätverks-, kredit- eller nyckelfel avbryts i stället för att försöka dyrare.

På webben:

- Nyckeln får aldrig ligga i klientkoden eller i ett bygge. Anropet måste gå via servern, precis som i appen.
- Servern behöver ett skydd mot att en inloggad användare kan bränna obegränsat med pengar (tak per användare eller per dag).
- Beslut: en gemensam nyckel för installationen, eller en nyckel per skola/användare? Om servern betalar behöver förbrukningen loggas per användare.

## 6. Cloudflare Pages specifikt

Cloudflare Pages hostar statiska filer och kan köra serverkod, men **varken
databas, inloggning eller AI följer med automatiskt**. Alla tre måste väljas och
kopplas separat, och inget av dem är valt här.

Det som kräver anpassning om vi väljer Pages:

- SPA-fallback: alla rutter måste falla tillbaka på `index.html`.
- API-bas-URL i produktion, och en CSP som passar appen.
- Sessionscookies över domänen, samt regler för vilka anrop som får komma från varifrån.
- Bygget får inte innehålla några hemligheter; nycklar ska ligga i servermiljön.

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
