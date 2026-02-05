// server/lib/googleSheetsReviews.js
// ✅ KEEP THIS FILE NAME EXACTLY: googleSheetsReviews.js
// ✅ This file will now support BOTH: Reviews sheet + Matrix sheet (read-only)
// ✅ No breaking changes to listReviews / upsertReview

import crypto from "crypto";
import { google } from "googleapis";

const DEFAULT_SPREADSHEET_ID = "1XhSTbGSuQrR2wGW2yf_TCS1CD0TTOr-swoonByCdhUU";
const DEFAULT_TAB_NAME = "reviews";

// ✅ NEW DEFAULTS FOR MATRIX (your matrix link)
const DEFAULT_MATRIX_SHEET_ID = "1rhW5o1NGXHzglJ39WX1s6oYaVxV7E_jGzy6HcyBaM4Y";

function mustEnv(name, fallback = "") {
  const v = process.env[name];
  if (v != null && String(v).trim() !== "") return String(v);
  if (fallback) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

function cleanPrivateKey(key) {
  return String(key || "").replace(/\\n/g, "\n");
}

function norm(s) {
  return String(s || "").trim();
}
function normKey(s) {
  return norm(s).toLowerCase();
}

function genId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function validateEmail(email) {
  const e = norm(email);
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function required(v, label) {
  const s = norm(v);
  if (!s) throw new Error(`Missing field: ${label}`);
  return s;
}

// ✅ One client builder, with selectable scope
function getSheetsClient(scope = "readwrite") {
  const clientEmail = mustEnv("GOOGLE_SHEETS_CLIENT_EMAIL");
  const privateKey = cleanPrivateKey(mustEnv("GOOGLE_SHEETS_PRIVATE_KEY"));

  const scopes =
    scope === "readonly"
      ? ["https://www.googleapis.com/auth/spreadsheets.readonly"]
      : ["https://www.googleapis.com/auth/spreadsheets"];

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes,
  });

  return google.sheets({ version: "v4", auth });
}

async function ensureHeaderRow({ sheets, spreadsheetId, tabName }) {
  const range = `${tabName}!A1:H1`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const row = (res.data.values && res.data.values[0]) || [];

  const header = [
    "reviewId",
    "callCenter",
    "name",
    "email",
    "stars",
    "comment",
    "createdAt",
    "updatedAt",
  ];

  const normalized = row.map((c) => normKey(c));
  const ok = header.every((h, i) => normKey(h) === (normalized[i] || ""));

  if (!ok) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [header] },
    });
  }
}

async function readAllRows({ sheets, spreadsheetId, tabName }) {
  const range = `${tabName}!A2:H`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = res.data.values || [];

  return values.map((r) => {
    const row = Array.isArray(r) ? r : [];
    return {
      reviewId: norm(row[0]),
      callCenter: norm(row[1]),
      name: norm(row[2]),
      email: norm(row[3]),
      stars: toInt(row[4], 0),
      comment: norm(row[5]),
      createdAt: norm(row[6]),
      updatedAt: norm(row[7]),
    };
  });
}

// ✅ EXISTING EXPORT: unchanged behavior
export async function listReviews({ email, callCenter } = {}) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const tabName = process.env.GOOGLE_SHEETS_TAB_NAME || DEFAULT_TAB_NAME;

  const sheets = getSheetsClient("readwrite");
  await ensureHeaderRow({ sheets, spreadsheetId, tabName });
  const rows = await readAllRows({ sheets, spreadsheetId, tabName });

  let filtered = rows;
  if (email) {
    const e = normKey(email);
    filtered = filtered.filter((x) => normKey(x.email) === e);
  }
  if (callCenter) {
    const c = normKey(callCenter);
    filtered = filtered.filter((x) => normKey(x.callCenter) === c);
  }

  const sorted = [...filtered].sort((a, b) => {
    const au = Date.parse(a.updatedAt || a.createdAt || "") || 0;
    const bu = Date.parse(b.updatedAt || b.createdAt || "") || 0;
    return bu - au;
  });

  return { reviews: sorted };
}

