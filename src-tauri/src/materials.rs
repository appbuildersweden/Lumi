//! Studiematerial: de sex typerna, deras JSON-scheman, promptarna som styr
//! AI:n och valideringen som körs innan något får sparas.
//!
//! Schemat som skickas till OpenRouter och valideringen här nedan hålls
//! medvetet i samma fil, så att de inte kan glida isär.

use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::error::AppError;
use crate::openrouter::ChatMessage;
use crate::storage::StudyMaterial;

pub const KINDS: [&str; 6] = [
    "summary",
    "quiz",
    "flashcards",
    "practice-exam",
    "notes",
    "study-plan",
];

/// Tak för hur mycket av ett sparat material som skickas med som underlag.
const MAX_CONTEXT_CHARS: usize = 8_000;

pub fn is_known_kind(kind: &str) -> bool {
    KINDS.contains(&kind)
}

pub fn kind_label(kind: &str) -> &'static str {
    match kind {
        "summary" => "Sammanfattning",
        "quiz" => "Quiz",
        "flashcards" => "Flashcards",
        "practice-exam" => "Övningsprov",
        "notes" => "Anteckningar",
        "study-plan" => "Studieplan",
        _ => "Studiematerial",
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub kind: String,
    pub subject: String,
    pub topic: String,
    /// "latt", "medel" eller "svar".
    #[serde(default)]
    pub difficulty: Option<String>,
    /// Antal frågor eller kort, där det är relevant.
    #[serde(default)]
    pub count: Option<u32>,
    /// Id för sparat material som ska användas som underlag.
    #[serde(default)]
    pub material_id: Option<String>,
    /// Fritextunderlag, till exempel ett utdrag ur en konversation.
    #[serde(default)]
    pub context: Option<String>,
}

