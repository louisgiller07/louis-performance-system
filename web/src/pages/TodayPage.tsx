import { useAuth } from "../auth/AuthContext";

// Placeholder for M4_001 — check-in / DailyPlan land in a later M4 task.
export function TodayPage() {
  const { user, signOut } = useAuth();

  return (
    <div className="mx-auto mt-24 max-w-sm p-6 text-center">
      <h1 className="mb-2 text-xl font-semibold text-gray-900">Today — M4 coming next</h1>
      <p className="mb-6 text-sm text-gray-500">Signed in as {user?.email}</p>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
      >
        Log out
      </button>
    </div>
  );
}
