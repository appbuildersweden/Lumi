# Lumis AI-tjänst

Appen anropar den här tjänsten i stället för OpenRouter direkt. Nyckeln till
OpenRouter ligger som en hemlighet här och följer aldrig med till appen, till
en installationsfil eller till repot. Det är hela poängen: en nyckel som ligger
i en app kan grävas fram av vem som helst som har appen.

```
appen (Rust)  ->  lumi-ai (Cloudflare Worker)  ->  OpenRouter
```

Adressen står i `src-tauri/src/config.rs` (`GATEWAY_URL`), och markeringen appen
visar upp i `GATEWAY_TOKEN`.

## Vad tjänsten gör

| Steg | Vad som händer |
| --- | --- |
| Grind | Anropet måste ha markeringen i `X-Lumi-Client`. Allt annat får 401. |
| Konto | Anrop som kostar pengar måste ha `X-Lumi-User` (ett hashat konto-id). |
| Tak | 30 frågor per konto och minut, 4 000 per dygn för hela tjänsten. |
| Innehåll | Bara modellerna i `ALLOWED_MODELS`, högst 256 kB och 200 meddelanden. |
| Vidare | Anropet skickas till OpenRouter med nyckeln pålagd. Svaret strömmas tillbaka oförändrat. |
| Reserv | Svarar OpenRouter 402, 403 eller 404 för modellen provas gratismodellerna i tur och ordning. Huvudet `X-Lumi-Fallback` talar om vilken som svarade. |

Varför just de gratismodellerna står i en kommentar i `src/index.js`. Kort:
`nvidia/nemotron-3-super-120b-a12b:free` svarade korrekt svenska på omkring två
sekunder och klarade både strömning och strikt JSON-schema vid mätning mot
kontot.

## Adresser

| Adress | Vem | Svar |
| --- | --- | --- |
| `GET /` | alla | `{"service":"lumi-ai","status":"ok"}` |
| `GET /v1/models` | appen | OpenRouters modellista (cachas en timme) |
| `GET /v1/status` | appen + konto | `creditsOk`, `creditsLeft`, `fallbackModels` |
| `POST /v1/chat/completions` | appen + konto | samma svar som OpenRouter, eller dess fel |

## Hemligheter

Två hemligheter sätts hos tjänsten – aldrig i `wrangler.toml` och aldrig i
chatten:

```bash
cd ai-proxy

# Nyckeln till OpenRouter. Hämtas ur .env i projektroten, som är gitignorerad.
grep -m1 '^OPENROUTER_API_KEY=' ../.env | cut -d= -f2- | tr -d '"' \
  | npx wrangler secret put OPENROUTER_API_KEY

# Markeringen appen skickar. Byt den genom att sätta en ny här och ge ut en
# ny version av appen med samma värde i config.rs.
npx wrangler secret put LUMI_CLIENT_TOKEN
```

`wrangler secret put` läser värdet från stdin och visar det inte. Klistra inte
in en nyckel som ett argument – kommandoraden sparas i skalets historik.

Markeringen är inte en hemlighet på samma sätt som nyckeln: den finns i appen
och kan läsas ut. Den är en grind mot slumpmässigt skrapande. Skyddet mot
missbruk består av grinden, modellistan, storleksgränserna och takten.

## Databasen

Räknarna för takten ligger i D1 (`DB`), en rad per konto och minut och en per
dygn. Skapa tabellen en gång:

```bash
npx wrangler d1 create lumi-ai-limits        # id:t skrivs in i wrangler.toml
npx wrangler d1 execute lumi-ai-limits --remote --file=schema.sql
```

Går databasen inte att läsa släpps anropet igenom och felet skrivs ut. En elev
ska inte bli utan AI för att en räknare krånglar; grinden, modellistan och
storleksgränserna skyddar fortfarande, och dygnstaket är det som skyddar saldot.

## Driftsätt och kontrollera

```bash
cd ai-proxy
node --test test/service.test.mjs   # testerna, utan nätverk och utan nyckel
npx wrangler deploy                 # driftsätt
```

Kontrollera efter en driftsättning att tjänsten svarar och att reservvägen
funkar:

```bash
URL=https://lumi-ai.<konto>.workers.dev
TOKEN=$(grep -m1 'GATEWAY_TOKEN' ../src-tauri/src/config.rs | sed 's/.*"\([^"]*\)".*/\1/')

curl -s "$URL/v1/status" -H "X-Lumi-Client: $TOKEN" -H "X-Lumi-User: prov"   # creditsOk
curl -s "$URL/v1/status"                                                      # ska ge 401
curl -sS -X POST "$URL/v1/chat/completions" \
  -H "X-Lumi-Client: $TOKEN" -H "X-Lumi-User: prov" -H 'Content-Type: application/json' \
  -d '{"model":"google/gemini-3.8-flash","max_tokens":300,"messages":[{"role":"user","content":"Hej"}]}' \
  -D - -o /dev/null | grep -i x-lumi                                           # reservmodellen
```

Från appen gör `cd src-tauri && cargo test --lib -- --ignored` samma sak genom
den riktiga klienten.
