import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isYandexConnected } from "../yandex/auth";
import "./product.css";

type ReportStatus = "ready" | "draft" | "archive";

type ReportItem = {
  id: string;
  title: string;
  createdAt: string;
  period: string;
  channels: Array<"metrika" | "direct" | "webmaster">;
  insight: string;
  status: ReportStatus;
  format: "PDF" | "WEB";
  path: string;
  icon: string;
};

const DEMO_REPORTS: ReportItem[] = [
  {
    id: "1",
    title: "Сводный аудит маркетинга (Ноябрь 2024)",
    createdAt: "24 ноября 2024, 18:20",
    period: "Полный цикл",
    channels: ["metrika", "direct", "webmaster"],
    insight: "+22.4% конверсий за счёт чистки нецелевых запросов Директа",
    status: "ready",
    format: "PDF",
    path: "/reports/demo",
    icon: "stacked_line_chart",
  },
  {
    id: "2",
    title: "Еженедельный срез Директа (Неделя 47)",
    createdAt: "Сегодня, 09:15",
    period: "Автоматический срез",
    channels: ["direct"],
    insight: "Выявлен слив бюджета 340 BYN в ночное время",
    status: "ready",
    format: "WEB",
    path: "/reports/demo",
    icon: "ads_click",
  },
  {
    id: "3",
    title: "Экспресс-сводка · 7 дней",
    createdAt: "Вчера, 11:05",
    period: "7 дней",
    channels: ["metrika", "direct"],
    insight: "CPA в поиске выше нормы на 18% — проверить ставки по бренду",
    status: "ready",
    format: "WEB",
    path: "/reports/express",
    icon: "bolt",
  },
  {
    id: "4",
    title: "Аудит поисковой видимости и ошибок",
    createdAt: "15 ноября 2024, 14:00",
    period: "Технический аудит",
    channels: ["webmaster"],
    insight: "12 страниц с долгим ответом сервера (TTFB > 1.5s)",
    status: "ready",
    format: "PDF",
    path: "/reports/demo",
    icon: "travel_explore",
  },
  {
    id: "5",
    title: "РСЯ: эффективность площадок",
    createdAt: "1 нед. назад",
    period: "Минус-площадки",
    channels: ["direct", "metrika"],
    insight: "Отключено 8 площадок — экономия ~180 BYN / нед.",
    status: "ready",
    format: "WEB",
    path: "/reports/demo",
    icon: "campaign",
  },
  {
    id: "6",
    title: "Бренд vs небренд в поиске",
    createdAt: "1 нед. назад",
    period: "Директ + Вебмастер",
    channels: ["direct", "webmaster"],
    insight: "Небренд даёт 61% лидов при 44% расхода",
    status: "ready",
    format: "PDF",
    path: "/reports/demo",
    icon: "travel_explore",
  },
  {
    id: "7",
    title: "Октябрьский сквозной отчёт",
    createdAt: "31 октября 2024, 23:59",
    period: "Закрытый период",
    channels: ["metrika", "direct"],
    insight: "Итоговый расход 4,120 BYN, 980 лидов, CPA −9%",
    status: "archive",
    format: "PDF",
    path: "/reports/demo",
    icon: "folder_zip",
  },
  {
    id: "8",
    title: "Диагностика ИКС и сниппетов",
    createdAt: "3 нед. назад",
    period: "Вебмастер",
    channels: ["webmaster"],
    insight: "ИКС 420, в ТОП-10 — 184 запроса",
    status: "archive",
    format: "PDF",
    path: "/reports/demo",
    icon: "query_stats",
  },
  {
    id: "9",
    title: "Черновик: недельный срез",
    createdAt: "Сегодня",
    period: "7 дней",
    channels: ["metrika", "direct", "webmaster"],
    insight: "Ожидает генерации после синхронизации шлюзов",
    status: "draft",
    format: "WEB",
    path: "/reports/configure",
    icon: "edit_note",
  },
];

const channelMeta = {
  metrika: { icon: "query_stats", title: "Яндекс Метрика" },
  direct: { icon: "ads_click", title: "Яндекс Директ" },
  webmaster: { icon: "travel_explore", title: "Яндекс Вебмастер" },
} as const;

const PAGE_SIZE = 4;

type FilterKey = "all" | "nov" | "oct" | "weekly" | "seo";

const statusLabel: Record<ReportStatus, string> = {
  ready: "Готов",
  draft: "Черновик",
  archive: "В архиве",
};

