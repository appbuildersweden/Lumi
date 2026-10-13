// Tester för AI-tjänsten.
//
// De kör mot den riktiga koden i `src/index.js` med nätverket utbytt mot en
// attrapp. Inga anrop går till OpenRouter och ingen nyckel behövs: attrappen
// svarar i stället, så att både 402, 5xx, taktgränser och strömning kan provas
// utan att kosta något.
//
//   node --test ai-proxy/test

import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/index.js";

const CLIENT_TOKEN = "markering-for-test";

/** En D1-attrapp med samma yta som den riktiga räknaren använder. */
function fakeDb() {
  const counts = new Map();

  return {
    prepare(sql) {
      assert.match(sql, /INSERT INTO hits/);
      return {
        bind(scope, bucket) {
          return {
            async first() {
              const key = `${scope}:${bucket}`;
              const next = (counts.get(key) ?? 0) + 1;
              counts.set(key, next);
              return { count: next };
            },
          };
        },
      };
    },
  };
}

function env(overrides = {}) {
  return {
    OPENROUTER_API_KEY: "sk-or-v1-hemlig",
    LUMI_CLIENT_TOKEN: CLIENT_TOKEN,
    DB: fakeDb(),
    ...overrides,
  };
}

/** Ett svar som attrappen lämnar tillbaka för ett visst modellnamn. */
function upstreamBody(model) {
  return {
    id: "gen-1",
    model,
    choices: [{ message: { role: "assistant", content: "Hej!" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0 },
  };
}

/**
 * Byter ut nätverket. `handler` får adressen och anropet och svarar med ett
 * `Response`. Alla anrop loggas, så att testet kan kontrollera vilken modell
 * tjänsten faktiskt frågade efter.
 */
function stubNetwork(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const address = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ address, body, headers: init.headers ?? {} });
    return handler(address, init, body);
  };
  return calls;
}

/** Svarar 200 för allt utom de modeller som listas i `failing`. */
function upstreamThatFailsFor(failing) {
  return (address, init, body) => {
    if (address.endsWith("/credits")) {
      return new Response(JSON.stringify({ data: { total_credits: 0, total_usage: 0 } }), {
        status: 200,
      });
    }

    const model = body?.model ?? "";
    if (failing[model]) {
      const { status, message } = failing[model];
      return new Response(JSON.stringify({ error: { message, code: status } }), { status });
    }

    return new Response(JSON.stringify(upstreamBody(model)), { status: 200 });
  };
}

