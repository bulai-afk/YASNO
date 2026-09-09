import cors from "cors";
import express from "express";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { encryptToken } from "./tokenCrypto.js";
import { createStatsSync } from "./statsSync.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.API_PORT || 8787);
const DB_HOST = process.env.DB_HOST || "127.0.0.1";
const DB_PORT = Number(process.env.DB_PORT || 3309);
const DB_USER = process.env.DB_USER || "svodka";
const DB_PASSWORD = process.env.DB_PASSWORD || "svodka";
const DB_NAME = process.env.DB_NAME || "svodka";

const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 2500,
  namedPlaceholders: true,
  multipleStatements: true,
});

const statsSync = createStatsSync(pool);

async function ensureStatsSchema() {
  try {
    const sql = readFileSync(join(__dirname, "sql/stats.sql"), "utf8");
    await pool.query(sql);
    await pool
      .query(
        `ALTER TABLE stats_daily ADD COLUMN bounce_rate DECIMAL(6,2) NOT NULL DEFAULT 0`,
      )
      .catch(() => {});
    console.log("[svodka-api] stats schema OK");
  } catch (err) {
    console.warn("[svodka-api] stats schema:", err.message);
  }
}

async function ensureReportsSchema() {
  try {
    const sql = readFileSync(join(__dirname, "sql/reports.sql"), "utf8");
    await pool.query(sql);
    console.log("[svodka-api] reports schema OK");
  } catch (err) {
    console.warn("[svodka-api] reports schema:", err.message);
  }
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

function userId(req) {
  const id = String(req.header("x-yandex-user-id") || "").trim();
  return id || null;
}

function requireUser(req, res) {
  const id = userId(req);
  if (!id) {
    res.status(401).json({ error: "Missing X-Yandex-User-Id" });
    return null;
  }
  return id;
}

app.get("/api/app/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "mariadb", database: DB_NAME });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err?.message || err) });
  }
});

