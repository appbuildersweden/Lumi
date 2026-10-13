import { GraduationCap } from "lucide-react";
import PersonAdmin from "../PersonAdmin";
import type { AdminPageProps } from "../types";

/** Elevregistret: profiler, klass och koppling till konto. */
export default function Students(props: AdminPageProps) {
  return (
    <PersonAdmin
      {...props}
      kind="elever"
      badge={<GraduationCap size={24} strokeWidth={1.8} aria-hidden />}
      eyebrow="Adminpanel"
      title="Elever"
      lead="Alla elever i Lumi. Registrera en elev och ge eleven ett konto från samma sida."
      withSubjects={false}
    />
  );
}
