//! Fel som kan uppstå i backend och som skickas vidare till gränssnittet.
//!
//! Tauri serialiserar fel över IPC. Vi skickar ett litet objekt med `kind` och
//! `message` i stället för enbart en sträng, eftersom gränssnittet behöver
//! kunna skilja på till exempel "nyckeln saknas" (visa inställningar) och
//! "nätverket är nere" (erbjud att försöka igen).

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(
        "Lumi har ingen OpenRouter-nyckel. Lägg in OPENROUTER_API_KEY i Windows miljövariabler och starta om Lumi."
    )]
    MissingApiKey,

    #[error("Fel e-postadress eller lösenord.")]
    InvalidCredentials,

    #[error("Kontot är inaktiverat. Kontakta administratören.")]
    AccountInactive,

    #[error("För många felaktiga försök. Vänta {0} sekunder och försök igen.")]
    TooManyAttempts(u64),

    #[error("Du är inte inloggad. Logga in i Lumi och försök igen.")]
    NotSignedIn,

    #[error("Bara ett administratörskonto kan göra det här.")]
    NotAdmin,

    #[error("Det finns redan ett konto med den e-postadressen.")]
    EmailTaken,

    #[error("OpenRouter underkände API-nyckeln. Kontrollera att den är giltig och aktiv.")]
    Unauthorized,

    #[error("Krediten hos OpenRouter är slut. Fyll på hos OpenRouter eller byt nyckel.")]
    InsufficientCredits,

    #[error("För många anrop just nu. Vänta en liten stund och försök igen.")]
    RateLimited,

    #[error("Kunde inte nå OpenRouter. Kontrollera internetanslutningen och försök igen.")]
    Network(String),

    #[error("Modellen kunde inte användas: {0}")]
    Model(String),

    #[error("OpenRouter svarade med fel {status}: {message}")]
    Api { status: u16, message: String },

    #[error("AI:n svarade i ett format som Lumi inte kunde läsa. Försök igen.")]
    UnreadableResponse,

    #[error("Kunde inte kontrollera uppdateringar: {0}")]
    Update(String),

    #[error("Innehållet godkändes inte: {0}")]
    Validation(String),

    #[error("Kunde inte läsa eller spara data: {0}")]
    Storage(String),
}

impl AppError {
    /// Stabil identifierare som gränssnittet kan växla på.
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::MissingApiKey => "missing-api-key",
            AppError::InvalidCredentials => "invalid-credentials",
            AppError::AccountInactive => "account-inactive",
            AppError::TooManyAttempts(_) => "too-many-attempts",
            AppError::NotSignedIn => "not-signed-in",
            AppError::NotAdmin => "not-admin",
            AppError::EmailTaken => "email-taken",
            AppError::Unauthorized => "unauthorized",
            AppError::InsufficientCredits => "insufficient-credits",
            AppError::RateLimited => "rate-limited",
            AppError::Network(_) => "network",
            AppError::Model(_) => "model",
            AppError::Api { .. } => "api",
            AppError::UnreadableResponse => "unreadable-response",
            AppError::Update(_) => "update",
            AppError::Validation(_) => "validation",
            AppError::Storage(_) => "storage",
        }
    }

    /// Sant bara för fel som är värda ett nytt försök: tillfälliga problem hos
    /// nätverket eller hos leverantören.
    ///
    /// Nyckel-, kredit-, modell- och valideringsfel är avsiktligt inte med.
    /// Samma indata skulle ge samma svar, så ett nytt försök kostar bara pengar
    /// utan att hjälpa eleven.
    pub fn is_transient(&self) -> bool {
        match self {
            AppError::Network(_) | AppError::RateLimited => true,
            AppError::Api { status, .. } => *status >= 500 || *status == 408,
            _ => false,
        }
    }

    /// Sant när modellen inte kan användas alls. Det är den enda situationen
    /// där reservmodellen får ta över.
    pub fn is_model_problem(&self) -> bool {
        matches!(self, AppError::Model(_))
    }
}

