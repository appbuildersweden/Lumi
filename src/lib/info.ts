import {
  AUDIENCE_LABELS,
  PRIORITY_LABELS,
  PRIORITY_RANK,
  type AdminMessage,
  type Priority,
} from "./backend";

/**
 * Skolans information, sorterad så som den ska läsas: det akuta först och
 * därefter det senaste. Samma ordning används på elevens startsida och i
 * informationsvyerna, så att viktiga meddelanden aldrig hamnar underst.
 */
export function sortMessages(messages: AdminMessage[]): AdminMessage[] {
  return [...messages].sort(
    (a, b) =>
      PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
      b.createdAtMs - a.createdAtMs
  );
}

/**
 * Vem posten gäller, i klartext.
 *
 * Klassen och gruppen namnges så att mottagaren syns i kortet. Namnen på
 * eleverna visas bara för den som får publicera – en elev ser bara att posten
 * gäller en grupp.
 */
export function audienceText(message: AdminMessage): string {
  if (message.audience === "klass") {
    return message.classNames.length > 0
      ? `Klass ${message.classNames.join(", ")}`
      : "Klass";
  }

  if (message.audience === "grupp") {
    const count = message.studentIds.length;
    if (count === 0) return "Grupp";
    return count === 1 ? "1 elev" : `Grupp med ${count} elever`;
  }

  return AUDIENCE_LABELS[message.audience];
}

/** Vikten i klartext. */
export function priorityText(priority: Priority): string {
  return PRIORITY_LABELS[priority];
}

/** Sant när posten är märkt som något annat än normal. */
export function isNoteworthy(message: AdminMessage): boolean {
  return message.priority !== "normal";
}
