import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { LoginPage } from "./auth/LoginPage";
import { TodayPage } from "./pages/TodayPage";
import { PlanPage } from "./pages/PlanPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HistoryDetailPage } from "./pages/HistoryDetailPage";
import { InsightsPage } from "./pages/InsightsPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/today"
            element={
              <RequireAuth>
                <TodayPage />
              </RequireAuth>
            }
          />
          <Route
            path="/plan"
            element={
              <RequireAuth>
                <PlanPage />
              </RequireAuth>
            }
          />
          <Route
            path="/history"
            element={
              <RequireAuth>
                <HistoryPage />
              </RequireAuth>
            }
          />
          <Route
            path="/history/:decisionId"
            element={
              <RequireAuth>
                <HistoryDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/insights"
            element={
              <RequireAuth>
                <InsightsPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