#[derive(Serialize)]
struct SerializedError<'a> {
    kind: &'a str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        SerializedError {
            kind: self.kind(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        AppError::Network(err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Storage(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Storage(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::AppError;

    #[test]
    fn only_temporary_failures_are_retried() {
        // Nätverk, hastighetsgräns och leverantörsfel är värda ett nytt försök.
        assert!(AppError::Network("timeout".to_string()).is_transient());
        assert!(AppError::RateLimited.is_transient());
        assert!(AppError::Api {
            status: 503,
            message: "service unavailable".to_string()
        }
        .is_transient());
        assert!(AppError::Api {
            status: 408,
            message: "timeout".to_string()
        }
        .is_transient());

        // Dessa skulle ge exakt samma svar igen och bara kosta pengar.
        for error in [
            AppError::MissingApiKey,
            AppError::InvalidCredentials,
            AppError::AccountInactive,
            AppError::TooManyAttempts(30),
            AppError::NotSignedIn,
            AppError::NotAdmin,
            AppError::EmailTaken,
            AppError::Unauthorized,
            AppError::InsufficientCredits,
            AppError::Model("okänd modell".to_string()),
            AppError::Update("ingen release ännu".to_string()),
            AppError::Validation("fel format".to_string()),
            AppError::Storage("disk full".to_string()),
            AppError::UnreadableResponse,
            AppError::Api {
                status: 400,
                message: "bad request".to_string(),
            },
        ] {
            assert!(
                !error.is_transient(),
                "{} borde inte försökas igen",
                error.kind()
            );
        }
    }

    #[test]
    fn only_a_broken_model_allows_the_backup_model() {
        assert!(AppError::Model("modellen finns inte".to_string()).is_model_problem());

        // En tillfällig störning ska lösas med ett nytt försök på samma modell,
        // inte genom att byta modell.
        assert!(!AppError::RateLimited.is_model_problem());
        assert!(!AppError::Network("nere".to_string()).is_model_problem());
        assert!(!AppError::Api {
            status: 502,
            message: "bad gateway".to_string()
        }
        .is_model_problem());
    }

    #[test]
    fn error_kinds_are_stable_for_the_interface() {
        assert_eq!(AppError::MissingApiKey.kind(), "missing-api-key");
        assert_eq!(AppError::Unauthorized.kind(), "unauthorized");
        assert_eq!(AppError::RateLimited.kind(), "rate-limited");
        assert_eq!(AppError::UnreadableResponse.kind(), "unreadable-response");
        assert_eq!(
            AppError::Update("nätet nere".to_string()).kind(),
            "update"
        );
        assert_eq!(
            AppError::Api {
                status: 500,
                message: "fel".to_string()
            }
            .kind(),
            "api"
        );
    }

    #[test]
    fn messages_are_swedish_and_never_ask_for_a_key_in_the_interface() {
        let messages = [
            AppError::MissingApiKey.to_string(),
            AppError::Unauthorized.to_string(),
            AppError::InsufficientCredits.to_string(),
            AppError::RateLimited.to_string(),
            AppError::Network("x".to_string()).to_string(),
            AppError::Update("x".to_string()).to_string(),
        ];

        for message in messages {
            assert!(!message.trim().is_empty());
            // Ingen del av nyckeln får någonsin hamna i ett felmeddelande.
            assert!(!message.contains("sk-or-"), "{message}");
            // Nyckeln får inte efterfrågas i gränssnittet.
            assert!(!message.to_lowercase().contains("klistra in"), "{message}");
            assert!(!message.to_lowercase().contains("profil"), "{message}");
        }
    }

    #[test]
    fn the_error_is_serialised_with_kind_and_message() {
        let json = serde_json::to_value(AppError::RateLimited).unwrap();
        assert_eq!(json["kind"], "rate-limited");
        assert!(json["message"].as_str().unwrap().contains("För många anrop"));
    }
}
