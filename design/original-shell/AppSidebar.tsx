import { useEffect, useId, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { BrandLogo } from "../brand/BrandLogo";
import { loadBillingFromDb, loadIntegrationsFromDb, type PlanId } from "../api/db";
import { PROJECT_SLOT_LIMIT, sitesLabel } from "../project/projects";
import { useProjects } from "../project/ProjectsContext";
import { ProjectMark } from "../components/ProjectMark";
import { useProfile } from "../yandex/ProfileContext";
import { useDemoMode } from "./DemoModeContext";
import "./shell.css";

const navAnalytics: {
  to: string;
  label: string;
  badge?: string;
  badgeTone?: string;
}[] = [
  { to: "/dashboard", label: "Дашборд" },
  { to: "/reports", label: "Все отчёты" },
];

const FALLBACK_PLAN_ID: PlanId = "pro";
const FALLBACK_PLAN_LABEL = "Про";
const AI_REPORTS_LIMIT = 20;
const AI_REPORTS_USED = 0;
const GATEWAY_TOTAL = 3;

const PLAN_BADGE_TONE: Record<PlanId, string> = {
  start: "plan-standard",
  pro: "plan-pro",
  agency: "plan-agency",
};

function planChipClass(planId: PlanId): string {
  return planId === "start" ? "standard" : planId;
}

function Badge({
  children,
  tone = "primary",
}: {
  children: string;
  tone?: string;
}) {
  return <span className={`shell-badge shell-badge--${tone}`}>{children}</span>;
}

function CompanySwitcher() {
  const { projects, active, activeId, setActiveId, loading } = useProjects();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!active) {
    return (
      <div className="shell-project shell-project--empty">
        <span className="material-symbols-outlined shell-project__avatar" aria-hidden>
          add_business
        </span>
        <span className="shell-project__meta">
          <span className="shell-project__title">
            {loading ? "Загрузка…" : "Нет проектов"}
          </span>
          <span className="shell-project__sub">
            {loading ? "из MariaDB" : "Создайте в настройках"}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="shell-project-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`shell-project${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Выбрать компанию"
        onClick={() => setOpen((v) => !v)}
      >
        <ProjectMark
          icon={active.icon}
          color={active.color}
          mark={active.mark}
          size="sm"
          className="shell-project__avatar"
        />
        <span className="shell-project__meta">
          <span className="shell-project__title">{active.short}</span>
          <span className="shell-project__sub shell-project__sites-count">
            <span className="material-symbols-outlined" aria-hidden>
              language
            </span>
            {sitesLabel(active.sitesCount)}
          </span>
        </span>
        <span className="material-symbols-outlined shell-project__chevron" aria-hidden>
          unfold_more
        </span>
      </button>

      {open ? (
        <div id={menuId} className="shell-project__panel" role="menu">
          <div className="shell-project__sites-label">Компании профиля</div>
          <ul className="shell-project__sites">
            {projects.map((item) => {
              const selected = item.id === activeId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`shell-project__site${selected ? " is-active" : ""}`}
                    onClick={() => {
                      setActiveId(item.id);
                      setOpen(false);
                    }}
                  >
                    <ProjectMark
                      icon={item.icon}
                      color={item.color}
                      mark={item.mark}
                      size="sm"
                      className="shell-project__avatar"
                    />
                    <span className="shell-project__site-main">
                      <span className="shell-project__site-host">{item.name}</span>
                      <span className="shell-project__company-meta shell-project__sites-count">
                        <span className="material-symbols-outlined" aria-hidden>
                          language
                        </span>
                        {sitesLabel(item.sitesCount)}
                      </span>
                    </span>
                    {selected ? (
                      <span className="material-symbols-outlined shell-project__check" aria-hidden>
                        check
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DemoDataToggle() {
  const { demoMode, setDemoMode } = useDemoMode();
  return (
    <div className="shell-demo">
      <span className="shell-demo__label" id="svodka-demo-label">
        Демо-данные
      </span>
      <button
        type="button"
        className={`shell-switch${demoMode ? " is-on" : ""}`}
        role="switch"
        aria-checked={demoMode}
        aria-labelledby="svodka-demo-label"
        onClick={() => setDemoMode(!demoMode)}
      >
        <span className="shell-switch__knob" aria-hidden />
      </button>
    </div>
  );
}

export function AppSidebar() {
  const { connected, profile, loading } = useProfile();
  const { projects } = useProjects();
  const [integrationsOk, setIntegrationsOk] = useState(0);
  const [planId, setPlanId] = useState<PlanId>(FALLBACK_PLAN_ID);
  const [planLabel, setPlanLabel] = useState(FALLBACK_PLAN_LABEL);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!profile?.id) {
        setIntegrationsOk(0);
        setPlanId(FALLBACK_PLAN_ID);
        setPlanLabel(FALLBACK_PLAN_LABEL);
        return;
      }
      try {
        const [rows, billing] = await Promise.all([
          loadIntegrationsFromDb(profile.id),
          loadBillingFromDb(profile.id).catch(() => null),
        ]);
        if (cancelled) return;
        setIntegrationsOk(
          rows.filter(
            (r) =>
              r.status === "connected" ||
              r.status === "empty" ||
              r.status === "dev",
          ).length,
        );
        const sub = billing?.subscription;
        setPlanId(sub?.plan || FALLBACK_PLAN_ID);
        setPlanLabel(sub?.planLabel || FALLBACK_PLAN_LABEL);
      } catch {
        if (!cancelled) {
          setIntegrationsOk(0);
          setPlanId(FALLBACK_PLAN_ID);
          setPlanLabel(FALLBACK_PLAN_LABEL);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  const displayName =
    profile?.name ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() ||
    (loading && connected ? "Загрузка…" : "Гость");
  const displayEmail =
    profile?.email ||
    (profile?.login ? `@${profile.login}` : null) ||
    (connected ? "email загружается…" : "войдите через Яндекс");
  const initials = profile?.initials || (connected ? "…" : "?");
  const projectSlotsUsed = projects.length;
  const aiPct = Math.min(
    100,
    Math.round((AI_REPORTS_USED / AI_REPORTS_LIMIT) * 100),
  );

  const navInfra = useMemo(
    () => [
      {
        to: "/integrations",
        label: "Интеграции",
        badge: `${integrationsOk}/${GATEWAY_TOTAL}`,
        badgeTone: integrationsOk >= GATEWAY_TOTAL ? "ok" : "muted",
      },
      { to: "/settings/project", label: "Настройки проекта" },
      {
        to: "/billing",
        label: "Тарифы & Биллинг",
        badge: planLabel,
        badgeTone: PLAN_BADGE_TONE[planId],
      },
      { to: "/admin", label: "Админка", badge: "SUP", badgeTone: "sky" },
    ],
    [integrationsOk, planId, planLabel],
  );

  return (
    <aside className="shell-sidebar">
      <div className="shell-sidebar__brand">
        <div className="shell-sidebar__brand-row">
          <BrandLogo to="/dashboard" />
        </div>
      </div>

      <div className="shell-sidebar__cta">
        <DemoDataToggle />
      </div>

      <div className="shell-sidebar__project">
        <CompanySwitcher />
      </div>

      <nav className="shell-nav">
        <div className="shell-nav__section">Аналитика</div>
        {navAnalytics.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `shell-nav__item${isActive ? " is-active" : ""}`
            }
          >
            <span>{item.label}</span>
            {item.badge ? <Badge tone={item.badgeTone}>{item.badge}</Badge> : null}
          </NavLink>
        ))}

        <div className="shell-nav__section">Инфраструктура</div>
        {navInfra.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `shell-nav__item${isActive ? " is-active" : ""}`
            }
          >
            <span>{item.label}</span>
            {item.badge ? (
              <Badge tone={item.badgeTone}>{item.badge}</Badge>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="shell-sidebar__foot">
        <div className="shell-quota">
          <div className="shell-quota__row">
            <span>Лимит отчётов</span>
            <strong>
              {AI_REPORTS_USED} <span>/ {AI_REPORTS_LIMIT}</span>
            </strong>
          </div>
          <div className="shell-quota__bar">
            <i style={{ width: `${aiPct}%` }} />
          </div>
          <div className="shell-quota__row shell-quota__row--muted">
            <span>
              Проекты {projectSlotsUsed}/{PROJECT_SLOT_LIMIT} · {planLabel}
            </span>
            <NavLink to="/billing">Увеличить</NavLink>
          </div>
        </div>

        <NavLink to="/settings" className="shell-user" title={displayEmail}>
          {profile?.avatarUrl ? (
            <img
              className="shell-user__avatar shell-user__avatar--img"
              src={profile.avatarUrl}
              alt=""
              width={32}
              height={32}
            />
          ) : (
            <div className="shell-user__avatar">{initials}</div>
          )}
          <div className="shell-user__meta">
            <div className="shell-user__name-row">
              <div className="shell-user__name">{displayName}</div>
              <span className={`shell-badge shell-badge--plan shell-badge--plan-${planChipClass(planId)}`}>
                {planLabel}
              </span>
            </div>
            <div className="shell-user__role">{displayEmail}</div>
          </div>
        </NavLink>

        <NavLink to="/login" className="shell-logout" title="Выйти из аккаунта">
          <span className="material-symbols-outlined shell-logout__icon" aria-hidden>
            logout
          </span>
          Выйти
        </NavLink>
      </div>
    </aside>
  );
}
