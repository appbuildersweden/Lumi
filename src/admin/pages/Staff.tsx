import { Users } from "lucide-react";
import PersonAdmin from "../PersonAdmin";
import type { AdminPageProps } from "../types";

/** Personal: lärare och övrig personal, med ämnen och konton. */
export default function Staff(props: AdminPageProps) {
  return (
    <PersonAdmin
      {...props}
      kind="personal"
      badge={<Users size={24} strokeWidth={1.8} aria-hidden />}
      eyebrow="Adminpanel"
      title="Personal"
      lead="Lärare och övrig personal. Ett personalkonto får rollen Lärare och kommer inte in i adminpanelen."
      withSubjects
    />
  );
}