// ✅ EXISTING EXPORT: unchanged behavior
export async function upsertReview({ callCenter, name, email, stars, comment }) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const tabName = process.env.GOOGLE_SHEETS_TAB_NAME || DEFAULT_TAB_NAME;

  const cc = required(callCenter, "Call center");
  const nm = required(name, "Name");
  const em = required(email, "Email");
  if (!validateEmail(em)) throw new Error("Invalid email");

  const st = clamp(toInt(stars, 0), 1, 5);
  const cm = norm(comment);

  const sheets = getSheetsClient("readwrite");
  await ensureHeaderRow({ sheets, spreadsheetId, tabName });

  const rows = await readAllRows({ sheets, spreadsheetId, tabName });
  const keyEmail = normKey(em);
  const keyCC = normKey(cc);

  const foundIndex = rows.findIndex(
    (r) => normKey(r.email) === keyEmail && normKey(r.callCenter) === keyCC
  );

  const ts = nowIso();

  if (foundIndex >= 0) {
    const rowNumber = foundIndex + 2; // header row is 1
    const existing = rows[foundIndex];
    const updated = {
      reviewId: existing.reviewId || genId(),
      callCenter: cc,
      name: nm,
      email: em,
      stars: st,
      comment: cm,
      createdAt: existing.createdAt || ts,
      updatedAt: ts,
    };

    const range = `${tabName}!A${rowNumber}:H${rowNumber}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          updated.reviewId,
          updated.callCenter,
          updated.name,
          updated.email,
          String(updated.stars),
          updated.comment,
          updated.createdAt,
          updated.updatedAt,
        ]],
      },
    });

    return { review: updated, action: "updated" };
  }

  const created = {
    reviewId: genId(),
    callCenter: cc,
    name: nm,
    email: em,
    stars: st,
    comment: cm,
    createdAt: ts,
    updatedAt: ts,
  };

  const range = `${tabName}!A:H`;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        created.reviewId,
        created.callCenter,
        created.name,
        created.email,
        String(created.stars),
        created.comment,
        created.createdAt,
        created.updatedAt,
      ]],
    },
  });

  return { review: created, action: "created" };
}

/**
 * ✅ Matrix loader (READ ONLY) — FIXED:
 * - preserves exact tab names (no normalization for titles)
 * - logs every tab found + every tab loaded + row/col counts
 * - supports optional tab filtering via tabs: ["Voice Matrix", ...]
 *
 * Usage:
 *   const matrix = await loadMatrixSheets({ spreadsheetId })
 *   const matrix2 = await loadMatrixSheets({ spreadsheetId, tabs: ["Voice Matrix","Ticket Matrix"] })
 *
 * Returns:
 *   { [tabName]: [ [cells...], ... ] }
 */

export async function loadMatrixSheets({ spreadsheetId, tabs = [] } = {}) {
  const sid = norm(spreadsheetId) || process.env.MATRIX_SHEET_ID || DEFAULT_MATRIX_SHEET_ID;

  console.log("📗 [MATRIX] loadMatrixSheets() start", {
    spreadsheetId: sid,
    tabsRequested: Array.isArray(tabs) ? tabs : [],
    ts: new Date().toISOString(),
  });

  const sheets = getSheetsClient("readonly");

  // ✅ IMPORTANT: do NOT normalize tab titles. Keep exact Google Sheet tab names.
  let tabTitles = Array.isArray(tabs)
    ? tabs.map((t) => String(t || "").trim()).filter(Boolean)
    : [];

  if (!tabTitles.length) {
    console.log("📗 [MATRIX] No tabs specified. Fetching spreadsheet metadata for ALL tabs...");
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sid });

    const allTitles = (meta.data.sheets || [])
      .map((s) => s.properties?.title)
      .filter(Boolean);

    console.log("📗 [MATRIX] Tabs found in spreadsheet:", allTitles);

    tabTitles = allTitles;
  } else {
    console.log("📗 [MATRIX] Tabs specified. Will load ONLY these tabs:", tabTitles);
  }

  const out = {};
  for (const title of tabTitles) {
    try {
      const safeTitle = String(title).replace(/'/g, "''");
      const range = `'${safeTitle}'!A:ZZ`;

      console.log("📗 [MATRIX] Loading tab...", { title, range });

      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: sid,
        range,
        valueRenderOption: "FORMATTED_VALUE",
      });

      const values = resp.data.values || [];
      out[title] = values;

      const rows = values.length;
      const cols = rows ? Math.max(...values.map((r) => (Array.isArray(r) ? r.length : 0))) : 0;

      console.log("✅ [MATRIX] Tab loaded", { title, rows, cols });
    } catch (e) {
      console.error("❌ [MATRIX] Failed to load tab", { title, error: e?.message || String(e) });
      // keep going; don't kill the whole matrix if one tab fails
    }
  }

  console.log("✅ [MATRIX] loadMatrixSheets() finished", {
    loadedTabs: Object.keys(out),
    tabCount: Object.keys(out).length,
    ts: new Date().toISOString(),
  });

  return out;
}