/// JSON-schemat som AI-svaret måste följa för varje materialtyp.
pub fn json_schema(kind: &str) -> Value {
    match kind {
        "summary" => json!({
            "type": "object",
            "properties": {
                "sections": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "heading": { "type": "string" },
                            "body": { "type": "string" }
                        },
                        "required": ["heading", "body"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["sections"],
            "additionalProperties": false
        }),
        "quiz" => json!({
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": { "type": "string" },
                            "options": { "type": "array", "items": { "type": "string" } },
                            "correctIndex": { "type": "integer" },
                            "explanation": { "type": "string" }
                        },
                        "required": ["question", "options", "correctIndex", "explanation"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["questions"],
            "additionalProperties": false
        }),
        "flashcards" => json!({
            "type": "object",
            "properties": {
                "cards": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "front": { "type": "string" },
                            "back": { "type": "string" }
                        },
                        "required": ["front", "back"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["cards"],
            "additionalProperties": false
        }),
        "practice-exam" => json!({
            "type": "object",
            "properties": {
                "instructions": { "type": "string" },
                "questions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": { "type": "string" },
                            "points": { "type": "integer" },
                            "answer": { "type": "string" },
                            "explanation": { "type": "string" }
                        },
                        "required": ["question", "points", "answer", "explanation"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["instructions", "questions"],
            "additionalProperties": false
        }),
        "notes" => json!({
            "type": "object",
            "properties": {
                "sections": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "heading": { "type": "string" },
                            "bullets": { "type": "array", "items": { "type": "string" } }
                        },
                        "required": ["heading", "bullets"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["sections"],
            "additionalProperties": false
        }),
        _ => json!({
            "type": "object",
            "properties": {
                "summary": { "type": "string" },
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": { "type": "string" },
                            "focus": { "type": "string" },
                            "minutes": { "type": "integer" }
                        },
                        "required": ["title", "focus", "minutes"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["summary", "steps"],
            "additionalProperties": false
        }),
    }
}

pub fn schema_name(kind: &str) -> &'static str {
    match kind {
        "summary" => "sammanfattning",
        "quiz" => "quiz",
        "flashcards" => "flashcards",
        "practice-exam" => "ovningsprov",
        "notes" => "anteckningar",
        _ => "studieplan",
    }
}

/// Instruktionen som styr hur AI:n skriver materialet.
pub fn material_system_prompt(kind: &str) -> String {
    let specific = match kind {
        "summary" => "Skriv en tydlig sammanfattning uppdelad i avsnitt med rubrik och brödtext.",
        "quiz" => {
            "Skriv flervalsfrågor. Varje fråga har 3 till 4 svarsalternativ. \
             correctIndex är indexet (0-baserat) för det alternativ som är rätt. \
             explanation förklarar kort varför svaret är rätt."
        }
        "flashcards" => {
            "Skriv kort med en fråga eller ett begrepp på framsidan (front) och ett kort svar på baksidan (back)."
        }
        "practice-exam" => {
            "Skriv ett övningsprov med öppna frågor. points är frågans poäng (1 till 10). \
             answer är facit och explanation förklarar hur man kommer fram till svaret."
        }
        "notes" => {
            "Skriv strukturerade anteckningar med rubriker och punktlistor. Varje punkt är en egen sträng."
        }
        _ => {
            "Skriv en studieplan. summary är en kort översikt. steps är stegen i den ordning \
             eleven bör ta dem, med fokusområde och uppskattad tid i minuter."
        }
    };

    format!(
        "Du är Lumi, en svensk studievägledare för skolelever. Du skriver alltid på svenska, \
         tydligt och konkret.\n\n{specific}\n\nRegler:\n\
         - Håll dig till det ämne och den nivå eleven angett.\n\
         - Skriv korrekt fakta. Hitta aldrig på källor, årtal eller citat.\n\
         - Använd enkla meningar och förklara facktermer första gången de används.\n\
         - Svaret ska vara strukturerat och gå att läsa direkt i appen."
    )
}

/// Bygger användarmeddelandet, inklusive valfritt underlag.
pub fn material_user_prompt(request: &GenerateRequest, source: Option<&str>) -> String {
    let mut prompt = String::new();
    prompt.push_str(&format!("Ämne: {}\n", request.subject.trim()));
    prompt.push_str(&format!("Område: {}\n", request.topic.trim()));

    if let Some(difficulty) = request.difficulty.as_deref() {
        let level = match difficulty {
            "latt" => "lätt",
            "svar" => "svår",
            _ => "medel",
        };
        prompt.push_str(&format!("Nivå: {level}\n"));
    }

    if let Some(count) = request.count {
        let count = count.clamp(1, 40);
        prompt.push_str(&format!("Antal: {count}\n"));
    }

    prompt.push_str(&format!(
        "\nSkapa: {}\n",
        kind_label(&request.kind)
    ));

    if let Some(source) = source {
        let trimmed: String = source.chars().take(MAX_CONTEXT_CHARS).collect();
        prompt.push_str(
            "\nUnderlaget nedan kommer från elevens eget material. \
             Utgå från underlaget. Om något inte står där ska du säga det i stället för att gissa.\n\
             <underlag>\n",
        );
        prompt.push_str(&trimmed);
        prompt.push_str("\n</underlag>\n");
    }

    prompt
}

pub fn build_messages(request: &GenerateRequest, source: Option<&str>) -> Vec<ChatMessage> {
    vec![
        ChatMessage::system(material_system_prompt(&request.kind)),
        ChatMessage::user(material_user_prompt(request, source)),
    ]
}

pub fn default_title(kind: &str, topic: &str) -> String {
    let topic = topic.trim();
    if topic.is_empty() {
        kind_label(kind).to_string()
    } else {
        format!("{} – {}", kind_label(kind), topic)
    }
}

/// Gör om sparat material till läsbar text, så att det kan användas som
/// underlag i chatten eller när nytt material skapas.
pub fn flatten(material: &StudyMaterial) -> String {
    let mut out = String::new();
    out.push_str(&format!("{} [{}]\nÄmne: {}\n", material.title, kind_label(&material.kind), material.subject));
    let content = &material.content;

    match material.kind.as_str() {
        "summary" | "notes" => {
            if let Some(sections) = content.get("sections").and_then(Value::as_array) {
                for section in sections {
                    let heading = section.get("heading").and_then(Value::as_str).unwrap_or("");
                    out.push_str(&format!("\n## {heading}\n"));
                    if let Some(body) = section.get("body").and_then(Value::as_str) {
                        out.push_str(body);
                        out.push('\n');
                    }
                    if let Some(bullets) = section.get("bullets").and_then(Value::as_array) {
                        for bullet in bullets {
                            if let Some(bullet) = bullet.as_str() {
                                out.push_str(&format!("- {bullet}\n"));
                            }
                        }
                    }
                }
            }
        }
        "quiz" => {
            if let Some(questions) = content.get("questions").and_then(Value::as_array) {
                for (index, question) in questions.iter().enumerate() {
                    let text = question.get("question").and_then(Value::as_str).unwrap_or("");
                    out.push_str(&format!("\n{}. {text}\n", index + 1));
                    if let Some(options) = question.get("options").and_then(Value::as_array) {
                        for (number, option) in options.iter().enumerate() {
                            if let Some(option) = option.as_str() {
                                let letter = (b'a' + number as u8) as char;
                                out.push_str(&format!("   {letter}) {option}\n"));
                            }
                        }
                    }
                    if let Some(explanation) = question.get("explanation").and_then(Value::as_str) {
                        out.push_str(&format!("   Förklaring: {explanation}\n"));
                    }
                }
            }
        }
        "flashcards" => {
            if let Some(cards) = content.get("cards").and_then(Value::as_array) {
                for card in cards {
                    let front = card.get("front").and_then(Value::as_str).unwrap_or("");
                    let back = card.get("back").and_then(Value::as_str).unwrap_or("");
                    out.push_str(&format!("\n- {front} => {back}\n"));
                }
            }
        }
        "practice-exam" => {
            if let Some(instructions) = content.get("instructions").and_then(Value::as_str) {
                out.push_str(&format!("\n{instructions}\n"));
            }
            if let Some(questions) = content.get("questions").and_then(Value::as_array) {
                for (index, question) in questions.iter().enumerate() {
                    let text = question.get("question").and_then(Value::as_str).unwrap_or("");
                    let points = question.get("points").and_then(Value::as_i64).unwrap_or(1);
                    out.push_str(&format!("\n{}. ({points} p) {text}\n", index + 1));
                    if let Some(answer) = question.get("answer").and_then(Value::as_str) {
                        out.push_str(&format!("   Facit: {answer}\n"));
                    }
                }
            }
        }
        _ => {
            if let Some(summary) = content.get("summary").and_then(Value::as_str) {
                out.push_str(&format!("\n{summary}\n"));
            }
            if let Some(steps) = content.get("steps").and_then(Value::as_array) {
                for (index, step) in steps.iter().enumerate() {
                    let title = step.get("title").and_then(Value::as_str).unwrap_or("");
                    let focus = step.get("focus").and_then(Value::as_str).unwrap_or("");
                    let minutes = step.get("minutes").and_then(Value::as_i64).unwrap_or(0);
                    out.push_str(&format!("\n{}. {title} ({minutes} min)\n   {focus}\n", index + 1));
                }
            }
        }
    }

    out
}

// ---------------------------------------------------------------------------
// Validering
// ---------------------------------------------------------------------------

fn object(value: &Value, label: &str) -> Result<Map<String, Value>, AppError> {
    value
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::Validation(format!("{label} är inte ett objekt.")))
}

fn text(map: &Map<String, Value>, key: &str, label: &str) -> Result<String, AppError> {
    let value = map
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Validation(format!("{label} saknas.")))?;
    Ok(value.to_string())
}

fn long_text(map: &Map<String, Value>, key: &str, label: &str, max: usize) -> Result<String, AppError> {
    let value = text(map, key, label)?;
    if value.chars().count() > max {
        return Err(AppError::Validation(format!(
            "{label} är för långt (max {max} tecken)."
        )));
    }
    Ok(value)
}

fn integer(
    map: &Map<String, Value>,
    key: &str,
    label: &str,
    min: i64,
    max: i64,
) -> Result<i64, AppError> {
    let value = map
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| AppError::Validation(format!("{label} saknas eller är inte ett tal.")))?;
    if value < min || value > max {
        return Err(AppError::Validation(format!(
            "{label} måste vara mellan {min} och {max}."
        )));
    }
    Ok(value)
}

fn list<'a>(
    map: &'a Map<String, Value>,
    key: &str,
    label: &str,
    min: usize,
    max: usize,
) -> Result<&'a Vec<Value>, AppError> {
    let items = map
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Validation(format!("{label} saknas.")))?;
    if items.len() < min {
        return Err(AppError::Validation(format!(
            "{label} måste innehålla minst {min}."
        )));
    }
    if items.len() > max {
        return Err(AppError::Validation(format!(
            "{label} innehåller för många (max {max})."
        )));
    }
    Ok(items)
}

