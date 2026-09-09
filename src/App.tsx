import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { StitchFrame } from "./components/StitchFrame";
import { AppShell } from "./layout/AppShell";
import { SCREENS } from "./screens";
import { IndexPage } from "./pages/IndexPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { OAuthCallbackPage } from "./pages/OAuthCallbackPage";
import { OAuthStartPage } from "./pages/OAuthStartPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ProjectSettingsPage } from "./pages/ProjectSettingsPage";
import { BillingPage } from "./pages/BillingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ReportConfigurePage } from "./pages/ReportConfigurePage";
import { ProfileProvider } from "./yandex/ProfileContext";
import { ProjectsProvider } from "./project/ProjectsContext";

function ShellPage({
  folder,
  title,
}: {
  folder: string;
  title: string;
}) {
  return <StitchFrame folder={folder} title={title} inShell />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ProfileProvider>
        <ProjectsProvider>
        <Routes>
          {/* Клиентский лендинг — без shell */}
          <Route path="/" element={<StitchFrame folder={SCREENS.home.folder} title={SCREENS.home.title} />} />
          {/* Вход тоже без shell (до приложения) */}
          <Route path="/login" element={<StitchFrame folder={SCREENS.login.folder} title={SCREENS.login.title} />} />
          <Route path="/map" element={<IndexPage />} />
          <Route path="/oauth/start" element={<OAuthStartPage />} />
          <Route path="/oauth/callback" element={<OAuthCallbackPage />} />

          {/* Все экраны продукта — эталонный сайдбар + топбар */}
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route
              path="/reports/library"
              element={<ShellPage folder={SCREENS.reportsAlt.folder} title={SCREENS.reportsAlt.title} />}
            />
            <Route
              path="/reports/configure"
              element={<ReportConfigurePage />}
            />
            <Route
              path="/reports/generating"
              element={<ShellPage folder={SCREENS.generating.folder} title={SCREENS.generating.title} />}
            />
            <Route
              path="/reports/demo"
              element={<ShellPage folder={SCREENS.reportDemo.folder} title={SCREENS.reportDemo.title} />}
            />
            <Route
              path="/reports/express"
              element={
                <ShellPage folder={SCREENS.reportExpress.folder} title={SCREENS.reportExpress.title} />
              }
            />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/settings" element={<ProfilePage />} />
            <Route path="/settings/project" element={<ProjectSettingsPage />} />
            <Route
              path="/admin"
              element={<ShellPage folder={SCREENS.admin.folder} title={SCREENS.admin.title} />}
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ProjectsProvider>
      </ProfileProvider>
    </BrowserRouter>
  );
}
