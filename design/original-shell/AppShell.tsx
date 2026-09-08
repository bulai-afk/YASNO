import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { touchCurrentSession } from "../sessions/deviceSessions";
import { AppSidebar } from "./AppSidebar";
import { AppTopbar } from "./AppTopbar";
import { DemoModeProvider } from "./DemoModeContext";
import "./shell.css";

export function AppShell() {
  useEffect(() => {
    void touchCurrentSession();
  }, []);

  return (
    <DemoModeProvider>
      <div className="shell-root">
        <AppSidebar />
        <div className="shell-main">
          <AppTopbar />
          <div className="shell-content">
            <Outlet />
          </div>
        </div>
      </div>
    </DemoModeProvider>
  );
}