fn string_list(
    map: &Map<String, Value>,
    key: &str,
    label: &str,
    min: usize,
    max: usize,
) -> Result<Vec<String>, AppError> {
    let items = map
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Validation(format!("{label} saknas.")))?;
    if items.len() < min || items.len() > max {
        return Err(AppError::Validation(format!(
            "{label} måste innehålla mellan {min} och {max} punkter."
        )));
    }

    let mut result = Vec::with_capacity(items.len());
    for item in items {
        let value = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Validation(format!("{label} innehåller en tom rad.")))?;
        result.push(value.to_string());
    }
    Ok(result)
}

/// Validerar och normaliserar AI:ns svar. Returnerar det innehåll som faktiskt
/// får sparas, eller ett fel som beskriver vad som var fel.
pub fn validate(kind: &str, content: &Value) -> Result<Value, AppError> {
    if !is_known_kind(kind) {
        return Err(AppError::Validation(format!(
            "Materialtypen \"{kind}\" finns inte i Lumi."
        )));
    }

    let root = object(content, "Svaret")?;

    match kind {
        "summary" => {
            let sections = list(&root, "sections", "Avsnitten", 1, 30)?;
            let mut normalized = Vec::with_capacity(sections.len());
            for section in sections {
                let section = object(section, "Ett avsnitt")?;
                normalized.push(json!({
                    "heading": long_text(&section, "heading", "Rubriken", 200)?,
                    "body": long_text(&section, "body", "Brödtexten", 4_000)?,
                }));
            }
            Ok(json!({ "sections": normalized }))
        }
        "quiz" => {
            let questions = list(&root, "questions", "Frågorna", 1, 40)?;
            let mut normalized = Vec::with_capacity(questions.len());
            for question in questions {
                let question = object(question, "En fråga")?;
                let options = string_list(&question, "options", "Svarsalternativen", 2, 6)?;
                let correct =
                    integer(&question, "correctIndex", "Rätt svar", 0, options.len() as i64 - 1)?;
                normalized.push(json!({
                    "question": long_text(&question, "question", "Frågan", 1_000)?,
                    "options": options,
                    "correctIndex": correct,
                    "explanation": long_text(&question, "explanation", "Förklaringen", 1_500)?,
                }));
            }
            Ok(json!({ "questions": normalized }))
        }
        "flashcards" => {
            let cards = list(&root, "cards", "Korten", 1, 60)?;
            let mut normalized = Vec::with_capacity(cards.len());
            for card in cards {
                let card = object(card, "Ett kort")?;
                normalized.push(json!({
                    "front": long_text(&card, "front", "Framsidan", 600)?,
                    "back": long_text(&card, "back", "Baksidan", 1_500)?,
                }));
            }
            Ok(json!({ "cards": normalized }))
        }
        "practice-exam" => {
            let questions = list(&root, "questions", "Frågorna", 1, 40)?;
            let mut normalized = Vec::with_capacity(questions.len());
            for question in questions {
                let question = object(question, "En fråga")?;
                normalized.push(json!({
                    "question": long_text(&question, "question", "Frågan", 1_500)?,
                    "points": integer(&question, "points", "Poängen", 1, 100)?,
                    "answer": long_text(&question, "answer", "Facit", 2_000)?,
                    "explanation": long_text(&question, "explanation", "Förklaringen", 2_000)?,
                }));
            }
            Ok(json!({
                "instructions": long_text(&root, "instructions", "Instruktionen", 1_000)?,
                "questions": normalized,
            }))
        }
        "notes" => {
            let sections = list(&root, "sections", "Avsnitten", 1, 40)?;
            let mut normalized = Vec::with_capacity(sections.len());
            for section in sections {
                let section = object(section, "Ett avsnitt")?;
                normalized.push(json!({
                    "heading": long_text(&section, "heading", "Rubriken", 200)?,
                    "bullets": string_list(&section, "bullets", "Punkterna", 1, 30)?,
                }));
            }
            Ok(json!({ "sections": normalized }))
        }
        _ => {
            let steps = list(&root, "steps", "Stegen", 1, 30)?;
            let mut normalized = Vec::with_capacity(steps.len());
            for step in steps {
                let step = object(step, "Ett steg")?;
                normalized.push(json!({
                    "title": long_text(&step, "title", "Rubriken", 200)?,
                    "focus": long_text(&step, "focus", "Fokusområdet", 600)?,
                    "minutes": integer(&step, "minutes", "Minuterna", 1, 600)?,
                }));
            }
            Ok(json!({
                "summary": long_text(&root, "summary", "Översikten", 2_000)?,
                "steps": normalized,
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{KINDS, is_known_kind, kind_label, validate};
    use serde_json::json;

    fn quiz() -> serde_json::Value {
        json!({
            "questions": [{
                "question": "Vilken gas andas vi in?",
                "options": ["Syre", "Kväve", "Koldioxid"],
                "correctIndex": 0,
                "explanation": "Vi tar upp syre från luften."
            }]
        })
    }

    #[test]
    fn every_kind_has_a_swedish_label() {
        for kind in KINDS {
            assert!(is_known_kind(kind));
            assert_ne!(kind_label(kind), "Studiematerial", "{kind} saknar etikett");
        }
        assert!(!is_known_kind("sammanfattning"));
        assert!(!is_known_kind(""));
    }

    #[test]
    fn a_well_formed_quiz_is_accepted_and_normalised() {
        let content = validate("quiz", &quiz()).expect("quizet borde godkännas");
        let questions = content["questions"].as_array().unwrap();

        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0]["question"], "Vilken gas andas vi in?");
        assert_eq!(questions[0]["correctIndex"], 0);
        assert_eq!(questions[0]["options"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn extra_fields_the_model_invented_are_dropped() {
        let content = validate("quiz", &quiz()).unwrap();
        // Bara de fält Lumi känner igen får följa med till lagringen.
        assert!(content.get("conversationId").is_none());
        assert_eq!(
            content["questions"][0].as_object().unwrap().keys().count(),
            4
        );
    }

    #[test]
    fn whitespace_around_the_model_answer_is_trimmed() {
        let content = validate(
            "flashcards",
            &json!({
                "cards": [{ "front": "  Vad är 2+2?  ", "back": "  4  " }]
            }),
        )
        .unwrap();

        assert_eq!(content["cards"][0]["front"], "Vad är 2+2?");
        assert_eq!(content["cards"][0]["back"], "4");
    }

    #[test]
    fn an_unknown_material_type_is_rejected() {
        let error = validate("lathund", &quiz()).expect_err("okänd typ borde avvisas");
        assert_eq!(error.kind(), "validation");
    }

    #[test]
    fn content_that_is_not_an_object_is_rejected() {
        for content in [json!("en text"), json!([1, 2, 3]), json!(null)] {
            let error = validate("quiz", &content).expect_err("fel form borde avvisas");
            assert_eq!(error.kind(), "validation");
        }
    }

    #[test]
    fn a_quiz_without_questions_is_rejected() {
        assert!(validate("quiz", &json!({})).is_err());
        assert!(validate("quiz", &json!({ "questions": [] })).is_err());
        assert!(validate("quiz", &json!({ "questions": "fyra frågor" })).is_err());
    }

    #[test]
    fn a_question_needs_at_least_two_real_options() {
        let one_option = json!({
            "questions": [{
                "question": "Fråga",
                "options": ["Enda"],
                "correctIndex": 0,
                "explanation": "Förklaring"
            }]
        });
        assert!(validate("quiz", &one_option).is_err());

        let empty_option = json!({
            "questions": [{
                "question": "Fråga",
                "options": ["A", "   "],
                "correctIndex": 0,
                "explanation": "Förklaring"
            }]
        });
        assert!(validate("quiz", &empty_option).is_err());
    }

    #[test]
    fn the_correct_answer_must_point_at_an_existing_option() {
        let outside = json!({
            "questions": [{
                "question": "Fråga",
                "options": ["A", "B"],
                "correctIndex": 5,
                "explanation": "Förklaring"
            }]
        });

        // Utan den här kontrollen skulle facit kunna peka utanför listan och
        // göra quizet omöjligt att rätta.
        assert!(validate("quiz", &outside).is_err());
    }

    #[test]
    fn a_quiz_question_must_have_an_explanation() {
        let no_explanation = json!({
            "questions": [{
                "question": "Fråga",
                "options": ["A", "B"],
                "correctIndex": 1
            }]
        });
        assert!(validate("quiz", &no_explanation).is_err());
    }

    #[test]
    fn flashcards_need_both_sides() {
        let ok = validate(
            "flashcards",
            &json!({ "cards": [{ "front": "Framsida", "back": "Baksida" }] }),
        );
        assert!(ok.is_ok());

        let missing_back = json!({ "cards": [{ "front": "Framsida" }] });
        assert!(validate("flashcards", &missing_back).is_err());
        assert!(validate("flashcards", &json!({ "cards": [] })).is_err());
    }

    #[test]
    fn a_practice_exam_needs_instructions_and_a_key() {
        let ok = json!({
            "instructions": "Svara med egna ord.",
            "questions": [{
                "question": "Förklara fotosyntesen.",
                "points": 3,
                "answer": "Växten omvandlar ljus till socker.",
                "explanation": "Ljusenergi lagras i socker."
            }]
        });
        assert!(validate("practice-exam", &ok).is_ok());

        let no_instructions = json!({
            "questions": [{
                "question": "Fråga",
                "points": 1,
                "answer": "Svar",
                "explanation": "Förklaring"
            }]
        });
        assert!(validate("practice-exam", &no_instructions).is_err());

        let no_key = json!({
            "instructions": "Instruktion",
            "questions": [{
                "question": "Fråga",
                "points": 1,
                "explanation": "Förklaring"
            }]
        });
        assert!(validate("practice-exam", &no_key).is_err());
    }

    #[test]
    fn a_summary_needs_heading_and_body_in_every_section() {
        let ok = json!({
            "sections": [{ "heading": "Cellens delar", "body": "Kärnan styr cellen." }]
        });
        assert!(validate("summary", &ok).is_ok());

        let missing_body = json!({ "sections": [{ "heading": "Cellens delar" }] });
        assert!(validate("summary", &missing_body).is_err());
    }

    #[test]
    fn a_study_plan_needs_a_summary_and_reasonable_minutes() {
        let ok = json!({
            "summary": "Fyra dagar inför provet.",
            "steps": [{ "title": "Dag 1", "focus": "Cellens delar", "minutes": 30 }]
        });
        assert!(validate("study-plan", &ok).is_ok());

        let absurd = json!({
            "summary": "Plan",
            "steps": [{ "title": "Dag 1", "focus": "Allt", "minutes": 0 }]
        });
        assert!(validate("study-plan", &absurd).is_err());
    }
}