function chatRequest(body, { user = "konto-1", token = CLIENT_TOKEN } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token !== null) headers["X-Lumi-Client"] = token;
  if (user !== null) headers["X-Lumi-User"] = user;

  return new Request("https://ai.example/v1/chat/completions", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(path, { user = "konto-1", token = CLIENT_TOKEN } = {}) {
  const headers = {};
  if (token !== null) headers["X-Lumi-Client"] = token;
  if (user !== null) headers["X-Lumi-User"] = user;
  return new Request(`https://ai.example${path}`, { headers });
}

const CHAT = {
  model: "google/gemini-3.8-flash",
  max_tokens: 100,
  messages: [{ role: "user", content: "Varför är himlen blå?" }],
};

// caches.default finns inte i Node. Tjänsten använder den bara för modellistan.
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

// -- Grinden --------------------------------------------------------------

test("en förfrågan utan klientmarkering avvisas", async () => {
  stubNetwork(upstreamThatFailsFor({}));

  const response = await worker.fetch(chatRequest(CHAT, { token: null }), env(), {});
  assert.equal(response.status, 401);

  const body = await response.json();
  assert.match(body.error.message, /Lumi/);
});

test("en förfrågan med fel klientmarkering avvisas", async () => {
  stubNetwork(upstreamThatFailsFor({}));

  const response = await worker.fetch(chatRequest(CHAT, { token: "fel" }), env(), {});
  assert.equal(response.status, 401);
});

test("en förfrågan utan konto avvisas", async () => {
  stubNetwork(upstreamThatFailsFor({}));

  const response = await worker.fetch(chatRequest(CHAT, { user: null }), env(), {});
  assert.equal(response.status, 401);
  assert.match((await response.json()).error.message, /konto/);
});

test("klientmarkeringen jämförs i sin helhet", async () => {
  stubNetwork(upstreamThatFailsFor({}));

  // En markering som är ett prefix av den riktiga ska inte släppas in.
  const response = await worker.fetch(
    chatRequest(CHAT, { token: CLIENT_TOKEN.slice(0, 4) }),
    env(),
    {}
  );
  assert.equal(response.status, 401);
});

// -- Innehåll -------------------------------------------------------------

test("en modell utanför listan avvisas", async () => {
  const calls = stubNetwork(upstreamThatFailsFor({}));

  const response = await worker.fetch(
    chatRequest({ ...CHAT, model: "openai/gpt-5.6-luna-pro" }),
    env(),
    {}
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /tillåten/);
  assert.equal(calls.length, 0, "inget anrop ska ha gått till OpenRouter");
});

test("en kropp som inte är JSON avvisas", async () => {
  stubNetwork(upstreamThatFailsFor({}));

  const response = await worker.fetch(chatRequest("{ inte json", {}), env(), {});
  assert.equal(response.status, 400);
});

test("ett för stort anrop avvisas", async () => {
  stubNetwork(upstreamThatFailsFor({}));

  const response = await worker.fetch(
    chatRequest({
      ...CHAT,
      messages: [{ role: "user", content: "a".repeat(40_001) }],
    }),
    env(),
    {}
  );

  assert.equal(response.status, 413);
});

test("en roll som inte finns avvisas", async () => {
  stubNetwork(upstreamThatFailsFor({}));

  const response = await worker.fetch(
    chatRequest({ ...CHAT, messages: [{ role: "elev", content: "Hej" }] }),
    env(),
    {}
  );

  assert.equal(response.status, 400);
});

test("max_tokens kapas till tjänstens tak", async () => {
  const calls = stubNetwork(upstreamThatFailsFor({}));

  const response = await worker.fetch(
    chatRequest({ ...CHAT, model: "google/gemini-3.1-flash-lite", max_tokens: 999_999 }),
    env(),
    {}
  );

  assert.equal(response.status, 200);
  assert.equal(calls.at(-1).body.max_tokens, 8_000);
});

// -- Vidarebefordran ------------------------------------------------------

test("ett lyckat anrop går vidare och svaret kommer tillbaka", async () => {
  const calls = stubNetwork(upstreamThatFailsFor({}));

  const response = await worker.fetch(chatRequest(CHAT), env(), {});
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.choices[0].message.content, "Hej!");
  assert.equal(body.model, CHAT.model);

  // Nyckeln läggs på hos tjänsten och finns inte i det appen skickade.
  const sent = calls.at(-1);
  assert.equal(sent.headers.Authorization, "Bearer sk-or-v1-hemlig");
  assert.equal(sent.address, "https://openrouter.ai/api/v1/chat/completions");
});

test("ett fel som inte beror på modellen skickas vidare oförändrat", async () => {
  const calls = stubNetwork((address, init, body) => {
    if (body?.model === CHAT.model) {
      return new Response(JSON.stringify({ error: { message: "Nyckeln är ogiltig", code: 401 } }), {
        status: 401,
      });
    }
    return new Response(JSON.stringify(upstreamBody(body?.model)), { status: 200 });
  });

  const response = await worker.fetch(chatRequest(CHAT), env(), {});

  assert.equal(response.status, 401);
  assert.match((await response.json()).error.message, /ogiltig/);
  assert.equal(calls.length, 1, "ett nyckelfel ska inte försökas igen med en annan modell");
});

test("ett serverfel skickas vidare utan att byta modell", async () => {
  const calls = stubNetwork((address, init, body) => {
    if (body?.model === CHAT.model) {
      return new Response(JSON.stringify({ error: { message: "bad gateway", code: 502 } }), {
        status: 502,
      });
    }
    return new Response(JSON.stringify(upstreamBody(body?.model)), { status: 200 });
  });

  const response = await worker.fetch(chatRequest(CHAT), env(), {});
  assert.equal(response.status, 502);
  assert.equal(calls.length, 1);
});

// -- Reservmodellen -------------------------------------------------------

test("utan krediter svarar tjänsten med gratismodellen", async () => {
  const calls = stubNetwork(
    upstreamThatFailsFor({
      "google/gemini-3.8-flash": {
        status: 402,
        message: "Insufficient credits. This account never purchased credits.",
      },
    })
  );

  const response = await worker.fetch(chatRequest(CHAT), env(), {});

  assert.equal(response.status, 200, "eleven ska få ett svar");
  assert.equal(response.headers.get("X-Lumi-Fallback"), "nvidia/nemotron-3-super-120b-a12b:free");

  const body = await response.json();
  assert.equal(body.model, "nvidia/nemotron-3-super-120b-a12b:free");

  // Först den begärda modellen, sedan gratismodellen.
  assert.equal(calls[0].body.model, "google/gemini-3.8-flash");
  assert.equal(calls[1].body.model, "nvidia/nemotron-3-super-120b-a12b:free");
});

