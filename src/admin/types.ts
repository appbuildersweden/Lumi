import type { PublicUser } from "../lib/backend";
import type { AdminViewId } from "./nav";
import type { AdminDataState } from "./useAdminData";

/** Det varje sida i adminpanelen får. */
export interface AdminPageProps {
  /** Det inloggade administratörskontot, från backend. */
  user: PublicUser;
  /** All data panelen behöver, plus `reload` och `error`. */
  data: AdminDataState;
  /** Byt kategori. */
  go: (view: AdminViewId) => void;
  onSignOut: () => void;
  /**
   * När kontot själv har ändrats – till exempel ett nytt namn i profilen – så
   * att sidopanelen visar samma namn som backend sparade.
   */
  onUserChange?: (user: PublicUser) => void;
  /** Eleven som översikten ska öppnas på, när man kommer från elevlistan. */
  focusStudentId?: string;
  /** Öppnar elevöversikten för en bestämd elev. */
  focusStudent?: (personId: string) => void;
}
