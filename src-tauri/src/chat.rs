//! Lärarprompten och uppbyggnaden av samtalshistoriken för Lärare-Chat.

use crate::openrouter::ChatMessage;

/// Hur många tidigare meddelanden som skickas med. Modellen har plats för
/// mycket mer, men äldre meddelanden kostar pengar utan att tillföra något.
const MAX_HISTORY: usize = 60;

pub const TUTOR_SYSTEM_PROMPT: &str = "\
Du är Lumi, en personlig lärare för skolelever i Sverige. Du svarar alltid på svenska.

Så här undervisar du:
- Förklara steg för steg och bygg upp förståelsen i små steg.
- Börja med det viktigaste och hoppa över onödiga detaljer.
- Använd konkreta exempel och vardagliga liknelser.
- Avsluta gärna med en kort kontrollfråga så att eleven får tänka själv.
- Ge inte alltid det färdiga svaret direkt på en skoluppgift. Visa hur man gör
  och låt eleven prova själv först. Om eleven ber om svaret får du ge det, men
  förklara då hur man kom fram till det.
- Om eleven inte förstod, förklara igen på ett enklare sätt med ett annat exempel.
- Anpassa nivån: enklare språk för yngre elever, mer djup för äldre.
- Kom ihåg vad som sagts tidigare i samma konversation och bygg vidare på det.
- Om eleven byter ämne följer du med utan att tjata om det gamla.
- Eleven kan skapa quiz, flashcards och sammanfattningar under Plugga. Hänvisa
  dit när eleven vill spara något, men ge gärna en kort övning direkt i chatten.

Fakta och ärlighet:
- Hitta aldrig på källor, årtal, citat eller personer.
- Är du osäker ska du säga det i stället för att gissa.
- Om eleven inte förstår en uppgift, fråga vad hen har försökt med.

Längd: håll svaren lagom långa. En tydlig förklaring slår en lång.";

/// Lägger till elevens eget material som underlag, med en tydlig gräns mellan
/// vad som står i underlaget och vad AI:n själv förklarar.
pub fn with_source(system_prompt: &str, source: Option<&str>) -> String {
    let Some(source) = source.map(str::trim).filter(|source| !source.is_empty()) else {
        return system_prompt.to_string();
    };

    format!(
        "{system_prompt}\n\n\
         Eleven har valt att använda sitt eget material som underlag. Underlaget står nedan.\n\
         - Bygg svaret på underlaget när frågan handlar om det.\n\
         - Om något inte står i underlaget ska du säga det tydligt och sedan, om du kan,\n  \
           förklara med din egen kunskap och markera att det är din egen förklaring.\n\
         - Hitta aldrig på innehåll som om det stod i underlaget.\n\
         <underlag>\n{source}\n</underlag>"
    )
}

/// Bygger meddelandelistan som skickas till modellen: systemprompt först,
/// därefter samtalshistoriken i ordning.
pub fn build_messages(history: &[ChatMessage], source: Option<&str>) -> Vec<ChatMessage> {
    let mut messages = Vec::with_capacity(history.len() + 1);
    messages.push(ChatMessage::system(with_source(TUTOR_SYSTEM_PROMPT, source)));

    let relevant: Vec<&ChatMessage> = history
        .iter()
        .filter(|message| matches!(message.role.as_str(), "user" | "assistant"))
        .filter(|message| !message.content.trim().is_empty())
        .collect();

    let start = relevant.len().saturating_sub(MAX_HISTORY);
    for message in &relevant[start..] {
        messages.push((*message).clone());
    }

    messages
}

/// Gör om en konversation till ett textunderlag, så att eleven kan be om
/// övningar utifrån det som redan sagts i chatten.
pub fn transcript(history: &[ChatMessage]) -> String {
    history
        .iter()
        .filter(|message| matches!(message.role.as_str(), "user" | "assistant"))
        .map(|message| {
            let speaker = if message.role == "user" { "Elev" } else { "Lumi" };
            format!("{speaker}: {}", message.content.trim())
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::{MAX_HISTORY, TUTOR_SYSTEM_PROMPT, build_messages, transcript, with_source};
    use crate::openrouter::ChatMessage;

    fn message(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn the_system_prompt_always_comes_first() {
        let history = vec![message("user", "Vad är en bråkdel?")];
        let messages = build_messages(&history, None);

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "system");
        assert!(messages[0].content.contains("Du är Lumi"));
        assert!(messages[0].content.contains("svenska"));
        assert_eq!(messages[1].role, "user");
        assert_eq!(messages[1].content, "Vad är en bråkdel?");
    }

    #[test]
    fn an_empty_source_is_not_added_to_the_prompt() {
        assert_eq!(with_source(TUTOR_SYSTEM_PROMPT, None), TUTOR_SYSTEM_PROMPT);
        assert_eq!(
            with_source(TUTOR_SYSTEM_PROMPT, Some("   \n  ")),
            TUTOR_SYSTEM_PROMPT
        );
    }

    #[test]
    fn a_source_is_marked_as_the_students_own_material() {
        let prompt = with_source(TUTOR_SYSTEM_PROMPT, Some("Cellkärnan innehåller DNA."));

        // Gränsen mellan underlag och modellens egen kunskap måste vara tydlig.
        assert!(prompt.contains("<underlag>"));
        assert!(prompt.contains("Cellkärnan innehåller DNA."));
        assert!(prompt.contains("Hitta aldrig på innehåll som om det stod i underlaget"));
    }

    #[test]
    fn unknown_roles_and_empty_messages_are_dropped() {
        let history = vec![
            message("system", "en gammal systemprompt"),
            message("user", "fråga"),
            message("assistant", "   "),
            message("assistant", "svar"),
        ];
        let messages = build_messages(&history, None);

        let roles: Vec<&str> = messages.iter().map(|item| item.role.as_str()).collect();
        assert_eq!(roles, vec!["system", "user", "assistant"]);
        assert_eq!(messages[2].content, "svar");
    }

    #[test]
    fn only_the_most_recent_history_is_sent() {
        let history: Vec<ChatMessage> = (0..MAX_HISTORY + 10)
            .map(|index| message("user", &format!("fråga {index}")))
            .collect();
        let messages = build_messages(&history, None);

        // Systemprompten plus de senaste meddelandena, inte hela historiken.
        assert_eq!(messages.len(), MAX_HISTORY + 1);
        assert_eq!(messages[1].content, "fråga 10");
        assert_eq!(
            messages.last().unwrap().content,
            format!("fråga {}", MAX_HISTORY + 9)
        );
    }

    #[test]
    fn the_transcript_names_both_speakers() {
        let history = vec![
            message("system", "ignoreras"),
            message("user", "Vad är fotosyntes?"),
            message("assistant", "Växter gör socker av ljus."),
        ];

        assert_eq!(
            transcript(&history),
            "Elev: Vad är fotosyntes?\n\nLumi: Växter gör socker av ljus."
        );
    }
}