app.get("/api/app/profile", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  try {
    const [rows] = await pool.query(
      `SELECT yandex_id, login, name, first_name, last_name, email, phone,
              birthday, sex, avatar_url, initials, raw_json, updated_at
       FROM users WHERE yandex_id = :id LIMIT 1`,
      { id },
    );
    res.json({ profile: rows[0] ? mapUserRow(rows[0]) : null });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.put("/api/app/profile", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const body = req.body || {};
  if (String(body.id || "") !== id) {
    res.status(400).json({ error: "Body id must match X-Yandex-User-Id" });
    return;
  }
  try {
    await pool.query(
      `INSERT INTO users (
         yandex_id, login, name, first_name, last_name, email, phone,
         birthday, sex, avatar_url, initials, raw_json
       ) VALUES (
         :yandex_id, :login, :name, :first_name, :last_name, :email, :phone,
         :birthday, :sex, :avatar_url, :initials, :raw_json
       )
       ON DUPLICATE KEY UPDATE
         login = VALUES(login),
         name = VALUES(name),
         first_name = VALUES(first_name),
         last_name = VALUES(last_name),
         email = VALUES(email),
         phone = VALUES(phone),
         birthday = VALUES(birthday),
         sex = VALUES(sex),
         avatar_url = VALUES(avatar_url),
         initials = VALUES(initials),
         raw_json = VALUES(raw_json)`,
      {
        yandex_id: id,
        login: String(body.login || ""),
        name: body.name ?? null,
        first_name: body.firstName ?? null,
        last_name: body.lastName ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        birthday: body.birthday ?? null,
        sex: body.sex ?? null,
        avatar_url: body.avatarUrl ?? null,
        initials: body.initials ?? null,
        raw_json: JSON.stringify(body.raw ?? body),
      },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get("/api/app/integrations", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  try {
    const [rows] = await pool.query(
      `SELECT provider, status, error_text, meta_json, last_sync_at, updated_at
       FROM integrations WHERE user_id = :id`,
      { id },
    );
    res.json({
      integrations: rows.map((row) => ({
        provider: row.provider,
        status: row.status,
        error: row.error_text,
        meta: parseJson(row.meta_json),
        lastSyncAt: row.last_sync_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.put("/api/app/integrations", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const items = Array.isArray(req.body?.integrations) ? req.body.integrations : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const item of items) {
      const provider = String(item.provider || "");
      if (!["metrika", "webmaster", "direct"].includes(provider)) continue;
      await conn.query(
        `INSERT INTO integrations (user_id, provider, status, error_text, meta_json, last_sync_at)
         VALUES (:user_id, :provider, :status, :error_text, :meta_json, :last_sync_at)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           error_text = VALUES(error_text),
           meta_json = VALUES(meta_json),
           last_sync_at = VALUES(last_sync_at)`,
        {
          user_id: id,
          provider,
          status: item.status || "disconnected",
          error_text: item.error ?? null,
          meta_json: JSON.stringify(item.meta ?? null),
          last_sync_at: item.lastSyncAt ? new Date(item.lastSyncAt) : new Date(),
        },
      );
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: String(err?.message || err) });
  } finally {
    conn.release();
  }
});

app.get("/api/app/project-settings", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const projectId = String(req.query.projectId || "default");
  try {
    const [rows] = await pool.query(
      `SELECT project_id, name, domain, timezone, currency,
              ai_anomalies, ai_weekly, ai_telegram, settings_json, updated_at
       FROM project_settings
       WHERE user_id = :id AND project_id = :project_id
       LIMIT 1`,
      { id, project_id: projectId },
    );
    res.json({ settings: rows[0] ? mapSettingsRow(rows[0]) : null });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.put("/api/app/project-settings", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const body = req.body || {};
  const projectId = String(body.projectId || "default");
  try {
    await pool.query(
      `INSERT INTO project_settings (
         user_id, project_id, name, domain, timezone, currency,
         ai_anomalies, ai_weekly, ai_telegram, settings_json
       ) VALUES (
         :user_id, :project_id, :name, :domain, :timezone, :currency,
         :ai_anomalies, :ai_weekly, :ai_telegram, :settings_json
       )
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         domain = VALUES(domain),
         timezone = VALUES(timezone),
         currency = VALUES(currency),
         ai_anomalies = VALUES(ai_anomalies),
         ai_weekly = VALUES(ai_weekly),
         ai_telegram = VALUES(ai_telegram),
         settings_json = VALUES(settings_json)`,
      {
        user_id: id,
        project_id: projectId,
        name: String(body.name || ""),
        domain: String(body.domain || ""),
        timezone: String(body.timezone || "Europe/Minsk"),
        currency: String(body.currency || "BYN"),
        ai_anomalies: body.aiAnomalies ? 1 : 0,
        ai_weekly: body.aiWeekly ? 1 : 0,
        ai_telegram: body.aiTelegram ? 1 : 0,
        settings_json: JSON.stringify(body),
      },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get("/api/app/projects", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  try {
    const [rows] = await pool.query(
      `SELECT id, mark, icon, color, name, short_name, unp, region, sites_json, status, updated_at
       FROM projects WHERE user_id = :id ORDER BY name ASC`,
      { id },
    );
    res.json({
      projects: rows.map((row) => ({
        id: row.id,
        mark: row.mark,
        icon: row.icon,
        color: row.color,
        name: row.name,
        short: row.short_name,
        unp: row.unp,
        region: row.region,
        sites: parseJson(row.sites_json) || [],
        sitesCount: Array.isArray(parseJson(row.sites_json))
          ? parseJson(row.sites_json).length
          : 0,
        status: row.status,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.put("/api/app/projects", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const projects = Array.isArray(req.body?.projects) ? req.body.projects : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM projects WHERE user_id = :id`, { id });
    for (const p of projects) {
      const sites = Array.isArray(p.sites) ? p.sites : [];
      await conn.query(
        `INSERT INTO projects (
           user_id, id, mark, icon, color, name, short_name, unp, region, sites_json, status
         ) VALUES (
           :user_id, :pid, :mark, :icon, :color, :name, :short_name, :unp, :region,
           :sites_json, :status
         )`,
        {
          user_id: id,
          pid: String(p.id),
          mark: String(p.mark || "PR").slice(0, 8),
          icon: String(p.icon || "business_center"),
          color: String(p.color || "#38bdf8"),
          name: String(p.name || ""),
          short_name: String(p.short || p.name || ""),
          unp: p.unp ?? null,
          region: p.region ?? null,
          sites_json: JSON.stringify(sites),
          status: p.status === "paused" ? "paused" : "active",
        },
      );
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: String(err?.message || err) });
  } finally {
    conn.release();
  }
});

const PLAN_PRICES = { start: 39, pro: 99, agency: 199 };
const PLAN_LABELS = { start: "Старт", pro: "Про", agency: "Агентство" };
const DEFAULT_TRIAL_DAYS = 14;

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const a = new Date(`${fromIso}T12:00:00Z`);
  const b = new Date(`${toIso}T12:00:00Z`);
  return Math.round((b - a) / 86400000);
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Minsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function computeTrial(sub) {
  const started = toDateOnly(sub.trial_started_at);
  const ends = toDateOnly(sub.trial_ends_at);
  const trialDays = Number(sub.trial_days) || DEFAULT_TRIAL_DAYS;
  const today = todayIso();
  // Доступ до конца дня ends; сброс лимитов — на следующий день в 00:00 MSK
  const resetAt = addDays(ends, 1);
  const rawUsed = daysBetween(started, today);
  const usedDays = Math.max(0, Math.min(trialDays, rawUsed));
  const leftDays = Math.max(0, daysBetween(today, resetAt));
  const expired = today >= resetAt;
  return {
    startedAt: started,
    endsAt: ends,
    resetAt,
    trialDays,
    usedDays,
    leftDays,
    expired,
    activeUntilLabel: formatRuDate(ends),
    resetAtLabel: formatRuDate(resetAt),
  };
}

function formatRuDate(iso) {
  try {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}

function mapSubscriptionRow(row) {
  const trial = computeTrial(row);
  let status = row.status;
  if (status === "trial" && trial.expired) status = "expired";
  return {
    userId: row.user_id,
    plan: row.plan,
    planLabel: PLAN_LABELS[row.plan] || row.plan,
    status,
    billingCycle: row.billing_cycle,
    priceByn: Number(row.price_byn),
    trialStartedAt: toDateOnly(row.trial_started_at),
    trialDays: Number(row.trial_days),
    trialEndsAt: toDateOnly(row.trial_ends_at),
    currentPeriodStart: toDateOnly(row.current_period_start),
    currentPeriodEnd: toDateOnly(row.current_period_end),
    trial,
    updatedAt: row.updated_at,
  };
}

function mapInvoiceRow(row) {
  return {
    id: row.id,
    number: row.number,
    plan: row.plan,
    planLabel: PLAN_LABELS[row.plan] || row.plan,
    amountByn: Number(row.amount_byn),
    currency: row.currency,
    status: row.status,
    kind: row.kind,
    issuedAt: toDateOnly(row.issued_at),
    dueAt: toDateOnly(row.due_at),
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    periodLabel: row.period_label,
    description: row.description,
    meta: parseJson(row.meta_json),
    updatedAt: row.updated_at,
  };
}

async function ensureSubscription(userId) {
  const [existing] = await pool.query(
    `SELECT * FROM subscriptions WHERE user_id = :id LIMIT 1`,
    { id: userId },
  );
  if (existing[0]) {
    const mapped = mapSubscriptionRow(existing[0]);
    if (existing[0].status === "trial" && mapped.trial.expired) {
      await pool.query(
        `UPDATE subscriptions SET status = 'expired' WHERE user_id = :id AND status = 'trial'`,
        { id: userId },
      );
      mapped.status = "expired";
    }
    return mapped;
  }

  const started = todayIso();
  const trialDays = DEFAULT_TRIAL_DAYS;
  const ends = addDays(started, trialDays);
  await pool.query(
    `INSERT INTO subscriptions (
       user_id, plan, status, trial_started_at, trial_days, trial_ends_at,
       billing_cycle, price_byn
     ) VALUES (
       :user_id, 'pro', 'trial', :started, :trial_days, :ends, 'month', :price
     )`,
    {
      user_id: userId,
      started,
      trial_days: trialDays,
      ends,
      price: PLAN_PRICES.pro,
    },
  );
  const [rows] = await pool.query(
    `SELECT * FROM subscriptions WHERE user_id = :id LIMIT 1`,
    { id: userId },
  );
  return mapSubscriptionRow(rows[0]);
}

async function listInvoices(userId) {
  const [rows] = await pool.query(
    `SELECT * FROM invoices WHERE user_id = :id ORDER BY issued_at DESC, created_at DESC`,
    { id: userId },
  );
  return rows.map(mapInvoiceRow);
}

app.get("/api/app/billing", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  try {
    const subscription = await ensureSubscription(id);
    const invoices = await listInvoices(id);
    res.json({ subscription, invoices });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.put("/api/app/billing/subscription", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const body = req.body || {};
  const plan = ["start", "pro", "agency"].includes(body.plan) ? body.plan : null;
  const status = ["trial", "active", "past_due", "cancelled", "expired"].includes(
    body.status,
  )
    ? body.status
    : null;
  const cycle = ["month", "year"].includes(body.billingCycle)
    ? body.billingCycle
    : null;
  try {
    await ensureSubscription(id);
    const patches = [];
    const params = { id };
    if (plan) {
      patches.push("plan = :plan", "price_byn = :price");
      params.plan = plan;
      params.price = PLAN_PRICES[plan];
    }
    if (status) {
      patches.push("status = :status");
      params.status = status;
    }
    if (cycle) {
      patches.push("billing_cycle = :cycle");
      params.cycle = cycle;
    }
    if (body.currentPeriodStart) {
      patches.push("current_period_start = :cps");
      params.cps = String(body.currentPeriodStart).slice(0, 10);
    }
    if (body.currentPeriodEnd) {
      patches.push("current_period_end = :cpe");
      params.cpe = String(body.currentPeriodEnd).slice(0, 10);
    }
    if (patches.length) {
      await pool.query(
        `UPDATE subscriptions SET ${patches.join(", ")} WHERE user_id = :id`,
        params,
      );
    }
    const subscription = await ensureSubscription(id);
    res.json({ ok: true, subscription });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/app/billing/invoices", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const body = req.body || {};
  try {
    const sub = await ensureSubscription(id);
    const plan = ["start", "pro", "agency"].includes(body.plan)
      ? body.plan
      : sub.plan;
    const amount =
      body.amountByn != null ? Number(body.amountByn) : PLAN_PRICES[plan];
    const issued = toDateOnly(body.issuedAt) || todayIso();
    const due = toDateOnly(body.dueAt) || addDays(issued, 7);
    const invoiceId =
      body.id ||
      `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const number =
      body.number ||
      `BY-${String(Math.floor(1000 + Math.random() * 9000))}`;
    const status = [
      "draft",
      "pending",
      "paid",
      "overdue",
      "cancelled",
      "refunded",
    ].includes(body.status)
      ? body.status
      : "pending";
    const kind = ["trial", "subscription", "upgrade", "one_off"].includes(
      body.kind,
    )
      ? body.kind
      : "subscription";

    await pool.query(
      `INSERT INTO invoices (
         id, user_id, number, plan, amount_byn, currency, status, kind,
         issued_at, due_at, paid_at, period_label, description, meta_json
       ) VALUES (
         :iid, :user_id, :number, :plan, :amount, :currency, :status, :kind,
         :issued, :due, :paid_at, :period_label, :description, :meta_json
       )`,
      {
        iid: invoiceId,
        user_id: id,
        number,
        plan,
        amount,
        currency: body.currency || "BYN",
        status,
        kind,
        issued,
        due,
        paid_at: status === "paid" ? new Date() : null,
        period_label: body.periodLabel || null,
        description:
          body.description ||
          `Тариф «${PLAN_LABELS[plan]}» · ${body.periodLabel || issued}`,
        meta_json: JSON.stringify(body.meta ?? null),
      },
    );

    const [rows] = await pool.query(
      `SELECT * FROM invoices WHERE id = :iid LIMIT 1`,
      { iid: invoiceId },
    );
    res.json({ ok: true, invoice: mapInvoiceRow(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.patch("/api/app/billing/invoices/:invoiceId", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const invoiceId = String(req.params.invoiceId || "");
  const body = req.body || {};
  const status = [
    "draft",
    "pending",
    "paid",
    "overdue",
    "cancelled",
    "refunded",
  ].includes(body.status)
    ? body.status
    : null;
  if (!invoiceId || !status) {
    res.status(400).json({ error: "invoiceId and status required" });
    return;
  }
  try {
    const paidAt = status === "paid" ? new Date() : null;
    const [result] = await pool.query(
      `UPDATE invoices
       SET status = :status,
           paid_at = CASE
             WHEN :status = 'paid' THEN COALESCE(paid_at, :paid_at)
             WHEN :status IN ('pending', 'draft', 'overdue', 'cancelled') THEN NULL
             ELSE paid_at
           END
       WHERE id = :iid AND user_id = :uid`,
      { status, paid_at: paidAt, iid: invoiceId, uid: id },
    );
    if (!result.affectedRows) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    if (status === "paid") {
      const [invRows] = await pool.query(
        `SELECT * FROM invoices WHERE id = :iid AND user_id = :uid LIMIT 1`,
        { iid: invoiceId, uid: id },
      );
      const inv = invRows[0];
      if (inv) {
        const periodStart = todayIso();
        const periodEnd = addDays(
          periodStart,
          inv.plan && PLAN_PRICES[inv.plan] ? 30 : 30,
        );
        await pool.query(
          `UPDATE subscriptions
           SET status = 'active',
               plan = :plan,
               price_byn = :price,
               current_period_start = :cps,
               current_period_end = :cpe
           WHERE user_id = :uid`,
          {
            plan: inv.plan,
            price: Number(inv.amount_byn),
            cps: periodStart,
            cpe: periodEnd,
            uid: id,
          },
        );
      }
    }

    const [rows] = await pool.query(
      `SELECT * FROM invoices WHERE id = :iid LIMIT 1`,
      { iid: invoiceId },
    );
    const subscription = await ensureSubscription(id);
    res.json({
      ok: true,
      invoice: mapInvoiceRow(rows[0]),
      subscription,
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Сохранить OAuth-токен на сервере (дашборд читает Метрику live, без кэша БД). */
app.put("/api/app/oauth-token", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const accessToken = String(req.body?.accessToken || "").trim();
  if (!accessToken) {
    res.status(400).json({ error: "accessToken required" });
    return;
  }
  const expiresIn = Number(req.body?.expiresIn);
  let expiresAt = null;
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    expiresAt = new Date(Date.now() + expiresIn * 1000);
  } else if (req.body?.expiresAt) {
    expiresAt = new Date(req.body.expiresAt);
  }
  try {
    const enc = encryptToken(accessToken);
    await pool.query(
      `INSERT INTO oauth_tokens (user_id, access_token_enc, expires_at)
       VALUES (:uid, :enc, :exp)
       ON DUPLICATE KEY UPDATE
         access_token_enc = VALUES(access_token_enc),
         expires_at = VALUES(expires_at)`,
      { uid: id, enc, exp: expiresAt },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.delete("/api/app/oauth-token", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  try {
    await pool.query(`DELETE FROM oauth_tokens WHERE user_id = :uid`, {
      uid: id,
    });
    await pool.query(
      `UPDATE sync_jobs SET phase = 'error', error_text = 'Токен удалён' WHERE user_id = :uid`,
      { uid: id },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/app/sync/start", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  try {
    const force = Boolean(req.body?.force || req.query?.force);
    await statsSync.scheduleBackfill(id, { force });
    res.json({ ok: true, force });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get("/api/app/sync-status", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  try {
    const [rows] = await pool.query(
      `SELECT phase, backfill_from, backfill_to, backfill_cursor, last_daily_day,
              last_run_at, error_text, progress_pct, updated_at
       FROM sync_jobs WHERE user_id = :uid LIMIT 1`,
      { uid: id },
    );
    const [cnt] = await pool.query(
      `SELECT COUNT(*) AS n, MIN(day) AS min_day, MAX(day) AS max_day
       FROM stats_daily WHERE user_id = :uid`,
      { uid: id },
    );
    res.json({
      job: rows[0]
        ? {
            phase: rows[0].phase,
            backfillFrom: rows[0].backfill_from,
            backfillTo: rows[0].backfill_to,
            backfillCursor: rows[0].backfill_cursor,
            lastDailyDay: rows[0].last_daily_day,
            lastRunAt: rows[0].last_run_at,
            error: rows[0].error_text,
            progressPct: rows[0].progress_pct,
            updatedAt: rows[0].updated_at,
          }
        : null,
      stats: {
        rows: Number(cnt[0]?.n ?? 0),
        minDay: cnt[0]?.min_day ?? null,
        maxDay: cnt[0]?.max_day ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Посуточная статистика из MariaDB для дашборда. */
app.get("/api/app/stats", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const from = String(req.query.from || "").slice(0, 10);
  const to = String(req.query.to || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    res.status(400).json({ error: "from/to YYYY-MM-DD required" });
    return;
  }
  const sitesRaw = String(req.query.sites || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  try {
    let sql = `
      SELECT day, source, entity_key, site_host,
             visits, users_cnt, pageviews, goal_reaches, ecommerce_purchases, bounce_rate, shows, clicks,
             updated_at
      FROM stats_daily
      WHERE user_id = :uid AND day BETWEEN :from AND :to`;
    const params = { uid: id, from, to };
    if (sitesRaw.length) {
      sql += ` AND (
        site_host IN (${sitesRaw.map((_, i) => `:s${i}`).join(",")})
        OR ${sitesRaw.map((_, i) => `site_host LIKE CONCAT('%.', :s${i})`).join(" OR ")}
        OR ${sitesRaw.map((_, i) => `:s${i} LIKE CONCAT('%.', site_host)`).join(" OR ")}
      )`;
      sitesRaw.forEach((s, i) => {
        params[`s${i}`] = s;
      });
    }
    sql += ` ORDER BY day ASC`;

    const [rows] = await pool.query(sql, params);

    const metrikaByDay = new Map();
    const wmByDay = new Map();
    const seenMetrika = new Set();
    const seenWm = new Set();

    const coverage = [];
    const seenCov = new Set();

    for (const row of rows) {
      const day = fmtStatsDay(row.day);
      const covKey = `${row.source}|${row.entity_key}|${day}`;
      if (!seenCov.has(covKey)) {
        seenCov.add(covKey);
        coverage.push({
          date: day,
          source: row.source,
          entityKey: String(row.entity_key ?? ""),
          updatedAt:
            row.updated_at instanceof Date
              ? row.updated_at.toISOString()
              : String(row.updated_at || ""),
        });
      }
      if (row.source === "metrika") {
        const key = `${row.entity_key}|${day}`;
        if (seenMetrika.has(key)) continue;
        seenMetrika.add(key);
        const cur = metrikaByDay.get(day) || emptyStatsDay(day);
        cur.visits += Number(row.visits || 0);
        cur.users += Number(row.users_cnt || 0);
        cur.pageviews += Number(row.pageviews || 0);
        cur.conversions += Number(row.goal_reaches || 0);
        cur.ecommerce += Number(row.ecommerce_purchases || 0);
        const bounce = Number(row.bounce_rate || 0);
        const v = Number(row.visits || 0);
        const w = cur.visits;
        cur.bounceRate = w ? (cur.bounceRate * (w - v) + bounce * v) / w : 0;
        metrikaByDay.set(day, cur);
      } else {
        const key = `${row.entity_key}|${day}`;
        if (seenWm.has(key)) continue;
        seenWm.add(key);
        const cur = wmByDay.get(day) || emptyStatsDay(day);
        cur.shows += Number(row.shows || 0);
        cur.clicks += Number(row.clicks || 0);
        wmByDay.set(day, cur);
      }
    }

    const days = [];
    const cursor = new Date(`${from}T12:00:00`);
    const end = new Date(`${to}T12:00:00`);
    while (cursor <= end) {
      const day = fmtStatsDay(cursor);
      const m = metrikaByDay.get(day) || emptyStatsDay(day);
      const w = wmByDay.get(day) || emptyStatsDay(day);
      const hasWm = w.shows > 0 || w.clicks > 0;
      days.push({
        date: day,
        impressions: hasWm ? w.shows : m.pageviews,
        clicks: hasWm ? w.clicks : m.visits,
        conversions: m.conversions,
        visits: m.visits,
        users: m.users,
        pageviews: m.pageviews,
        ecommerce: m.ecommerce,
        bounceRate: m.bounceRate,
        shows: w.shows,
        spend: 0,
        trafficFromMetrika: !hasWm && m.visits + m.pageviews > 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    const totals = days.reduce(
      (a, d) => {
        const visits = a.visits + d.visits;
        return {
          impressions: a.impressions + d.impressions,
          clicks: a.clicks + d.clicks,
          conversions: a.conversions + d.conversions,
          visits,
          users: a.users + d.users,
          pageviews: a.pageviews + d.pageviews,
          ecommerce: a.ecommerce + d.ecommerce,
          bounceRate: visits
            ? (a.bounceRate * a.visits + d.bounceRate * d.visits) / visits
            : 0,
          spend: 0,
        };
      },
      {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        visits: 0,
        users: 0,
        pageviews: 0,
        ecommerce: 0,
        bounceRate: 0,
        spend: 0,
      },
    );

    const [syncRows] = await pool.query(
      `SELECT phase, progress_pct, error_text, last_daily_day FROM sync_jobs WHERE user_id = :uid LIMIT 1`,
      { uid: id },
    );

    res.json({
      from,
      to,
      days,
      totals,
      coverage,
      hasData: rows.length > 0,
      sync: syncRows[0]
        ? {
            phase: syncRows[0].phase,
            progressPct: syncRows[0].progress_pct,
            error: syncRows[0].error_text,
            lastDailyDay: syncRows[0].last_daily_day,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Запись посуточной Метрики в MariaDB (дашборд пишет после live-запроса). */
app.post("/api/app/stats", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const entityKey = String(req.body?.entityKey || "").trim();
  const siteHost = String(req.body?.siteHost || "").trim().toLowerCase();
  const points = Array.isArray(req.body?.points) ? req.body.points : [];
  if (!entityKey || !points.length) {
    res.status(400).json({ error: "entityKey and points required" });
    return;
  }
  try {
    let saved = 0;
    for (const p of points) {
      const day = fmtStatsDay(p.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      await pool.query(
        `INSERT INTO stats_daily (
           user_id, source, entity_key, site_host, day,
           visits, users_cnt, pageviews, goal_reaches, ecommerce_purchases, bounce_rate, shows, clicks
         ) VALUES (
           :uid, 'metrika', :ek, :site, :day,
           :visits, :users, :pv, :goals, :ecom, :bounce, 0, 0
         )
         ON DUPLICATE KEY UPDATE
           site_host = VALUES(site_host),
           visits = VALUES(visits),
           users_cnt = VALUES(users_cnt),
           pageviews = VALUES(pageviews),
           goal_reaches = VALUES(goal_reaches),
           ecommerce_purchases = VALUES(ecommerce_purchases),
           bounce_rate = VALUES(bounce_rate),
           updated_at = CURRENT_TIMESTAMP`,
        {
          uid: id,
          ek: entityKey,
          site: siteHost,
          day,
          visits: Number(p.visits || 0),
          users: Number(p.users || 0),
          pv: Number(p.pageviews || 0),
          goals: Number(p.goalReaches || p.conversions || 0),
          ecom: Number(p.ecommercePurchases || p.ecommerce || 0),
          bounce: Number(p.bounceRate || 0),
        },
      );
      saved += 1;
    }
    res.json({ ok: true, saved });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

const REPORT_TYPES = new Set([
  "full",
  "express",
  "direct-weekly",
  "webmaster-audit",
  "monthly",
]);

function isIsoDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function normalizeHost(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

function dateDiffDays(from, to) {
  return Math.round(
    (new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000,
  );
}

function shiftPeriodBack(from, to) {
  const days = dateDiffDays(from, to) + 1;
  const compareTo = new Date(`${from}T12:00:00Z`);
  compareTo.setUTCDate(compareTo.getUTCDate() - 1);
  const compareFrom = new Date(compareTo);
  compareFrom.setUTCDate(compareFrom.getUTCDate() - days + 1);
  return {
    from: compareFrom.toISOString().slice(0, 10),
    to: compareTo.toISOString().slice(0, 10),
  };
}

function percentDelta(current, previous) {
  if (!previous) return current ? null : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function rounded(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

async function aggregateReportPeriod(userIdValue, siteHost, from, to) {
  const [rows] = await pool.query(
    `SELECT day, source, entity_key, visits, users_cnt, pageviews,
            goal_reaches, ecommerce_purchases, bounce_rate, shows, clicks
       FROM stats_daily
      WHERE user_id = :uid
        AND day BETWEEN :from AND :to
        AND (
          site_host = :site
          OR site_host LIKE CONCAT('%.', :site)
          OR :site LIKE CONCAT('%.', site_host)
        )
      ORDER BY day ASC`,
    { uid: userIdValue, site: siteHost, from, to },
  );

  const metrikaSeen = new Set();
  const webmasterSeen = new Set();
  const days = new Map();
  const coverage = { metrika: 0, webmaster: 0 };

  for (const row of rows) {
    const day = fmtStatsDay(row.day);
    const point = days.get(day) || {
      date: day,
      visits: 0,
      users: 0,
      pageviews: 0,
      conversions: 0,
      ecommerce: 0,
      bounceNumerator: 0,
      shows: 0,
      clicks: 0,
    };
    const dedupeKey = `${row.source}|${row.entity_key}|${day}`;
    if (row.source === "metrika") {
      if (metrikaSeen.has(dedupeKey)) continue;
      metrikaSeen.add(dedupeKey);
      const visits = Number(row.visits || 0);
      point.visits += visits;
      point.users += Number(row.users_cnt || 0);
      point.pageviews += Number(row.pageviews || 0);
      point.conversions += Number(row.goal_reaches || 0);
      point.ecommerce += Number(row.ecommerce_purchases || 0);
      point.bounceNumerator += Number(row.bounce_rate || 0) * visits;
      coverage.metrika += 1;
    } else if (row.source === "webmaster") {
      if (webmasterSeen.has(dedupeKey)) continue;
      webmasterSeen.add(dedupeKey);
      point.shows += Number(row.shows || 0);
      point.clicks += Number(row.clicks || 0);
      coverage.webmaster += 1;
    }
    days.set(day, point);
  }

  const series = Array.from(days.values()).map((point) => ({
    date: point.date,
    visits: point.visits,
    users: point.users,
    pageviews: point.pageviews,
    conversions: point.conversions,
    ecommerce: point.ecommerce,
    bounceRate: point.visits ? rounded(point.bounceNumerator / point.visits) : 0,
    shows: point.shows,
    clicks: point.clicks,
  }));
  const raw = series.reduce(
    (sum, point) => ({
      visits: sum.visits + point.visits,
      users: sum.users + point.users,
      pageviews: sum.pageviews + point.pageviews,
      conversions: sum.conversions + point.conversions,
      ecommerce: sum.ecommerce + point.ecommerce,
      bounceNumerator:
        sum.bounceNumerator + point.bounceRate * point.visits,
      shows: sum.shows + point.shows,
      clicks: sum.clicks + point.clicks,
    }),
    {
      visits: 0,
      users: 0,
      pageviews: 0,
      conversions: 0,
      ecommerce: 0,
      bounceNumerator: 0,
      shows: 0,
      clicks: 0,
    },
  );
  return {
    from,
    to,
    series,
    coverage,
    hasData: rows.length > 0,
    totals: {
      visits: raw.visits,
      users: raw.users,
      pageviews: raw.pageviews,
      conversions: raw.conversions,
      ecommerce: raw.ecommerce,
      bounceRate: raw.visits ? rounded(raw.bounceNumerator / raw.visits) : 0,
      depth: raw.visits ? rounded(raw.pageviews / raw.visits) : 0,
      conversionRate: raw.visits
        ? rounded((raw.conversions / raw.visits) * 100)
        : 0,
      shows: raw.shows,
      clicks: raw.clicks,
      searchCtr: raw.shows ? rounded((raw.clicks / raw.shows) * 100) : 0,
    },
  };
}

function metricFact(name, current, previous, suffix = "") {
  const delta = percentDelta(current, previous);
  return {
    name,
    current: rounded(current),
    previous: rounded(previous),
    delta: delta == null ? null : rounded(delta, 1),
    suffix,
  };
}

function buildReportFindings(current, previous) {
  if (!current.hasData) {
    return [
      {
        step: "Проверка данных",
        status: "insufficient",
        fact: "За выбранный период в хранилище нет данных по выбранному сайту.",
        interpretation:
          "Оценка качества трафика невозможна без фактических визитов и целей.",
        action:
          "Запустить синхронизацию Метрики и проверить привязку домена к счётчику.",
      },
    ];
  }

  const c = current.totals;
  const p = previous?.totals || null;
  const visitsDelta = p ? percentDelta(c.visits, p.visits) : null;
  const bounceDelta = p ? c.bounceRate - p.bounceRate : null;
  const crDelta = p ? c.conversionRate - p.conversionRate : null;
  const findings = [
    {
      step: "1. Полнота данных",
      status: current.coverage.metrika ? "ok" : "insufficient",
      fact: `Получено ${current.series.length} дней статистики; записей Метрики: ${current.coverage.metrika}, Вебмастера: ${current.coverage.webmaster}.`,
      interpretation: current.coverage.metrika
        ? "Объём и качество трафика можно оценивать по данным Метрики."
        : "Данных Метрики нет — выводы о поведении посетителей недоступны.",
      action: current.coverage.metrika
        ? "Перейти к оценке динамики визитов."
        : "Подключить счётчик Метрики для выбранного домена.",
    },
    {
      step: "2. Объём трафика",
      status:
        visitsDelta == null
          ? "neutral"
          : visitsDelta <= -20
            ? "attention"
            : "ok",
      fact:
        visitsDelta == null
          ? `${c.visits} визитов за выбранный период; сравнение отключено или недоступно.`
          : `${c.visits} визитов, ${visitsDelta >= 0 ? "рост" : "снижение"} на ${Math.abs(rounded(visitsDelta, 1))}% к периоду сравнения.`,
      interpretation:
        visitsDelta == null
          ? "Для оценки тренда нужен сопоставимый предыдущий период."
          : Math.abs(visitsDelta) < 10
            ? "Объём трафика остаётся стабильным."
            : visitsDelta > 0
              ? "Приток аудитории увеличился; далее проверяем её качество."
              : "Приток аудитории снизился; причину нужно искать по каналам и поисковой видимости.",
      action:
        visitsDelta != null && visitsDelta <= -20
          ? "Проверить изменения по каналам, кампаниям и поисковым запросам."
          : "Сопоставить динамику с качеством и конверсиями.",
    },
    {
      step: "3. Качество посещений",
      status:
        bounceDelta != null && bounceDelta >= 5 ? "attention" : "ok",
      fact:
        bounceDelta == null
          ? `Отказы ${c.bounceRate}%, глубина ${c.depth} страницы за визит.`
          : `Отказы ${c.bounceRate}% (${bounceDelta >= 0 ? "+" : ""}${rounded(bounceDelta, 1)} п.п.), глубина ${c.depth}.`,
      interpretation:
        bounceDelta != null && bounceDelta >= 5
          ? "Доля быстрых уходов выросла. Данных недостаточно, чтобы утверждать конкретную техническую причину."
          : "По доступным агрегатам резкого ухудшения вовлечённости не обнаружено.",
      action:
        bounceDelta != null && bounceDelta >= 5
          ? "Разбить показатель по каналам, устройствам и посадочным страницам."
          : "Перейти к оценке достижения основных целей.",
    },
    {
      step: "4. Конверсии",
      status: crDelta != null && crDelta <= -1 ? "attention" : "ok",
      fact:
        crDelta == null
          ? `${c.conversions} достижений выбранных целей, CR ${c.conversionRate}%.`
          : `${c.conversions} достижений целей, CR ${c.conversionRate}% (${crDelta >= 0 ? "+" : ""}${rounded(crDelta, 2)} п.п.).`,
      interpretation:
        crDelta != null && crDelta <= -1
          ? "Конверсионность снизилась. Возможные причины нужно подтверждать разрезами, а не определять по агрегату."
          : "Существенного падения общей конверсионности не выявлено.",
      action:
        crDelta != null && crDelta <= -1
          ? "Проверить отдельные цели, источники, устройства и шаги формы."
          : "Зафиксировать стабильные связки и проверить точки роста.",
    },
  ];

  if (current.coverage.webmaster) {
    const ctrDelta = p ? c.searchCtr - p.searchCtr : null;
    findings.push({
      step: "5. Поисковая видимость",
      status: ctrDelta != null && ctrDelta <= -1 ? "attention" : "ok",
      fact: `${c.shows} показов и ${c.clicks} кликов из Вебмастера, CTR ${c.searchCtr}%.`,
      interpretation:
        ctrDelta != null && ctrDelta <= -1
          ? `CTR снизился на ${Math.abs(rounded(ctrDelta, 2))} п.п.; нужно проверить запросы и сниппеты.`
          : "По доступным агрегатам критичного ухудшения поискового CTR не обнаружено.",
      action: "Изучить запросы и страницы с максимальным вкладом в изменение кликов.",
    });
  }
  return findings;
}

async function setReportPhase(id, userIdValue, status, progress, label) {
  await pool.query(
    `UPDATE reports
        SET status = :status, progress_pct = :progress, phase_label = :label,
            started_at = COALESCE(started_at, NOW()), error_text = NULL
      WHERE id = :id AND user_id = :uid`,
    { id, uid: userIdValue, status, progress, label },
  );
}

async function generateReport(id, userIdValue) {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM reports WHERE id = :id AND user_id = :uid LIMIT 1`,
      { id, uid: userIdValue },
    );
    const row = rows[0];
    if (!row || row.status === "cancelled") return;
    const config = parseJson(row.config_json) || {};

    await setReportPhase(id, userIdValue, "collecting", 25, "Проверяем полноту данных");
    const current = await aggregateReportPeriod(
      userIdValue,
      row.site_host,
      fmtStatsDay(row.period_from),
      fmtStatsDay(row.period_to),
    );
    const previous =
      row.compare_from && row.compare_to
        ? await aggregateReportPeriod(
            userIdValue,
            row.site_host,
            fmtStatsDay(row.compare_from),
            fmtStatsDay(row.compare_to),
          )
        : null;

    await setReportPhase(id, userIdValue, "analyzing", 65, "Сопоставляем трафик и цели");
    const metrics = [
      metricFact("Визиты", current.totals.visits, previous?.totals.visits),
      metricFact("Отказы", current.totals.bounceRate, previous?.totals.bounceRate, "%"),
      metricFact("Глубина", current.totals.depth, previous?.totals.depth),
      metricFact(
        "Конверсия",
        current.totals.conversionRate,
        previous?.totals.conversionRate,
        "%",
      ),
      metricFact("Достижения целей", current.totals.conversions, previous?.totals.conversions),
    ];
    const findings = buildReportFindings(current, previous);
    const tasks = findings
      .filter((item) => item.status === "attention" || item.status === "insufficient")
      .map((item, index) => ({
        id: `${id}-task-${index + 1}`,
        title: item.action,
        sourceStep: item.step,
        priority: item.status === "insufficient" ? "high" : "medium",
        status: "todo",
      }));

    await setReportPhase(id, userIdValue, "rendering", 90, "Собираем WEB и PDF представления");
    const result = {
      version: 1,
      generatedAt: new Date().toISOString(),
      dataStatus: current.hasData ? "ready" : "insufficient",
      configuration: config,
      current,
      previous,
      metrics,
      findings,
      tasks,
      limitations: [
        "Выводы сформированы правилами по фактическим агрегатам без платного AI API.",
        "Причины, для которых нет нужного разреза, указаны как гипотезы для проверки.",
        "Расходы и CPA не рассчитываются, пока данные Яндекс Директа недоступны.",
      ],
    };
    await pool.query(
      `UPDATE reports
          SET status = 'ready', progress_pct = 100, phase_label = 'Отчёт готов',
              result_json = :result, completed_at = NOW(), error_text = NULL
        WHERE id = :id AND user_id = :uid`,
      { id, uid: userIdValue, result: JSON.stringify(result) },
    );
  } catch (err) {
    console.error("[reports] generation failed", id, err);
    await pool
      .query(
        `UPDATE reports
            SET status = 'error', phase_label = 'Ошибка генерации',
                error_text = :error
          WHERE id = :id AND user_id = :uid`,
        {
          id,
          uid: userIdValue,
          error: String(err?.message || err).slice(0, 4000),
        },
      )
      .catch(() => undefined);
  }
}

function mapReportRow(row, includeResult = false) {
  return {
    id: row.id,
    projectId: row.project_id,
    siteHost: row.site_host,
    reportType: row.report_type,
    title: row.title,
    status: row.status,
    progressPct: Number(row.progress_pct || 0),
    phaseLabel: row.phase_label,
    period: {
      from: fmtStatsDay(row.period_from),
      to: fmtStatsDay(row.period_to),
      compareFrom: row.compare_from ? fmtStatsDay(row.compare_from) : null,
      compareTo: row.compare_to ? fmtStatsDay(row.compare_to) : null,
    },
    config: parseJson(row.config_json) || {},
    result: includeResult ? parseJson(row.result_json) : undefined,
    error: row.error_text,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

app.post("/api/app/reports", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const body = req.body || {};
  const projectId = String(body.projectId || "").trim();
  const siteHost = normalizeHost(body.siteHost);
  const reportType = String(body.reportType || "full");
  const periodFrom = String(body.period?.from || "");
  const periodTo = String(body.period?.to || "");
  const compareEnabled = body.comparison !== false;
  if (!projectId || !siteHost) {
    res.status(400).json({ error: "projectId и siteHost обязательны" });
    return;
  }
  if (!REPORT_TYPES.has(reportType)) {
    res.status(400).json({ error: "Неизвестный тип отчёта" });
    return;
  }
  if (
    !isIsoDay(periodFrom) ||
    !isIsoDay(periodTo) ||
    dateDiffDays(periodFrom, periodTo) < 0 ||
    dateDiffDays(periodFrom, periodTo) > 366
  ) {
    res.status(400).json({ error: "Некорректный период отчёта" });
    return;
  }
  const shifted = compareEnabled ? shiftPeriodBack(periodFrom, periodTo) : null;
  const compareFrom = body.period?.compareFrom || shifted?.from || null;
  const compareTo = body.period?.compareTo || shifted?.to || null;
  if (
    compareEnabled &&
    (!isIsoDay(compareFrom) ||
      !isIsoDay(compareTo) ||
      dateDiffDays(compareFrom, compareTo) !== dateDiffDays(periodFrom, periodTo))
  ) {
    res.status(400).json({ error: "Периоды сравнения должны иметь одинаковую длину" });
    return;
  }
  const reportId = randomUUID();
  const config = {
    reportType,
    sources: Array.isArray(body.sources) ? body.sources : [],
    goals: Array.isArray(body.goals) ? body.goals : [],
    directives: Array.isArray(body.directives) ? body.directives : [],
    outputs: Array.isArray(body.outputs) ? body.outputs : ["web", "pdf"],
    comparison: compareEnabled,
  };
  const title =
    String(body.title || "").trim().slice(0, 255) ||
    `${reportType === "express" ? "Экспресс-отчёт" : "Сводный отчёт"} · ${siteHost}`;
  try {
    await pool.query(
      `INSERT INTO reports (
         id, user_id, project_id, site_host, report_type, title, status,
         progress_pct, phase_label, period_from, period_to, compare_from,
         compare_to, config_json
       ) VALUES (
         :reportId, :uid, :projectId, :siteHost, :reportType, :title, 'queued',
         5, 'Задание поставлено в очередь', :periodFrom, :periodTo, :compareFrom,
         :compareTo, :config
       )`,
      {
        reportId,
        uid: id,
        projectId,
        siteHost,
        reportType,
        title,
        periodFrom,
        periodTo,
        compareFrom: compareEnabled ? compareFrom : null,
        compareTo: compareEnabled ? compareTo : null,
        config: JSON.stringify(config),
      },
    );
    setImmediate(() => void generateReport(reportId, id));
    res.status(202).json({
      report: {
        id: reportId,
        status: "queued",
        progressPct: 5,
        phaseLabel: "Задание поставлено в очередь",
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get("/api/app/reports", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  try {
    const [rows] = await pool.query(
      `SELECT * FROM reports WHERE user_id = :uid ORDER BY created_at DESC LIMIT 100`,
      { uid: id },
    );
    res.json({ reports: rows.map((row) => mapReportRow(row, false)) });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get("/api/app/reports/:reportId", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  try {
    const [rows] = await pool.query(
      `SELECT * FROM reports WHERE id = :reportId AND user_id = :uid LIMIT 1`,
      { reportId: req.params.reportId, uid: id },
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Отчёт не найден" });
      return;
    }
    res.json({ report: mapReportRow(rows[0], true) });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/app/report-templates", async (req, res) => {
  const id = requireUser(req, res);
  if (!id) return;
  const projectId = String(req.body?.projectId || "").trim();
  const name = String(req.body?.name || "Шаблон отчёта").trim().slice(0, 255);
  if (!projectId) {
    res.status(400).json({ error: "projectId обязателен" });
    return;
  }
  const templateId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO report_templates (id, user_id, project_id, name, config_json)
       VALUES (:templateId, :uid, :projectId, :name, :config)`,
      {
        templateId,
        uid: id,
        projectId,
        name,
        config: JSON.stringify(req.body?.config || {}),
      },
    );
    res.status(201).json({ template: { id: templateId, name } });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

function fmtStatsDay(d) {
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return String(d).slice(0, 10);
}

function emptyStatsDay(date) {
  return {
    date,
    visits: 0,
    users: 0,
    pageviews: 0,
    conversions: 0,
    ecommerce: 0,
    bounceRate: 0,
    shows: 0,
    clicks: 0,
  };
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function mapUserRow(row) {
  return {
    id: row.yandex_id,
    login: row.login,
    name: row.name,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    birthday: row.birthday,
    sex: row.sex,
    avatarUrl: row.avatar_url,
    initials: row.initials,
    raw: parseJson(row.raw_json),
    updatedAt: row.updated_at,
  };
}

function mapSettingsRow(row) {
  return {
    projectId: row.project_id,
    name: row.name,
    domain: row.domain,
    timezone: row.timezone,
    currency: row.currency,
    aiAnomalies: Boolean(row.ai_anomalies),
    aiWeekly: Boolean(row.ai_weekly),
    aiTelegram: Boolean(row.ai_telegram),
    updatedAt: row.updated_at,
  };
}

app.listen(PORT, async () => {
  console.log(`[svodka-api] http://127.0.0.1:${PORT} → ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
  await ensureStatsSchema();
  await ensureReportsSchema();
  // Дашборд: БД first, API только для дыр. Воркер синка не стартуем — жрёт квоту.
  statsSync.stop();
});
