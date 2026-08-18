import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { LoginPage } from "./auth/LoginPage";
import { TodayPage } from "./pages/TodayPage";

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
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
