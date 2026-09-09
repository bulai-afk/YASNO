import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createReportInDb,
  saveReportTemplateToDb,
  type ReportConfiguration,
} from "../api/db";
import { StitchFrame } from "../components/StitchFrame";
import { useProjects } from "../project/ProjectsContext";
import { SCREENS } from "../screens";
import { useProfile } from "../yandex/ProfileContext";

type ConfigureBridgeMessage = {
  type?: string;
  requestId?: string;
  configuration?: Partial<ReportConfiguration>;
  name?: string;
};

export function ReportConfigurePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useProfile();
  const { active } = useProjects();
  const [frameCommand, setFrameCommand] = useState<Record<string, unknown>>({
    type: "svodka:configure:init",
  });

  const initPayload = useMemo(
    () => ({
      type: "svodka:configure:init",
      defaultReportType:
        searchParams.get("type") === "express" ? "express" : "full",
      project: active
        ? {
            id: active.id,
            name: active.name,
            short: active.short,
            sites: active.sites,
          }
        : null,
    }),
    [active, searchParams],
  );

  const reply = useCallback(
    (
      requestId: string | undefined,
      state: "busy" | "success" | "error",
      message: string,
    ) => {
      setFrameCommand({
        type: "svodka:configure:state",
        requestId,
        state,
        message,
        nonce: Date.now(),
      });
    },
    [],
  );

  const handleBridgeMessage = useCallback(
    async (raw: unknown) => {
      const message = raw as ConfigureBridgeMessage;
      if (
        message?.type !== "svodka:report:create" &&
        message?.type !== "svodka:report:template"
      ) {
        return;
      }
      if (!profile?.id) {
        reply(
          message.requestId,
          "error",
          "Сначала войдите в аккаунт и подключите источники данных.",
        );
        return;
      }
      if (!active) {
        reply(message.requestId, "error", "Сначала создайте и выберите проект.");
        return;
      }

      const incoming = message.configuration || {};
      const requestedHost = String(incoming.siteHost || "").toLowerCase();
      const siteHost =
        active.sites.find((site) => site.toLowerCase() === requestedHost) ||
        active.sites[0];
      if (!siteHost) {
        reply(message.requestId, "error", "В проекте нет сайта для отчёта.");
        return;
      }

      const configuration: ReportConfiguration = {
        projectId: active.id,
        siteHost,
        reportType: incoming.reportType || "full",
        title: incoming.title,
        period: {
          from: String(incoming.period?.from || ""),
          to: String(incoming.period?.to || ""),
          compareFrom: incoming.period?.compareFrom,
          compareTo: incoming.period?.compareTo,
        },
        comparison: incoming.comparison !== false,
        sources: Array.isArray(incoming.sources) ? incoming.sources : [],
        goals: Array.isArray(incoming.goals) ? incoming.goals : [],
        directives: Array.isArray(incoming.directives)
          ? incoming.directives
          : [],
        outputs: Array.isArray(incoming.outputs)
          ? incoming.outputs
          : ["web", "pdf"],
      };

      reply(message.requestId, "busy", "Сохраняем параметры…");
      try {
        if (message.type === "svodka:report:template") {
          const { projectId, ...templateConfig } = configuration;
          await saveReportTemplateToDb(
            profile.id,
            projectId,
            message.name || `Шаблон · ${siteHost}`,
            templateConfig,
          );
          reply(message.requestId, "success", "Шаблон сохранён.");
          return;
        }
        const report = await createReportInDb(profile.id, configuration);
        reply(message.requestId, "success", "Задание создано.");
        navigate(`/reports/generating?id=${encodeURIComponent(report.id)}`);
      } catch (error) {
        reply(
          message.requestId,
          "error",
          error instanceof Error ? error.message : "Не удалось создать отчёт.",
        );
      }
    },
    [active, navigate, profile?.id, reply],
  );

  return (
    <StitchFrame
      folder={SCREENS.configure.folder}
      title={SCREENS.configure.title}
      inShell
      bridgePayload={
        frameCommand.type === "svodka:configure:init"
          ? initPayload
          : frameCommand
      }
      onBridgeMessage={handleBridgeMessage}
    />
  );
}