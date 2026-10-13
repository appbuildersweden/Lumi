// Lumi – AI-tjänsten.
//
// Appen anropar den här tjänsten i stället för OpenRouter direkt. OpenRouters
// nyckel ligger som hemlighet hos tjänsten (`OPENROUTER_API_KEY`) och följer
// aldrig med till klienten, till en installationsfil eller till GitHub. Det är
// hela poängen med tjänsten: en nyckel som ligger i en app kan grävas fram av
// vem som helst som har appen.
//
// Tjänsten gör fyra saker:
//
//   1. Släpper bara in Lumis egen app (en delad klientmarkering) och bara
//      inloggade konton, enligt de huvuden appen skickar.
//   2. Begränsar hur ofta ett konto och tjänsten som helhet får anropa AI:n.
//   3. Vidarebefordrar anropet till OpenRouter med nyckeln pålagd, och strömmar
//      svaret tillbaka oförändrat.
//   4. Byter automatiskt till en gratismodell om kontot inte kan använda
//      betalmodellerna (HTTP 402), så att eleven ändå får ett svar.
//
// Klientmarkeringen är inte en hemlighet på samma sätt som nyckeln: den finns i
// appen och kan läsas ut. Den är en grind mot slumpmässigt skrapande och kan
// bytas genom att uppdatera hemligheten och appen. Skyddet mot missbruk består
// av grinden, modellistan, storleksgränserna och takten nedan.

const OPENROUTER = "https://openrouter.ai/api/v1";

// OpenRouter rekommenderar dessa huvuden så att anropet går att identifiera.
const APP_TITLE = "Lumi";
const APP_REFERER = "https://lumi.local";

// Modellerna appen får be om: samma fyra roller som `src-tauri/src/config.rs`.
// Allt utanför listan avvisas, så att en främmande klient inte kan använda
// tjänstens nyckel för vilken modell som helst.
const ALLOWED_MODELS = [
  "google/gemini-3.8-flash",
  "google/gemini-3.1-flash-lite",
  "anthropic/claude-sonnet-5.5",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
];

// Modellerna som tar över när kontot inte kan använda betalmodellerna.
//
// Uppmätt mot kontot: `nvidia/nemotron-3-super-120b-a12b:free` svarar korrekt
// svenska på omkring 2 s, klarar strikt JSON-schema och fungerar även strömmat.
// Reservmodellen nedanför används bara om den första inte svarar.
const FREE_FALLBACK_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
];

// Gränser för ett enskilt anrop. Ett chattanrop med 60 meddelanden och ett
// underlag ligger långt under det här.
const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 200;
const MAX_CONTENT_CHARS = 40_000;
const MAX_TOKENS_LIMIT = 8_000;

// Takten. Ett konto får skicka 30 frågor i minuten – en elev hinner inte i
// närheten, men en skenande klient stoppas. Det dagliga taket skyddar saldot om
// klientmarkeringen läcker ut.
const REQUESTS_PER_USER_PER_MINUTE = 30;
const REQUESTS_GLOBAL_PER_DAY = 4_000;

/** Ett litet fel i samma form som OpenRouters egna fel. */
function jsonError(status, message, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: { message, code: status } }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

/** Jämför två strängar utan att tiden avslöjar hur långt de stämmer. */
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length || a.length === 0) return false;

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** Sant när anropet kommer från Lumis app. */
function fromTheApp(request, env) {
  return sameSecret(request.headers.get("X-Lumi-Client") ?? "", env.LUMI_CLIENT_TOKEN ?? "");
}

/**
 * Räknar upp en räknare och svarar med det nya värdet.
 *
 * Räknarna ligger i D1 eftersom de måste gälla över hela tjänsten, inte bara i
 * den instans som råkade svara. Går databasen inte att läsa släpps anropet
 * igenom och felet skrivs ut: grinden, modellistan och storleksgränserna nedan
 * skyddar fortfarande, och en elev ska inte bli utan AI för att en räknare
 * krånglar. Det dagliga taket är det som skyddar saldot.
 */