export function ReportsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [page, setPage] = useState(1);
  const connected = isYandexConnected();

  useEffect(() => {
    document.title = "Аналитические отчёты · SVODKA";
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DEMO_REPORTS.filter((r) => {
      if (filter === "nov" && !/ноябрь/i.test(r.title + r.createdAt)) return false;
      if (filter === "oct" && !/октябр/i.test(r.title + r.createdAt)) return false;
      if (filter === "weekly" && !/7 дн|недел/i.test(r.title + r.period + r.createdAt))
        return false;
      if (filter === "seo" && !/seo|вебмастер|икс|индекс/i.test(r.title + r.insight))
        return false;
      if (!q) return true;
      return `${r.title} ${r.period} ${r.insight}`.toLowerCase().includes(q);
    });
  }, [query, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, filter]);

  const readyCount = DEMO_REPORTS.filter((r) => r.status === "ready").length;

  return (
    <div className="product-page">
      <header className="product-head">
        <div>
          <h1>Аналитические отчёты</h1>
          <p>Архив сформированных сквозных аудитов по проектам ООО БелТрейд</p>
        </div>
        <div className="product-actions">
          <button type="button" className="product-btn" disabled>
            <span className="material-symbols-outlined" aria-hidden>
              calendar_month
            </span>
            90 дней
          </button>
          <button
            type="button"
            className="product-btn product-btn--primary"
            onClick={() => navigate("/reports/configure")}
          >
            <span className="material-symbols-outlined" aria-hidden>
              auto_awesome
            </span>
            Сформировать отчёт
          </button>
        </div>
      </header>

      {!connected ? (
        <div className="product-banner product-banner--warn">
          Яндекс ещё не подключён — отчёты пока демо.{" "}
          <Link to="/integrations">Подключить Метрику, Директ и Вебмастер →</Link>
        </div>
      ) : (
        <div className="product-banner product-banner--ok">
          Шлюзы Яндекс подключены. Данные для новых отчётов можно брать со{" "}
          <Link to="/integrations">страницы интеграций</Link>.
        </div>
      )}

      <div className="product-stats">
        <article className="product-stat">
          <div className="product-stat__label">Всего отчётов</div>
          <div className="product-stat__value">{DEMO_REPORTS.length}</div>
          <div className="product-muted">в локальном архиве</div>
        </article>
        <article className="product-stat">
          <div className="product-stat__label">Готовых</div>
          <div className="product-stat__value product-stat__value--ok">{readyCount}</div>
          <div className="product-muted">можно открыть</div>
        </article>
        <article className="product-stat">
          <div className="product-stat__label">Синхронизация</div>
          <div className="product-stat__value">{connected ? "online" : "demo"}</div>
          <div className="product-muted">
            {connected ? "OAuth активен" : "без токена · демо-данные"}
          </div>
        </article>
      </div>

      <div className="product-express">
        <div className="product-express__copy">
          <div className="product-express__icon" aria-hidden>
            <span className="material-symbols-outlined">neurology</span>
          </div>
          <div>
            <strong>Экспресс-аудит за последние 7 дней</strong>
            <p>Метрика, Директ и Вебмастер → 5 ключевых рекомендаций.</p>
          </div>
        </div>
        <div className="product-actions">
          <button
            type="button"
            className="product-btn"
            onClick={() => navigate("/reports/configure")}
          >
            Настроить параметры
          </button>
          <button
            type="button"
            className="product-btn product-btn--primary"
            onClick={() => navigate("/reports/configure?type=express")}
          >
            <span className="material-symbols-outlined" aria-hidden>
              bolt
            </span>
            Сформировать экспресс-отчёт
          </button>
        </div>
      </div>

      <div className="product-toolbar">
        <label className="product-search">
          <span className="material-symbols-outlined" aria-hidden>
            search
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию или периоду..."
          />
        </label>
        <div className="product-filters">
          {(
            [
              ["all", `Все ${DEMO_REPORTS.length}`],
              ["nov", "Ноябрь"],
              ["oct", "Октябрь"],
              ["weekly", "Еженедельные"],
              ["seo", "SEO"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`product-filter${filter === key ? " is-active" : ""}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="product-table-wrap">
        <table className="product-table">
          <thead>
            <tr>
              <th>Название и период</th>
              <th>Каналы</th>
              <th>Ключевой инсайт</th>
              <th>Статус</th>
              <th className="is-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((report) => (
              <tr key={report.id}>
                <td>
                  <div className="product-report-title">
                    <span className="product-report-icon" aria-hidden>
                      <span className="material-symbols-outlined">{report.icon}</span>
                    </span>
                    <div>
                      <Link to={report.path}>{report.title}</Link>
                      <div className="product-muted">
                        {report.createdAt} · {report.period}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="product-channels">
                    {report.channels.map((ch) => (
                      <span
                        key={ch}
                        className="product-channel"
                        title={channelMeta[ch].title}
                      >
                        <span className="material-symbols-outlined" aria-hidden>
                          {channelMeta[ch].icon}
                        </span>
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="product-insight">
                    <span className="material-symbols-outlined" aria-hidden>
                      lightbulb
                    </span>
                    {report.insight}
                  </div>
                </td>
                <td>
                  <span className={`product-status product-status--${report.status}`}>
                    {statusLabel[report.status]}
                  </span>
                  <span className="product-format">{report.format}</span>
                </td>
                <td className="is-right">
                  <Link
                    className="product-btn product-btn--primary product-btn--sm"
                    to={report.path}
                  >
                    Открыть
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="product-empty">
                  Ничего не найдено по текущему фильтру.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {filtered.length > 0 ? (
          <div className="product-table-footer">
            <div className="product-muted">
              Показано {(safePage - 1) * PAGE_SIZE + 1}–
              {Math.min(safePage * PAGE_SIZE, filtered.length)} из {filtered.length}
            </div>
            <div className="product-pager">
              <button
                type="button"
                className="product-pager__btn"
                disabled={safePage <= 1}
                aria-label="Предыдущая страница"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  chevron_left
                </span>
              </button>
              <span className="product-pager__label">
                {safePage} / {pageCount}
              </span>
              <button
                type="button"
                className="product-pager__btn"
                disabled={safePage >= pageCount}
                aria-label="Следующая страница"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  chevron_right
                </span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
