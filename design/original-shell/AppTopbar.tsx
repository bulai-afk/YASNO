import { useCallback, useEffect, useId, useRef, useState } from "react";
import { loadIntegrationsFromDb, loadSyncStatus } from "../api/db";
import { useProfile } from "../yandex/ProfileContext";
import "./shell.css";

type NoticeTone = "ok" | "warn" | "info" | "alert";

const notices: {
  id: string;
  tone: NoticeTone;
  title: string;
  body: string;
  time: string;
  unread?: boolean;
}[] = [
  {
    id: "1",
    tone: "alert",
    title: "Аномалия CPA в Директе",
    body: "Кампания «Лидоген · Минск» превысила норму на 28% за последние 2 часа.",
    time: "12:18",
    unread: true,
  },
  {
    id: "2",
    tone: "ok",
    title: "Отчёт готов",
    body: "Экспресс-сводка «7 дней · Метрика + Директ» сформирована.",
    time: "11:52",
    unread: true,
  },
  {
    id: "3",
    tone: "info",
    title: "Синхронизация шлюзов",
    body: "Яндекс Метрика, Директ и Вебмастер обновлены без ошибок.",
    time: "11:40",
  },
  {
    id: "4",
    tone: "warn",
    title: "Лимит отчётов",
    body: "Использовано 11 из 15 отчётов на тарифе Pro до конца периода.",
    time: "вчера",
  },
];

const toneIcon: Record<NoticeTone, string> = {
  alert: "warning",
  warn: "priority_high",
  ok: "check_circle",
  info: "sync",
};

const GATEWAY_TOTAL = 3;

type SyncUi = {
  gatewaysOk: number;
  phase: string | null;
  progressPct: number;
  updatedLabel: string;
  ping: "ok" | "busy" | "warn" | "off";
};

function formatByt(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Minsk",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${time} BYT`;
}

function gatewaysLabel(ok: number): string {
  if (ok >= GATEWAY_TOTAL) return `● Все ${GATEWAY_TOTAL} шлюза`;
  if (ok <= 0) return "● Шлюзы оффлайн";
  return `● Шлюзы ${ok} из ${GATEWAY_TOTAL}`;
}

export function AppTopbar() {
  const { profile, connected } = useProfile();
  const [open, setOpen] = useState(false);
  const [syncUi, setSyncUi] = useState<SyncUi>({
    gatewaysOk: 0,
    phase: null,
    progressPct: 0,
    updatedLabel: "—",
    ping: "off",
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const unread = notices.filter((n) => n.unread).length;

  const refreshSync = useCallback(async () => {
    if (!connected || !profile?.id) {
      setSyncUi({
        gatewaysOk: 0,
        phase: null,
        progressPct: 0,
        updatedLabel: "—",
        ping: "off",
      });
      return;
    }
    try {
      const [integrations, sync] = await Promise.all([
        loadIntegrationsFromDb(profile.id),
        loadSyncStatus(profile.id),
      ]);
      const gatewaysOk = integrations.filter((row) =>
        ["connected", "empty", "dev"].includes(row.status),
      ).length;
      const phase = sync.job?.phase ?? null;
      const progressPct = Number(sync.job?.progressPct ?? 0);
      const updated =
        formatByt(sync.job?.lastRunAt) ||
        formatByt(sync.job?.updatedAt) ||
        (sync.stats.maxDay ? formatByt(`${sync.stats.maxDay}T12:00:00`) : null) ||
        "—";

      let ping: SyncUi["ping"] = "ok";
      if (phase === "backfill" || phase === "daily") ping = "busy";
      else if (phase === "error" || gatewaysOk === 0) ping = "warn";
      else if (!connected) ping = "off";

      setSyncUi({
        gatewaysOk,
        phase,
        progressPct,
        updatedLabel: updated,
        ping,
      });
    } catch {
      setSyncUi((prev) => ({ ...prev, ping: "warn" }));
    }
  }, [connected, profile?.id]);

  useEffect(() => {
    void refreshSync();
    const id = window.setInterval(() => void refreshSync(), 15000);
    return () => window.clearInterval(id);
  }, [refreshSync]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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

  const title =
    syncUi.phase === "backfill"
      ? `Синхронизация · ${syncUi.progressPct}%`
      : syncUi.phase === "daily"
        ? "Синхронизация · сегодня"
        : syncUi.phase === "error"
          ? "Синхронизация · ошибка"
          : "Синхронизация Яндекс";

  return (
    <header className="shell-topbar">
      <div className="shell-topbar__left">
        <div
          className={`shell-pill shell-pill--${syncUi.ping}`}
          title={
            syncUi.phase === "backfill"
              ? "Идёт первичная выгрузка истории в БД"
              : syncUi.phase === "daily"
                ? "Обновление вчерашних данных"
                : "Статус синхронизации Яндекс"
          }
        >
          <span className={`shell-ping shell-ping--${syncUi.ping}`}>
            <i />
            <b />
          </span>
          <span>{title}</span>
          <em>{gatewaysLabel(syncUi.gatewaysOk)}</em>
        </div>
        <div className="shell-stamp">
          Обновлено: <strong>{syncUi.updatedLabel}</strong>
        </div>
      </div>

      <div className="shell-topbar__right">
        <div className="shell-topbar__search">
          <input
            readOnly
            placeholder="Быстрый поиск по отчётам, кампаниям и метрикам..."
          />
          <kbd>⌘</kbd>
          <kbd>K</kbd>
        </div>

        <div className="shell-notify" ref={wrapRef}>
          <button
            type="button"
            className={`shell-icon-btn${open ? " is-open" : ""}`}
            aria-label="Уведомления"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
          >
            {unread > 0 ? <span className="shell-icon-btn__dot" /> : null}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </button>

          {open ? (
            <div
              id={menuId}
              className="shell-notify__panel"
              role="menu"
              aria-label="Центр уведомлений"
            >
              <div className="shell-notify__head">
                <div>
                  <div className="shell-notify__title">Уведомления</div>
                  <div className="shell-notify__sub">Аномалии, синхронизация и отчёты</div>
                </div>
                {unread > 0 ? (
                  <span className="shell-badge shell-badge--soft">{unread} новых</span>
                ) : null}
              </div>

              <ul className="shell-notify__list">
                {notices.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="shell-notify__item" role="menuitem">
                      <span className={`shell-notify__icon shell-notify__icon--${item.tone}`}>
                        <span className="material-symbols-outlined" aria-hidden>
                          {toneIcon[item.tone]}
                        </span>
                      </span>
                      <span className="shell-notify__body">
                        <span className="shell-notify__row">
                          <span className="shell-notify__item-title">
                            {item.unread ? <i className="shell-notify__unread" /> : null}
                            {item.title}
                          </span>
                          <time className="shell-notify__time">{item.time}</time>
                        </span>
                        <span className="shell-notify__text">{item.body}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="shell-notify__foot">
                <button type="button" className="shell-notify__link">
                  Отметить все прочитанными
                </button>
                <button type="button" className="shell-notify__link shell-notify__link--accent">
                  Все уведомления
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