async function countHit(env, scope, bucket) {
  if (!env.DB) return null;

  try {
    const row = await env.DB.prepare(
      "INSERT INTO hits (scope, bucket, count) VALUES (?, ?, 1) " +
        "ON CONFLICT (scope, bucket) DO UPDATE SET count = count + 1 " +
        "RETURNING count"
    )
      .bind(scope, bucket)
      .first();

    return row ? Number(row.count) : null;
  } catch (error) {
    console.error("lumi-ai: räknaren kunde inte uppdateras:", error?.message ?? error);
    return null;
  }
}

/** Kontot som anropet gäller. Krävs för allt som kostar pengar. */
function account(request) {
  const user = (request.headers.get("X-Lumi-User") ?? "").trim();
  if (!user || user.length > 128) return null;
  return user;
}

/** Dagens datum i UTC. Används som dygnsnyckel för det dagliga taket. */
function dayBucket() {
  return new Date().toISOString().slice(0, 10);
}

/** Minuten i UTC. Används som nyckel för takten per konto. */
function minuteBucket() {
  return String(Math.floor(Date.now() / 60_000));
}

/** Läser kroppen och kontrollerar att den är rimlig och ett chattanrop. */
async function readChatBody(request) {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    throw jsonError(413, "Förfrågan är för stor.");
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw jsonError(413, "Förfrågan är för stor.");
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw jsonError(400, "Förfrågan innehåller inte giltig JSON.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw jsonError(400, "Förfrågan innehåller inte ett chattanrop.");
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!ALLOWED_MODELS.includes(model)) {
    throw jsonError(400, "Modellen är inte tillåten i Lumi.");
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw jsonError(400, "Förfrågan saknar meddelanden.");
  }
  if (body.messages.length > MAX_MESSAGES) {
    throw jsonError(400, "Förfrågan innehåller för många meddelanden.");
  }

  for (const message of body.messages) {
    if (!message || typeof message.content !== "string") {
      throw jsonError(400, "Ett meddelande saknar innehåll.");
    }
    if (message.content.length > MAX_CONTENT_CHARS) {
      throw jsonError(413, "Ett meddelande är för långt.");
    }
    if (message.role !== "system" && message.role !== "user" && message.role !== "assistant") {
      throw jsonError(400, "Ett meddelande har en roll som inte finns.");
    }
  }

  if (body.max_tokens !== undefined) {
    const tokens = Number(body.max_tokens);
    if (!Number.isFinite(tokens) || tokens <= 0) {
      throw jsonError(400, "max_tokens måste vara ett positivt tal.");
    }
    body.max_tokens = Math.min(Math.floor(tokens), MAX_TOKENS_LIMIT);
  }

  return { body, model };
}

