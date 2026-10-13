import { useCallback, useEffect, useState } from "react";
import {
  getAdminOverview,
  listAccounts,
  listActivity,
  listAdminMessages,
  listAssignments,
  listExamResults,
  listExams,
  listPeople,
  listRoles,
  listSchedule,
  listSubmissions,
  toLumiError,
  type AccountRow,
  type ActivityEntry,
  type AdminMessage,
  type AdminOverview,
  type Assignment,
  type Exam,
  type ExamResult,
  type Person,
  type RoleInfo,
  type ScheduleEntry,
  type Submission,
} from "../lib/backend";

export interface AdminData {
  overview: AdminOverview | null;
  people: Person[];
  accounts: AccountRow[];
  roles: RoleInfo[];
  assignments: Assignment[];
  submissions: Submission[];
  exams: Exam[];
  examResults: ExamResult[];
  schedule: ScheduleEntry[];
  messages: AdminMessage[];
  activity: ActivityEntry[];
}

const EMPTY: AdminData = {
  overview: null,
  people: [],
  accounts: [],
  roles: [],
  assignments: [],
  submissions: [],
  exams: [],
  examResults: [],
  schedule: [],
  messages: [],
  activity: [],
};

/**
 * Hämtar all data adminpanelen behöver, en gång per omladdning.
 *
 * Backend svarar bara för ett inloggat administratörskonto. Nekar den, visas
 * felet i gränssnittet i stället för en tom panel som ser ut att fungera.
 */
export function useAdminData() {
  const [data, setData] = useState<AdminData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        overview,
        people,
        accounts,
        roles,
        assignments,
        submissions,
        exams,
        examResults,
        schedule,
        messages,
        activity,
      ] = await Promise.all([
        getAdminOverview(),
        listPeople(),
        listAccounts(),
        listRoles(),
        listAssignments(),
        listSubmissions(),
        listExams(),
        listExamResults(),
        listSchedule(),
        listAdminMessages(),
        listActivity(200),
      ]);

      setData({
        overview,
        people,
        accounts,
        roles,
        assignments,
        submissions,
        exams,
        examResults,
        schedule,
        messages,
        activity,
      });
    } catch (raw) {
      setError(toLumiError(raw).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...data, loading, error, reload };
}

export type AdminDataState = ReturnType<typeof useAdminData>;