test("reservmodellen används bara när modellen inte kan användas", async () => {
  const calls = stubNetwork(
    upstreamThatFailsFor({
      "google/gemini-3.8-flash": { status: 400, message: "Frågan är felaktig" },
    })
  );

  const response = await worker.fetch(chatRequest(CHAT), env(), {});
  assert.equal(response.status, 400);
  assert.equal(calls.length, 1);
});

test("om ingen gratismodell svarar får appen det sista felet", async () => {
  stubNetwork(
    upstreamThatFailsFor({
      "google/gemini-3.8-flash": { status: 402, message: "Insufficient credits." },
      "nvidia/nemotron-3-super-120b-a12b:free": { status: 402, message: "Insufficient credits." },
      "nvidia/nemotron-3-ultra-550b-a55b:free": { status: 429, message: "Rate limited" },
    })
  );

  const response = await worker.fetch(chatRequest(CHAT), env(), {});
  assert.equal(response.status, 429);
  assert.match((await response.json()).error.message, /Rate limited/);
});

test("ett strömmande svar skickas vidare med reservmarkeringen", async () => {
  stubNetwork((address, init, body) => {
    if (body?.model === CHAT.model) {
      return new Response(JSON.stringify({ error: { message: "Insufficient credits.", code: 402 } }), {
        status: 402,
      });
    }

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  });

  const response = await worker.fetch(chatRequest({ ...CHAT, stream: true }), env(), {});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  assert.equal(response.headers.get("X-Lumi-Fallback"), "nvidia/nemotron-3-super-120b-a12b:free");
  assert.match(await response.text(), /\[DONE\]/);
});

// -- Takten ---------------------------------------------------------------

test("takten per konto stoppar en skenande klient", async () => {
  stubNetwork(upstreamThatFailsFor({}));

  // Samma räknare genom hela loopen, som i den riktiga tjänsten.
  const shared = env();
  let last = null;
  for (let index = 0; index < 31; index += 1) {
    last = await worker.fetch(chatRequest(CHAT, { user: "konto-2" }), shared, {});
  }

  assert.equal(last.status, 429);
  assert.match((await last.json()).error.message, /För många anrop/);
});

// -- Modeller och kontoläge ----------------------------------------------

test("modellistan kräver klientmarkeringen och cachelagras", async () => {
  let put = 0;
  globalThis.caches = { default: { match: async () => undefined, put: async () => { put += 1; } } };

  stubNetwork((address) => {
    assert.equal(address, "https://openrouter.ai/api/v1/models");
    return new Response(JSON.stringify({ data: [{ id: "google/gemini-3.8-flash" }] }), {
      status: 200,
    });
  });

  const denied = await worker.fetch(get("/v1/models", { token: null }), env(), {});
  assert.equal(denied.status, 401);

  const allowed = await worker.fetch(get("/v1/models"), env(), { waitUntil: () => {} });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).data.length, 1);
  assert.equal(put, 1, "svaret ska läggas i cachen");

  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
});

test("kontots läge visar att krediten är slut", async () => {
  stubNetwork(upstreamThatFailsFor({}));

  const response = await worker.fetch(get("/v1/status"), env(), {});
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.creditsOk, false);
  assert.deepEqual(body.fallbackModels, [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
  ]);
});

test("kontots läge visar att krediten räcker", async () => {
  stubNetwork((address) =>
    new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 2.5 } }), { status: 200 })
  );

  const body = await (await worker.fetch(get("/v1/status"), env(), {})).json();
  assert.equal(body.creditsOk, true);
  assert.equal(body.creditsLeft, 7.5);
});

test("hälsoadressen svarar utan nyckel och utan markering", async () => {
  const response = await worker.fetch(new Request("https://ai.example/"), env(), {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service, "lumi-ai");
});

test("okända adresser ger ett tydligt fel", async () => {
  const response = await worker.fetch(get("/v1/hemlig"), env(), {});
  assert.equal(response.status, 404);
  assert.match((await response.json()).error.message, /finns inte/);
});