/** Skickar anropet vidare till OpenRouter med nyckeln pålagd. */
function askOpenRouter(env, body, model) {
  return fetch(`${OPENROUTER}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": APP_REFERER,
      "X-Title": APP_TITLE,
    },
    body: JSON.stringify({ ...body, model }),
  });
}

/**
 * Sant när felet beror på att modellen inte kan användas för det här kontot.
 * Då är en gratismodell värd ett försök. Ett fel i själva frågan (400), en
 * dålig nyckel (401) eller en trasig tjänst (5xx) skickas vidare som det är –
 * samma fråga skulle ge samma svar hos en annan modell.
 */
function worthAnotherModel(status) {
  return status === 402 || status === 403 || status === 404;
}

/**
 * Genomför ett chattanrop, med ett försök per gratismodell om kontot inte kan
 * använda betalmodellen.
 *
 * Returen är alltid ett svar till appen. Huvudet `X-Lumi-Fallback` talar om
 * vilken gratismodell som användes, så att gränssnittet kan berätta det för
 * eleven i stället för att svaret ser ut att komma från den valda modellen.
 */
async function completions(request, env) {
  if (!fromTheApp(request, env)) {
    return jsonError(401, "Anropet kommer inte från Lumi.");
  }

  const user = account(request);
  if (!user) {
    return jsonError(401, "Anropet saknar konto.");
  }

  let parsed;
  try {
    parsed = await readChatBody(request);
  } catch (response) {
    if (response instanceof Response) return response;
    throw response;
  }
  const { body, model } = parsed;

  const perUser = await countHit(env, `user:${user}`, minuteBucket());
  if (perUser !== null && perUser > REQUESTS_PER_USER_PER_MINUTE) {
    return jsonError(429, "För många anrop just nu. Vänta en liten stund och försök igen.");
  }

  const global = await countHit(env, "all", dayBucket());
  if (global !== null && global > REQUESTS_GLOBAL_PER_DAY) {
    return jsonError(429, "AI-tjänsten är upptagen just nu. Försök igen senare.");
  }

  let answer = await askOpenRouter(env, body, model);
  if (answer.ok) {
    return answer;
  }

  // Modellen kunde inte användas. Läs felet (det är en liten JSON) och försök
  // med gratismodellerna innan något skickas till appen. Något svar har inte
  // börjat strömmas ännu, så ett nytt försök kan göras utan att eleven ser
  // texten två gånger.
  let failure = { status: answer.status, text: await answer.text() };

  if (worthAnotherModel(answer.status) && !FREE_FALLBACK_MODELS.includes(model)) {
    for (const fallback of FREE_FALLBACK_MODELS) {
      const attempt = await askOpenRouter(env, body, fallback);
      if (attempt.ok) {
        console.log(`lumi-ai: ${model} gick inte (${answer.status}); använder ${fallback}.`);
        return withHeaders(attempt, { "X-Lumi-Fallback": fallback, "X-Lumi-Model": fallback });
      }

      failure = { status: attempt.status, text: await attempt.text() };
      if (!worthAnotherModel(attempt.status)) break;
    }
  }

  return new Response(failure.text, {
    status: failure.status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Lägger till huvuden på ett strömmande svar utan att röra kroppen. */
function withHeaders(response, extra) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

/** Aktuell modellista. Går att läsa utan konto: den rör ingen nyckel. */
async function models(request, env, ctx) {
  if (!fromTheApp(request, env)) {
    return jsonError(401, "Anropet kommer inte från Lumi.");
  }

  const cached = await caches.default.match(request);
  if (cached) return cached;

  const answer = await fetch(`${OPENROUTER}/models`);
  if (!answer.ok) {
    return jsonError(502, "Modellistan kunde inte hämtas.");
  }

  const response = new Response(await answer.text(), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });

  ctx.waitUntil(caches.default.put(request, response.clone()));
  return response;
}

/**
 * Kontots läge hos OpenRouter: hur mycket som är spenderat och om det finns
 * krediter kvar för betalmodellerna.
 *
 * Appen frågar efter det här för att kunna berätta för eleven att svaren just
 * nu kommer från en gratismodell – inte för att kunna räkna ut något om nyckeln.
 */
async function status(request, env) {
  if (!fromTheApp(request, env)) {
    return jsonError(401, "Anropet kommer inte från Lumi.");
  }
  if (!account(request)) {
    return jsonError(401, "Anropet saknar konto.");
  }

  const answer = await fetch(`${OPENROUTER}/credits`, {
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": APP_REFERER,
      "X-Title": APP_TITLE,
    },
  });

  if (!answer.ok) {
    return jsonError(502, "Kontots läge kunde inte hämtas.");
  }

  const body = await answer.json().catch(() => ({}));
  const data = body?.data ?? {};
  const total = Number(data.total_credits ?? 0);
  const used = Number(data.total_usage ?? 0);

  return new Response(
    JSON.stringify({
      creditsOk: total - used > 0,
      creditsLeft: Math.max(0, total - used),
      // Reservmodellerna i den ordning de försöks.
      fallbackModels: FREE_FALLBACK_MODELS,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    }
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;

    try {
      if (route === "GET /") {
        return new Response(JSON.stringify({ service: "lumi-ai", status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }
      if (route === "GET /v1/models") return await models(request, env, ctx);
      if (route === "GET /v1/status") return await status(request, env);
      if (route === "POST /v1/chat/completions") return await completions(request, env);

      return jsonError(404, "Adressen finns inte i AI-tjänsten.");
    } catch (error) {
      console.error("lumi-ai:", error?.stack ?? error);
      return jsonError(502, "AI-tjänsten kunde inte nås just nu. Försök igen.");
    }
  },
};
