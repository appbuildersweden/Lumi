//! All konfiguration av AI-kopplingen ligger här.
//!
//! Modellnamnen finns på exakt ett ställe i koden: konstanterna nedan. Allt
//! annat – kommandon, prompts och gränssnitt – hämtar dem härifrån, så att en
//! modell kan bytas utan att något annat behöver röras.

use serde::{Deserialize, Serialize};

/// Uppgifterna som Lumi använder AI till.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModelRole {
    /// Lärare-Chat: förklaringar, pedagogik och studiehjälp.
    Main,
    /// Plugga: quiz, flashcards, sammanfattningar, övningsprov och planer.
    Study,
    /// Korta och enkla uppgifter där en billigare modell räcker.
    Economy,
    /// Används bara enligt reglerna i [`crate::error::AppError::is_model_problem`].
    Backup,
}

impl ModelRole {
    pub fn model(self) -> &'static str {
        match self {
            ModelRole::Main => MAIN_MODEL,
            ModelRole::Study => STUDY_MODEL,
            ModelRole::Economy => ECONOMY_MODEL,
            ModelRole::Backup => BACKUP_MODEL,
        }
    }
}

// ── Modeller ──────────────────────────────────────────────────────────────
//
// Alla fyra är kontrollerade mot OpenRouters modellista och med riktiga anrop
// (svensk förklaring på ~120 ord, strömmat, samt ett strikt JSON-schema).
// Siffrorna i kommentarerna är uppmätta, inte hämtade från marknadsföring.
//
// Underkänt vid mätningen: `mistralai/mistral-large-4-0` gav tomt svar och
// ogiltig JSON efter 35 s. `openai/gpt-5.6-luna-pro` och
// `deepseek/deepseek-v4-flash-0731` hade 8–9 s till första token, vilket
// förstör upplevelsen i chatten trots lågt pris.

/// Huvudmodell. 1,67 s till första token, 236 tokens för 102 ord (effektivast
/// av de testade), korrekt svenska steg för steg med kontrollfråga.
/// $0,75/M in och $3,75/M ut – omkring $0,0009 per svar.
pub const MAIN_MODEL: &str = "google/gemini-3.8-flash";

/// Studiemodell. Samma modell som huvudmodellen: den gav giltig strikt JSON på
/// 8 s för $0,0029, och rollerna får dela modell för att slippa en integration
/// till.
pub const STUDY_MODEL: &str = MAIN_MODEL;

/// Ekonomisk modell. 1,31 s till första token, $0,00055 per svar och giltig
/// strukturerad JSON för $0,00035. $0,25/M in och $1,50/M ut.
pub const ECONOMY_MODEL: &str = "google/gemini-3.1-flash-lite";

/// Reservmodell. Bäst strukturerade svenska i mätningen och 1,13 s till första
/// token. Annan leverantör än huvudmodellen, vilket är hela poängen med en
/// reserv. Dyrare, och används därför bara vid modellfel.
pub const BACKUP_MODEL: &str = "anthropic/claude-sonnet-5.5";

/// Modellen som används när ingen roll anges.
pub const DEFAULT_MODEL: &str = MAIN_MODEL;

/// Modeller som erbjuds i Profil vid sidan av den valda.
pub const SUGGESTED_MODELS: &[&str] = &[MAIN_MODEL, ECONOMY_MODEL, BACKUP_MODEL];

// ── AI-tjänsten ───────────────────────────────────────────────────────────
//
// Appen anropar Lumis egen AI-tjänst i stället för OpenRouter direkt. Tjänsten
// ligger på Cloudflare och håller OpenRouters nyckel som en hemlighet på
// servern. Nyckeln finns alltså inte i appen, inte i installationsfilen och
// inte i det här repot – det är hela poängen med tjänsten.
//
// Markeringen nedan är inte en nyckel: den visar bara att anropet kommer från
// Lumis app, kan läsas ut av den som har appen och kan bytas genom att
// uppdatera hemligheten hos tjänsten och ge ut en ny version. Den riktiga
// hemligheten – OpenRouters nyckel – finns bara hos tjänsten.
//
// Källkoden ligger i `ai-proxy/`.

/// Adressen till AI-tjänsten. Kan bytas med `LUMI_AI_URL` under utveckling.
pub const GATEWAY_URL: &str = "https://lumi-ai.hoby123456-123.workers.dev";

/// Markeringen som skickas med varje anrop. Kan bytas med `LUMI_AI_TOKEN`.
pub const GATEWAY_TOKEN: &str = "5edef33fd70f6bd840730eb9ed173887389a38d6065224588e1b6827095118b7";

pub const GATEWAY_URL_ENV: &str = "LUMI_AI_URL";
pub const GATEWAY_TOKEN_ENV: &str = "LUMI_AI_TOKEN";

pub const CHAT_PATH: &str = "/v1/chat/completions";
pub const MODELS_PATH: &str = "/v1/models";
pub const STATUS_PATH: &str = "/v1/status";

/// Namnet appen uppger för tjänsten, som skickar det vidare till OpenRouter.
pub const APP_TITLE: &str = "Lumi";
pub const APP_REFERER: &str = "https://lumi.local";

pub const MAX_TOKENS_CHAT: u32 = 1_400;
pub const MAX_TOKENS_MATERIAL: u32 = 6_000;

/// Låg resonansnivå ger samma kvalitet till ungefär en fjärdedel av kostnaden.
/// Uppmätt: 0 resonemangstoken och $0,00077 per generering, mot $0,0030 utan
/// parametern. Parametern är också det som hindrar att hela tokenbudgeten går
/// åt till resonemang och lämnar svaret avhugget.
pub const REASONING_EFFORT: &str = "low";

/// Tidsgräns för ett enskilt anrop, från anslutning till sista byte.
pub const REQUEST_TIMEOUT_SECS: u64 = 180;

// ── Återförsök och kostnadskontroll ───────────────────────────────────────
//
// Reglerna finns i [`crate::error::AppError::is_transient`]: bara nätverksfel,
// hastighetsgränser och leverantörsfel (5xx) försöks igen. Nyckel-, kredit-,
// modell- och valideringsfel rapporteras direkt, eftersom ett nytt försök med
// samma indata ändå skulle ge samma svar och bara kosta pengar.

/// Antal extra försök efter det första. 2 ger som mest 3 anrop.
pub const MAX_RETRIES: u32 = 2;

/// Väntetid före första återförsöket. Fördubblas för varje försök.
pub const RETRY_BASE_DELAY_MS: u64 = 700;

// Reservmodellen får ta över högst en gång per förfrågan. Regeln uttrycks av
// att kommandona inte loopar kring reservanropet, till skillnad från
// `with_retry` som är byggd för att försöka flera gånger.


