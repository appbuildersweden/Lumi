//! Klient mot Lumis AI-tjänst.
//!
//! Tjänsten talar samma språk som OpenRouter – samma anrop, samma svar och
//! samma felformat – men håller OpenRouters nyckel på servern. Den här modulen
//! ser därför aldrig någon nyckel, och ingenting i appen kan läsa ut en.
//!
//! Modulen känner inte till Tauri. Det gör att den kan testas direkt mot den
//! riktiga tjänsten utan att starta ett appfönster.

use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::config;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".to_string(),
            content: content.into(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: content.into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatUsage {
    pub model: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    /// OpenRouter rapporterar kostnaden i USD per anrop.
    pub cost: Option<f64>,
    /// Sant när modellen nådde sin tokenbudget innan den var klar. Gränssnittet
    /// visar då en tydlig varning i stället för att låta svaret se färdigt ut.
    pub truncated: bool,
    /// Satt när svaret kommer från en gratismodell i stället för den valda
    /// modellen, eftersom kontot inte kan använda betalmodellerna just nu.
    /// Gränssnittet berättar det för eleven.
    pub fallback: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub context_length: u64,
    pub prompt_price: f64,
    pub completion_price: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    /// Sant när kontot kan använda betalmodellerna.
    pub credits_ok: bool,
    /// Kvarvarande krediter i USD, enligt tjänstens svar.
    pub credits_left: f64,
    /// Modellerna som används i stället när betalmodellerna inte kan användas.
    pub fallback_models: Vec<String>,
}

/// Ett kort och stabilt id för ett konto.
///
/// Tjänstens räknare behöver kunna skilja konton åt, men har ingen nytta av
/// kontots id i klartext. FNV-1a valdes för att den är beroende av varken
/// tidszon, slump eller Rust-version: samma konto ger alltid samma id.
#[must_use]
pub fn account_id(user_id: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in user_id.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[derive(Clone)]
pub struct OpenRouterClient {
    http: reqwest::Client,
    /// Adressen till AI-tjänsten. Tom om appen byggts utan en.
    base_url: String,
    /// Markeringen som visar att anropet kommer från Lumis app. Inte en nyckel:
    /// den kan läsas ut ur appen och byts genom att uppdatera tjänsten.
    token: String,
    /// Kontot anropet görs för, hashat. Sätts med [`Self::for_account`].
    account: Option<String>,
}

/// Kör ett anrop och gör ett begränsat antal nya försök vid tillfälliga fel.
///
/// Bara fel som [`AppError::is_transient`] säger ja till försöks igen, och
/// antalet försök och väntetiden bestäms i [`crate::config`].
async fn with_retry<T, F, Fut>(mut run: F) -> Result<T, AppError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, AppError>>,
{
    let mut attempt: u32 = 0;

    loop {
        match run().await {
            Ok(value) => return Ok(value),
            Err(error) => {
                if attempt >= config::MAX_RETRIES || !error.is_transient() {
                    return Err(error);
                }

                let delay = config::RETRY_BASE_DELAY_MS * 2u64.pow(attempt);
                tokio::time::sleep(Duration::from_millis(delay)).await;
                attempt += 1;
            }
        }
    }
}

impl OpenRouterClient {
    /// Klient mot tjänsten på `base_url`, med markeringen `token`.
    pub fn new(base_url: &str, token: &str) -> Result<Self, AppError> {
        let http = reqwest::Client::builder()
            .user_agent(format!("{}/{}", config::APP_TITLE, env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(config::REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|err| AppError::Network(err.to_string()))?;

        Ok(Self {
            http,
            base_url: base_url.trim().trim_end_matches('/').to_string(),
            token: token.trim().to_string(),
            account: None,
        })
    }

    /// Klienten för ett konto.
    ///
    /// Tjänsten räknar anrop per konto. Allt som kostar pengar måste därför
    /// tala om vem som gör anropet – annars avvisas det av [`Self::authorized`].
    #[must_use]
    pub fn for_account(&self, user_id: &str) -> Self {
        let mut client = self.clone();
        client.account = Some(account_id(user_id));
        client
    }

    /// Sant när appen har en tjänst att anropa.
    #[must_use]
    pub fn is_configured(&self) -> bool {
        !self.base_url.is_empty() && !self.token.is_empty()
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// Lägger på markeringen och kontot. Kräver en inloggad användare: ett
    /// anrop utan konto skulle varken gå att begränsa eller följa upp.
    fn authorized(&self, request: reqwest::RequestBuilder) -> Result<reqwest::RequestBuilder, AppError> {
        if !self.is_configured() {
            return Err(AppError::MissingApiKey);
        }

        let account = self.account.as_deref().ok_or(AppError::NotSignedIn)?;

        Ok(request
            .header("X-Lumi-Client", &self.token)
            .header("X-Lumi-User", account)
            .header("HTTP-Referer", config::APP_REFERER)
            .header("X-Title", config::APP_TITLE))
    }

    /// Gör om ett felsvar till ett läsbart fel. Läser OpenRouters felformat
    /// `{"error": {"message": ..., "code": ...}}`.
    /// Tar bort markeringen ur en text. Anropas på allt som kommer från servern
    /// innan det får bli ett felmeddelande, så att ingenting som hör till
    /// anropet kan följa med ut i gränssnittet eller i en loggrad.
    fn redact(&self, text: &str) -> String {
        let redacted = if self.token.is_empty() {
            text.to_string()
        } else {
            text.replace(&self.token, "[markeringen borttagen]")
        };

        // Ett mycket långt svar från servern hjälper ingen elev.
        redacted.chars().take(300).collect()
    }

    async fn error_from_response(&self, response: reqwest::Response) -> AppError {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();

        let message = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| {
                let trimmed = body.trim();
                if trimmed.is_empty() {
                    "inget svar från servern".to_string()
                } else {
                    trimmed.chars().take(200).collect()
                }
            });

        let message = self.redact(&message);

        match status {
            401 => AppError::Unauthorized,
            402 => AppError::InsufficientCredits,
            429 => AppError::RateLimited,
            400 | 404 if message.to_lowercase().contains("model") => AppError::Model(message),
            _ => AppError::Api { status, message },
        }
    }

    fn apply_usage(usage: &mut ChatUsage, value: &Value) {
        if let Some(model) = value.get("model").and_then(Value::as_str) {
            usage.model = model.to_string();
        }
        if let Some(details) = value.get("usage") {
            if let Some(tokens) = details.get("prompt_tokens").and_then(Value::as_u64) {
                usage.prompt_tokens = tokens as u32;
            }
            if let Some(tokens) = details.get("completion_tokens").and_then(Value::as_u64) {
                usage.completion_tokens = tokens as u32;
            }
            usage.cost = details.get("cost").and_then(Value::as_f64);
        }
    }

    /// Hämtar aktuell modellista. Listan rör ingen nyckel, men anropet måste
    /// ändå komma från Lumis app.
    pub async fn list_models(&self) -> Result<Vec<ModelInfo>, AppError> {
        if !self.is_configured() {
            return Err(AppError::MissingApiKey);
        }

        let response = self
            .http
            .get(self.endpoint(config::MODELS_PATH))
            .header("X-Lumi-Client", &self.token)
            .header("HTTP-Referer", config::APP_REFERER)
            .header("X-Title", config::APP_TITLE)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(self.error_from_response(response).await);
        }

        let body: Value = response.json().await?;
        let models = body
            .get("data")
            .and_then(Value::as_array)
            .ok_or(AppError::UnreadableResponse)?;

        Ok(models
            .iter()
            .filter_map(|model| {
                let id = model.get("id").and_then(Value::as_str)?;
                Some(ModelInfo {
                    id: id.to_string(),
                    name: model
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or(id)
                        .to_string(),
                    context_length: model
                        .get("context_length")
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                    prompt_price: model
                        .pointer("/pricing/prompt")
                        .and_then(Value::as_str)
                        .and_then(|price| price.parse::<f64>().ok())
                        .unwrap_or(0.0),
                    completion_price: model
                        .pointer("/pricing/completion")
                        .and_then(Value::as_str)
                        .and_then(|price| price.parse::<f64>().ok())
                        .unwrap_or(0.0),
                })
            })
            .collect())
    }

    /// Hämtar tjänstens läge: om kontot kan använda betalmodellerna och vilka
    /// gratismodeller som tar över när det inte kan. Anropet är kostnadsfritt,
    /// till skillnad från ett chattanrop.
    pub async fn service_status(&self) -> Result<ServiceStatus, AppError> {
        let response = self
            .authorized(self.http.get(self.endpoint(config::STATUS_PATH)))?
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(self.error_from_response(response).await);
        }

        let body: Value = response.json().await?;

        // Svaret innehåller bara kontots läge. Ingen del av nyckeln finns i det,
        // och tjänsten skickar aldrig vidare någon.
        Ok(ServiceStatus {
            credits_ok: body
                .get("creditsOk")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            credits_left: body
                .get("creditsLeft")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            fallback_models: body
                .get("fallbackModels")
                .and_then(Value::as_array)
                .map(|models| {
                    models
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
        })
    }

    /// Strömmar ett chatt-svar. `on_delta` anropas med varje textbit i den
    /// ordning den kommer, så att eleven ser texten medan den skrivs.
    pub async fn stream_chat<F>(
        &self,
        messages: &[ChatMessage],
        model: &str,
        max_tokens: u32,
        mut on_delta: F,
    ) -> Result<ChatUsage, AppError>
    where
        F: FnMut(&str),
    {
        let body = json!({
            "model": model,
            "stream": true,
            "max_tokens": max_tokens,
            "reasoning": { "effort": config::REASONING_EFFORT },
            "messages": messages,
        });

        // Anslutningen öppnas med återförsök. Så snart text har skickats till
        // gränssnittet går det inte att börja om, för då skulle eleven se samma
        // stycke två gånger. Ett avbrott mitt i strömmen rapporteras därför i
        // stället för att försökas igen.
        let response = with_retry(|| async {
            let response = self
                .authorized(self.http.post(self.endpoint(config::CHAT_PATH)))?
                .json(&body)
                .send()
                .await?;

            if !response.status().is_success() {
                return Err(self.error_from_response(response).await);
            }

            Ok(response)
        })
        .await?;

        // Tjänsten berättar i ett huvud om svaret kommer från en gratismodell.
        // Huvudet finns innan texten börjar strömma, så eleven kan få veta det
        // redan medan svaret skrivs.
        let fallback = response
            .headers()
            .get("X-Lumi-Fallback")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        let mut usage = ChatUsage {
            model: model.to_string(),
            fallback,
            ..Default::default()
        };

        // Bufferten hålls som bytes och delas på radbrytning. Att avkoda varje
        // chunk för sig skulle kunna klippa sönder å, ä och ö mitt i ett tecken.
        let mut buffer: Vec<u8> = Vec::new();
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            buffer.extend_from_slice(&chunk);

            while let Some(position) = buffer.iter().position(|byte| *byte == b'\n') {
                let line: Vec<u8> = buffer.drain(..=position).collect();
                let line = String::from_utf8_lossy(&line);
                let line = line.trim_end_matches(['\r', '\n']);

                let Some(data) = line.strip_prefix("data:") else {
                    // Raden är en kommentar eller en tom hållare.
                    continue;
                };
                let data = data.trim();
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }

                let Ok(event) = serde_json::from_str::<Value>(data) else {
                    continue;
                };

                if let Some(error) = event.get("error") {
                    let message = error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("okänt fel från OpenRouter")
                        .to_string();
                    let code = error.get("code").and_then(Value::as_u64).unwrap_or(0) as u16;
                    return Err(match code {
                        401 => AppError::Unauthorized,
                        402 => AppError::InsufficientCredits,
                        429 => AppError::RateLimited,
                        _ => AppError::Api {
                            status: code,
                            message,
                        },
                    });
                }

                Self::apply_usage(&mut usage, &event);

                // Modellen kan ha nått sin tokenbudget. Det upptäcktes vid
                // mätning: utan resonemangsparametern gick nästan hela budgeten
                // åt till resonemang och svaret kapades mitt i en mening. Utan
                // den här kontrollen skulle ett avhugget svar se färdigt ut.
                if event
                    .pointer("/choices/0/finish_reason")
                    .and_then(Value::as_str)
                    == Some("length")
                {
                    usage.truncated = true;
                }

                if let Some(text) = event
                    .pointer("/choices/0/delta/content")
                    .and_then(Value::as_str)
                {
                    if !text.is_empty() {
                        on_delta(text);
                    }
                }
            }
        }

        Ok(usage)
    }

    /// Hämtar ett komplett svar som följer ett givet JSON-schema.
    /// Används när Lumi ska skapa studiematerial som går att spara och validera.
    pub async fn chat_json(
        &self,
        messages: &[ChatMessage],
        model: &str,
        schema_name: &str,
        schema: Value,
    ) -> Result<(Value, ChatUsage), AppError> {
        let body = json!({
            "model": model,
            "max_tokens": config::MAX_TOKENS_MATERIAL,
            "reasoning": { "effort": config::REASONING_EFFORT },
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": { "name": schema_name, "strict": true, "schema": schema },
            },
        });

        // Här finns ingen text att visa medan den skrivs, så hela anropet kan
        // göras om vid ett tillfälligt fel utan att eleven märker något.
        let response = with_retry(|| async {
            let response = self
                .authorized(self.http.post(self.endpoint(config::CHAT_PATH)))?
                .json(&body)
                .send()
                .await?;

            if !response.status().is_success() {
                return Err(self.error_from_response(response).await);
            }

            Ok(response)
        })
        .await?;

        let fallback = response
            .headers()
            .get("X-Lumi-Fallback")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        let mut usage = ChatUsage {
            model: model.to_string(),
            fallback,
            ..Default::default()
        };

        let body: Value = response.json().await?;
        Self::apply_usage(&mut usage, &body);

        let choice = body
            .pointer("/choices/0")
            .ok_or(AppError::UnreadableResponse)?;

        if choice.get("finish_reason").and_then(Value::as_str) == Some("length") {
            return Err(AppError::Validation(
                "svaret blev för långt och kapades. Prova med färre frågor.".to_string(),
            ));
        }

        let content = choice
            .pointer("/message/content")
            .and_then(Value::as_str)
            .ok_or(AppError::UnreadableResponse)?;

        let parsed: Value =
            serde_json::from_str(content).map_err(|_| AppError::UnreadableResponse)?;

        Ok((parsed, usage))
    }
}

#[cfg(test)]
mod tests {
    use super::{ChatMessage, ChatUsage, OpenRouterClient, ServiceStatus, account_id, with_retry};
    use crate::config;
    use crate::error::AppError;
    use crate::materials::{self, GenerateRequest};

    /// En markering som bara finns i testerna. Den riktiga står i
    /// `config::GATEWAY_TOKEN`.
    const TEST_TOKEN: &str = "markering-for-test";

    /// Klient mot den riktiga AI-tjänsten, för de tester som gör anrop.
    ///
    /// Ingen nyckel behövs lokalt: nyckeln ligger hos tjänsten. Testerna är
    /// märkta `#[ignore]` så att `cargo test` visar dem som överhoppade i
    /// stället för att låtsas att de har körts.
    ///
    /// Kör dem med: `cargo test -- --ignored`.
    fn live_client() -> OpenRouterClient {
        for candidate in ["../.env", ".env"] {
            let _ = dotenvy::from_filename(candidate);
        }

        let (url, token, _) = crate::commands::gateway_config();
        let client = OpenRouterClient::new(&url, &token).expect("kunde inte skapa klienten");
        assert!(client.is_configured(), "ingen AI-tjänst är konfigurerad");

        // Tjänsten räknar anrop per konto, precis som appen gör.
        client.for_account("lumi-live-test")
    }

    // -- Utan nätverk -----------------------------------------------------

    #[test]
    fn the_marking_is_removed_from_error_text() {
        let client = OpenRouterClient::new(config::GATEWAY_URL, TEST_TOKEN).unwrap();

        let redacted = client.redact(&format!("Tjänsten svarade: markeringen {TEST_TOKEN} är fel"));

        assert!(!redacted.contains(TEST_TOKEN));
        assert!(redacted.contains("[markeringen borttagen]"));
    }

    #[test]
    fn an_account_id_is_stable_and_does_not_reveal_the_account() {
        // Samma konto ska alltid ge samma id – annars skulle takten räknas per
        // anrop i stället för per konto.
        assert_eq!(account_id("konto-1"), account_id("konto-1"));
        assert_ne!(account_id("konto-1"), account_id("konto-2"));

        // Och id:t får inte innehålla kontots id i klartext.
        let id = account_id("elev@edu.ronneby.se");
        assert_eq!(id.len(), 16);
        assert!(!id.contains("ronneby"));
    }

    #[test]
    fn usage_reaches_the_interface_in_the_shape_it_expects() {
        // Lärare-Chat läser `truncated` för att kunna varna för ett avhugget
        // svar. Fältet måste heta precis så i JSON.
        let usage = ChatUsage {
            model: config::MAIN_MODEL.to_string(),
            prompt_tokens: 12,
            completion_tokens: 34,
            cost: Some(0.0009),
            truncated: true,
            fallback: Some("nvidia/nemotron-3-super-120b-a12b:free".to_string()),
        };

        let json = serde_json::to_value(&usage).unwrap();
        assert_eq!(json["truncated"], true);
        assert_eq!(json["promptTokens"], 12);
        assert_eq!(json["completionTokens"], 34);
        assert_eq!(json["model"], config::MAIN_MODEL);
        // Gränssnittet läser `fallback` för att kunna berätta att svaret kom
        // från en gratismodell.
        assert_eq!(json["fallback"], "nvidia/nemotron-3-super-120b-a12b:free");
    }

    #[test]
    fn redaction_does_nothing_when_there_is_nothing_to_hide() {
        let client = OpenRouterClient::new(config::GATEWAY_URL, "").unwrap();
        assert_eq!(client.redact("inget att dölja"), "inget att dölja");
    }

    #[tokio::test]
    async fn a_missing_service_is_reported_before_any_network_call() {
        // En app utan tjänst ska säga det direkt i stället för att försöka.
        let client = OpenRouterClient::new("", "").unwrap();
        assert!(!client.is_configured());

        let messages = crate::chat::build_messages(&[ChatMessage::user("Hej")], None);
        let error = client
            .stream_chat(&messages, config::MAIN_MODEL, 100, |_| {})
            .await
            .expect_err("utan tjänst ska anropet stoppas");

        assert_eq!(error.kind(), "missing-api-key");
        assert!(!error.is_transient());
    }

    #[tokio::test]
    async fn an_account_is_required_for_everything_that_costs_money() {
        // Tjänsten begränsar anrop per konto. Ett anrop utan konto ska därför
        // aldrig lämna appen.
        let client = OpenRouterClient::new(config::GATEWAY_URL, TEST_TOKEN).unwrap();
        assert!(client.is_configured());

        let messages = crate::chat::build_messages(&[ChatMessage::user("Hej")], None);
        let error = client
            .stream_chat(&messages, config::MAIN_MODEL, 100, |_| {})
            .await
            .expect_err("utan konto ska anropet stoppas");

        assert_eq!(error.kind(), "not-signed-in");
    }

    #[tokio::test]
    async fn transient_errors_are_retried_and_permanent_ones_are_not() {
        // Två hastighetsgränser i rad, sedan ett svar.
        let mut attempts = 0u32;
        let value: Result<u32, AppError> = with_retry(|| {
            attempts += 1;
            let current = attempts;
            async move {
                if current < 3 {
                    Err(AppError::RateLimited)
                } else {
                    Ok(current)
                }
            }
        })
        .await;
        assert_eq!(value.unwrap(), 3);
        assert_eq!(attempts, 3);

        // Ett nyckelfel ger samma svar varje gång: bara ett anrop, ingen kostnad.
        let mut permanent = 0u32;
        let result: Result<u32, AppError> = with_retry(|| {
            permanent += 1;
            async { Err(AppError::Unauthorized) }
        })
        .await;
        assert!(result.is_err());
        assert_eq!(permanent, 1);
    }

    #[tokio::test]
    async fn retries_never_exceed_the_configured_limit() {
        let mut attempts = 0u32;
        let result: Result<u32, AppError> = with_retry(|| {
            attempts += 1;
            async { Err(AppError::RateLimited) }
        })
        .await;

        assert!(result.is_err());
        assert_eq!(attempts, config::MAX_RETRIES + 1);
    }

    // -- Riktiga anrop mot AI-tjänsten ------------------------------------

    #[tokio::test]
    #[ignore = "gör riktiga anrop mot AI-tjänsten – kör med: cargo test -- --ignored"]
    async fn live_the_service_answers_and_every_role_exists() {
        let client = live_client();

        let status: ServiceStatus = client
            .service_status()
            .await
            .expect("tjänstens läge borde gå att läsa");
        assert!(status.credits_left >= 0.0);
        assert!(
            !status.fallback_models.is_empty(),
            "tjänsten borde ha minst en gratismodell"
        );

        let models = client
            .list_models()
            .await
            .expect("modellistan borde gå att hämta");
        assert!(!models.is_empty());

        for id in [
            config::MAIN_MODEL,
            config::STUDY_MODEL,
            config::ECONOMY_MODEL,
            config::BACKUP_MODEL,
        ] {
            let model = models
                .iter()
                .find(|model| model.id == id)
                .unwrap_or_else(|| panic!("{id} finns inte i modellistan"));
            assert!(model.context_length > 0, "{id} saknar kontextlängd");
        }
    }

    #[tokio::test]
    #[ignore = "gör riktiga anrop mot AI-tjänsten – kör med: cargo test -- --ignored"]
    async fn live_streams_a_swedish_answer() {
        let client = live_client();

        let messages = crate::chat::build_messages(
            &[ChatMessage::user("Förklara kort varför himlen är blå.")],
            None,
        );

        let mut answer = String::new();
        let usage = client
            .stream_chat(&messages, config::MAIN_MODEL, 400, |chunk| {
                answer.push_str(chunk)
            })
            .await
            .expect("strömningen borde lyckas");

        assert!(!answer.trim().is_empty(), "svaret var tomt");
        assert!(
            answer.chars().count() > 80,
            "svaret var för kort: {} tecken",
            answer.chars().count()
        );
        assert!(!usage.truncated, "svaret kapades av tokenbudgeten");
        assert!(usage.completion_tokens > 0);

        // Svaret kommer från den valda modellen – eller, när kontot inte kan
        // använda den, från en gratismodell som tjänsten valt. Aldrig från
        // något annat.
        match usage.fallback.as_deref() {
            Some(free) => assert!(free.ends_with(":free"), "okänd reservmodell: {free}"),
            None => assert_eq!(usage.model, config::MAIN_MODEL),
        }
    }

    /// Hela reservvägen: kontot kan inte använda betalmodellerna, och eleven
    /// ska ändå få ett svar.
    #[tokio::test]
    #[ignore = "gör riktiga anrop mot AI-tjänsten – kör med: cargo test -- --ignored"]
    async fn live_answers_with_a_free_model_when_credits_are_out() {
        let client = live_client();

        let status = client.service_status().await.expect("läget borde gå att läsa");
        if status.credits_ok {
            // Kontot har krediter. Då finns inget att falla tillbaka från, och
            // testet säger det i stället för att påstå något det inte sett.
            eprintln!("kontot har krediter – reservvägen provas inte här");
            return;
        }

        let messages = crate::chat::build_messages(
            &[ChatMessage::user("Varför är himlen blå? Svara kort.")],
            None,
        );

        let mut answer = String::new();
        let usage = client
            .stream_chat(&messages, config::MAIN_MODEL, 300, |chunk| {
                answer.push_str(chunk)
            })
            .await
            .expect("anropet borde lyckas med en gratismodell");

        let fallback = usage
            .fallback
            .as_deref()
            .expect("svaret borde komma från en gratismodell");

        assert!(
            status.fallback_models.iter().any(|model| model == fallback),
            "reservmodellen {fallback} finns inte bland tjänstens modeller"
        );
        assert!(!answer.trim().is_empty(), "svaret var tomt");
        assert!(
            answer.chars().count() > 40,
            "svaret var för kort: {} tecken",
            answer.chars().count()
        );
    }

    #[tokio::test]
    #[ignore = "gör riktiga anrop mot AI-tjänsten – kör med: cargo test -- --ignored"]
    async fn live_creates_a_quiz_that_passes_validation() {
        let client = live_client();

        let request = GenerateRequest {
            kind: "quiz".to_string(),
            subject: "Biologi".to_string(),
            topic: "Fotosyntesen".to_string(),
            difficulty: Some("latt".to_string()),
            count: Some(3),
            material_id: None,
            context: None,
        };

        let messages = materials::build_messages(&request, None);
        let (content, usage) = client
            .chat_json(
                &messages,
                config::STUDY_MODEL,
                materials::schema_name("quiz"),
                materials::json_schema("quiz"),
            )
            .await
            .expect("quizet borde gå att skapa");

        // Det här är hela kedjan: schema -> modell -> validering -> sparbart innehåll.
        let validated = materials::validate("quiz", &content).expect("quizet borde följa schemat");
        let questions = validated["questions"].as_array().unwrap();
        assert_eq!(questions.len(), 3);

        for question in questions {
            let options = question["options"].as_array().unwrap();
            let correct = question["correctIndex"].as_i64().unwrap();
            assert!(options.len() >= 2);
            assert!(correct >= 0 && (correct as usize) < options.len());
            assert!(!question["explanation"].as_str().unwrap().is_empty());
        }

        // En gratismodell kostar ingenting, och då rapporteras ingen kostnad.
        assert!(
            usage.fallback.is_some() || usage.cost.unwrap_or(0.0) > 0.0,
            "kostnaden rapporterades inte"
        );
    }

    #[tokio::test]
    #[ignore = "gör riktiga anrop mot AI-tjänsten – kör med: cargo test -- --ignored"]
    async fn live_rejects_a_client_that_is_not_lumis_app() {
        let (url, _, _) = crate::commands::gateway_config();
        let client = OpenRouterClient::new(&url, "en-markering-som-inte-finns")
            .unwrap()
            .for_account("lumi-live-test");

        let error = client
            .service_status()
            .await
            .expect_err("en påhittad markering borde avvisas");

        assert_eq!(error.kind(), "unauthorized", "fick fel: {error}");
        assert!(!error.is_transient(), "en felaktig markering ska inte försökas igen");
    }
}
