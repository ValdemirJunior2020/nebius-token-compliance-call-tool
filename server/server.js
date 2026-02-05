// server/server.js - Anthropic (Claude) + Excel + JSON docs + FIXED CORS + timeoutPromise
import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import xlsx from "xlsx";
import { listReviews, upsertReview, loadMatrixSheets } from "./lib/googleSheetsReviews.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Load .env from repo root if present, else fall back to server/.env
const ROOT_ENV = path.join(__dirname, "..", ".env");
const SERVER_ENV = path.join(__dirname, ".env");
dotenv.config({ path: fs.existsSync(ROOT_ENV) ? ROOT_ENV : SERVER_ENV });

const app = express();

const PORT = Number(process.env.PORT || 5050);
const DEBUG = String(process.env.DEBUG || "false").toLowerCase() === "true";
const AI_PROVIDER = String(process.env.AI_PROVIDER || "anthropic").toLowerCase();

const NEBIUS_API_KEY = process.env.NEBIUS_API_KEY || "";
const KIMI_API_KEY = process.env.KIMI_API_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

const NEBIUS_MODEL = process.env.NEBIUS_MODEL || "meta-llama/Meta-Llama-3.1-70B-Instruct";
const KIMI_MODEL = process.env.KIMI_MODEL || "moonshot-v1-8k";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620";

const log = (...a) => DEBUG && console.log("[server]", ...a);
const errlog = (...a) => console.error("[server]", ...a);

let DOCUMENT_CACHE = {};
let LAST_LOAD = 0;
let DOCS_LOADING = false;

// ✅ Matrix Google Sheet settings
const MATRIX_SHEET_ID =
  process.env.MATRIX_SHEET_ID || "1rhW5o1NGXHzglJ39WX1s6oYaVxV7E_jGzy6HcyBaM4Y";
const MATRIX_TABS = String(process.env.MATRIX_TABS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

log("Boot settings:", {
  PORT,
  DEBUG,
  AI_PROVIDER,
  MATRIX_SHEET_ID,
  MATRIX_TABS: MATRIX_TABS.length ? MATRIX_TABS : "(all tabs)",
});

// -------------------- CORS (FIXED) --------------------
const FRONTEND_URLS = String(
  process.env.FRONTEND_URLS ||
    process.env.FRONTEND_URL ||
    "https://nebius-api-call-compliance-tool.netlify.app"
)
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const FRONTEND_URL_DEV = (process.env.FRONTEND_URL_DEV || "http://localhost:5173").replace(
  /\/+$/,
  ""
);

const ALLOWED_ORIGINS = new Set([
  ...FRONTEND_URLS,
  FRONTEND_URL_DEV,
  "http://localhost:5173",
  "http://localhost:3000",
]);

function isNetlifySubdomain(origin) {
  try {
    const u = new URL(origin);
    return u.hostname.endsWith(".netlify.app");
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (!origin) return next();

  const cleanOrigin = String(origin).replace(/\/+$/, "");
  const ok = ALLOWED_ORIGINS.has(cleanOrigin) || isNetlifySubdomain(cleanOrigin);

  if (ok) {
    res.setHeader("Access-Control-Allow-Origin", cleanOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  if (req.method === "OPTIONS") return res.sendStatus(204);

  if (!ok) {
    console.warn("[CORS] blocked origin:", cleanOrigin);
    return res.status(403).json({
      ok: false,
      error: `CORS blocked origin: ${cleanOrigin}`,
      allowed: Array.from(ALLOWED_ORIGINS),
    });
  }

  next();
});

// -------------------- body parser --------------------
app.use(express.json({ limit: "2mb" }));

// -------------------- Google Sheets env sanity (logs) --------------------
const SHEETS_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || "";
const SHEETS_KEY_RAW = process.env.GOOGLE_SHEETS_PRIVATE_KEY || "";
const SHEETS_SHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "";
const SHEETS_TAB = process.env.GOOGLE_SHEETS_TAB_NAME || "";

function sheetsKeyNormalized() {
  const k = String(SHEETS_KEY_RAW || "").trim();
  if (!k) return "";
  return k.includes("\\n") ? k.replace(/\\n/g, "\n") : k;
}

function sheetsConfigured() {
  const key = sheetsKeyNormalized();
  return {
    email: !!SHEETS_EMAIL,
    key: !!key,
    sheetId: !!SHEETS_SHEET_ID,
    tab: !!SHEETS_TAB,
  };
}

function safeSheetsStatusLog() {
  const sc = sheetsConfigured();
  console.log(
    `🧾 Sheets (Reviews SA): email=${sc.email ? "✅" : "❌"} key=${sc.key ? "✅" : "❌"} sheetId=${
      sc.sheetId ? "✅" : "❌"
    } tab=${sc.tab ? "✅" : "❌"}`
  );
  console.log(
    `📗 Matrix Sheet: id=${MATRIX_SHEET_ID ? "✅" : "❌"} tabs=${
      MATRIX_TABS.length ? MATRIX_TABS.join(", ") : "(all tabs)"
    }`
  );
}

// -------------------- Reviews (Google Sheets) --------------------
app.get("/api/reviews", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim();
    const callCenter = String(req.query.callCenter || "").trim();
    log("[REVIEWS] list", { email: email || null, callCenter: callCenter || null });

    const out = await listReviews({
      email: email || undefined,
      callCenter: callCenter || undefined,
    });
    res.json({ ok: true, ...out });
  } catch (e) {
    errlog("[REVIEWS] list error:", e?.message || e);
    res.status(500).json({ ok: false, error: e.message || "Failed to load reviews" });
  }
});

app.post("/api/reviews/upsert", async (req, res) => {
  try {
    console.log("[REVIEWS] upsert body:", req.body);

    const { callCenter, name, email, stars, comment } = req.body || {};
    const out = await upsertReview({ callCenter, name, email, stars, comment });

    console.log("[REVIEWS] upsert result:", out.action, out.review?.reviewId);
    res.json({ ok: true, ...out });
  } catch (e) {
    console.error("[REVIEWS] upsert error:", e);
    const msg = e.message || "Failed to save review";
    const status = /missing field|invalid email/i.test(msg) ? 400 : 500;
    res.status(status).json({ ok: false, error: msg });
  }
});

app.get("/api/reviews/ping", (req, res) => {
  res.json({
    ok: true,
    sheetsConfigured: sheetsConfigured(),
    matrixConfigured: { sheetId: !!MATRIX_SHEET_ID, tabs: MATRIX_TABS.length ? MATRIX_TABS : null },
    ts: new Date().toISOString(),
  });
});

// ✅ NEW: Matrix ping endpoint (helps confirm reads quickly)
app.get("/api/matrix/ping", (req, res) => {
  const matrix = DOCUMENT_CACHE.matrix;
  const tabCount = matrix && typeof matrix === "object" ? Object.keys(matrix).length : 0;
  const firstTab = tabCount ? Object.keys(matrix)[0] : null;
  const firstTabRows = firstTab && Array.isArray(matrix[firstTab]) ? matrix[firstTab].length : 0;

  res.json({
    ok: true,
    matrixLoaded: !!matrix,
    sheetId: MATRIX_SHEET_ID,
    tabsConfigured: MATRIX_TABS.length ? MATRIX_TABS : null,
    cachedTabs: tabCount,
    sample: firstTab ? { tab: firstTab, rows: firstTabRows } : null,
    ts: new Date().toISOString(),
  });
});

// -------------------- health --------------------
app.get("/health", (req, res) => {
  const matrix = DOCUMENT_CACHE.matrix;
  const matrixTabs = matrix && typeof matrix === "object" ? Object.keys(matrix) : [];

  res.json({
    ok: true,
    port: PORT,
    provider: AI_PROVIDER,
    nebiusConfigured: !!NEBIUS_API_KEY,
    kimiConfigured: !!KIMI_API_KEY,
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    sheetsConfigured: sheetsConfigured(),
    matrix: {
      source: "google_sheets",
      sheetId: MATRIX_SHEET_ID,
      tabsConfigured: MATRIX_TABS.length ? MATRIX_TABS : null,
      cachedTabs: matrixTabs.length,
      cachedTabNamesPreview: matrixTabs.slice(0, 15),
    },
    docs: {
      cached: Object.keys(DOCUMENT_CACHE),
      lastLoad: LAST_LOAD ? new Date(LAST_LOAD).toISOString() : null,
      loading: DOCS_LOADING,
    },
    frontendAllowed: Array.from(ALLOWED_ORIGINS),
    ts: new Date().toISOString(),
  });
});

// -------------------- docs loading --------------------
const LOCAL_ASSETS_DIR = path.join(__dirname, "../client/public/Assets");
const LOCAL_SERVER_DATA_DIR = path.join(__dirname, "data");

function getDocsBase() {
  return (
    process.env.DOCS_BASE_URL ||
    FRONTEND_URLS[0] ||
    FRONTEND_URL_DEV ||
    "http://localhost:5173"
  );
}

function existsFile(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveLocalDocPath(fileName) {
  const p1 = path.join(LOCAL_ASSETS_DIR, fileName);
  if (existsFile(p1)) return p1;

  const p2 = path.join(LOCAL_SERVER_DATA_DIR, fileName);
  if (existsFile(p2)) return p2;

  return null;
}

async function fetchExcelDocument(docName, fileName) {
  const localPath = resolveLocalDocPath(fileName);
  if (localPath) {
    log(`📄 Loading ${docName} from local: ${localPath}`);
    const workbook = xlsx.readFile(localPath);
    return parseWorkbook(workbook, docName);
  }

  const docsBase = getDocsBase();
  const netlifyUrl = `${String(docsBase).replace(/\/+$/, "")}/Assets/${encodeURIComponent(
    fileName
  )}`;
  log(`🌐 Fetching ${docName} from remote: ${netlifyUrl}`);

  const response = await fetch(netlifyUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${netlifyUrl}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const workbook = xlsx.read(buffer, { type: "buffer" });
  return parseWorkbook(workbook, docName);
}

async function fetchJsonDocument(docName, fileName) {
  const localPath = resolveLocalDocPath(fileName);
  if (localPath) {
    log(`📄 Loading ${docName} from local: ${localPath}`);
    const raw = fs.readFileSync(localPath, "utf-8");
    const json = JSON.parse(raw);
    log(`✅ Parsed ${docName}: JSON keys=${Object.keys(json || {}).length}`);
    return json;
  }

  const docsBase = getDocsBase();
  const netlifyUrl = `${String(docsBase).replace(/\/+$/, "")}/Assets/${encodeURIComponent(
    fileName
  )}`;
  log(`🌐 Fetching ${docName} from remote: ${netlifyUrl}`);

  const response = await fetch(netlifyUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${netlifyUrl}`);

  const json = await response.json();
  log(`✅ Parsed ${docName}: JSON keys=${Object.keys(json || {}).length}`);
  return json;
}

function parseWorkbook(workbook, docName) {
  const result = {};
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    result[sheetName] = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  });
  log(`✅ Parsed ${docName}: ${workbook.SheetNames.length} sheets`);
  return result;
}

function matrixStats(matrixDoc) {
  try {
    if (!matrixDoc || typeof matrixDoc !== "object") return null;
    const tabs = Object.keys(matrixDoc);
    const sample = tabs.slice(0, 5).map((t) => ({
      tab: t,
      rows: Array.isArray(matrixDoc[t]) ? matrixDoc[t].length : 0,
      colsGuess:
        Array.isArray(matrixDoc[t]) && Array.isArray(matrixDoc[t][0]) ? matrixDoc[t][0].length : 0,
    }));
    return { tabs: tabs.length, sample };
  } catch {
    return null;
  }
}

async function loadDocuments(force = false) {
  if (DOCS_LOADING) {
    log("📚 loadDocuments skipped: already loading");
    return;
  }
  if (Object.keys(DOCUMENT_CACHE).length > 0 && !force) {
    log("📚 loadDocuments skipped: cache already filled");
    return;
  }

  DOCS_LOADING = true;
  console.log("⏳ loadDocuments started...", { force, ts: new Date().toISOString() });

  // ✅ 1) Load Service Matrix from GOOGLE SHEETS (ALWAYS)
  {
    const t0 = Date.now();
    try {
      console.log("📗 Loading Service Matrix from Google Sheets...", {
        sheetId: MATRIX_SHEET_ID,
        tabs: MATRIX_TABS.length ? MATRIX_TABS : "(all tabs)",
      });

      const matrix = await loadMatrixSheets({
        spreadsheetId: MATRIX_SHEET_ID,
        tabs: MATRIX_TABS, // empty => all tabs
      });

      DOCUMENT_CACHE.matrix = matrix;

      const stats = matrixStats(matrix);
      console.log("✅ Service Matrix loaded (Google Sheets)", {
        ms: Date.now() - t0,
        stats,
      });
    } catch (e) {
      errlog("❌ Failed to load Service Matrix (Google Sheets):", e?.message || e);
      // keep going so other docs can still load
    }
  }

  // ✅ 2) Load other docs (Excel/JSON) from Assets/local/remote
  const docs = [
    { key: "qaVoice", file: "qa-voice.xlsx", name: "QA Voice", kind: "excel" },
    { key: "qaGroup", file: "qa-group.xlsx", name: "QA Groups", kind: "excel" },
    {
      key: "trainingGuide",
      file: "hotelplanner_training_guide.json",
      name: "Training Guide",
      kind: "json",
    },
    { key: "rppGuide", file: "rpp_protection_guide.json", name: "RPP Protection Guide", kind: "json" },
  ];

  const summary = [];
  for (const doc of docs) {
    const t0 = Date.now();
    try {
      console.log(`📥 Loading doc "${doc.name}"`, { key: doc.key, file: doc.file, kind: doc.kind });

      DOCUMENT_CACHE[doc.key] =
        doc.kind === "json"
          ? await fetchJsonDocument(doc.name, doc.file)
          : await fetchExcelDocument(doc.name, doc.file);

      summary.push(`✅ ${doc.name} (${doc.file}) in ${Date.now() - t0}ms`);
      console.log(`✅ Loaded "${doc.name}"`, { ms: Date.now() - t0 });
    } catch (e) {
      errlog(`❌ Failed to load ${doc.name}:`, e.message);
      summary.push(`❌ ${doc.name} (${doc.file}) -> ${e.message}`);
    }
  }

  LAST_LOAD = Date.now();
  DOCS_LOADING = false;

  console.log("📚 Document load summary:\n" + summary.join("\n"));
  console.log(`📦 Cached docs: ${Object.keys(DOCUMENT_CACHE).join(", ") || "(none)"}`);
  console.log("✅ loadDocuments finished.", { ts: new Date().toISOString() });
}

function buildContext(docsSelection) {
  const parts = [];
  const MAX_CHARS = 6000;

  const wantMatrix = true;

  if (docsSelection.qaVoice && DOCUMENT_CACHE.qaVoice) {
    parts.push(`QA VOICE RUBRIC:\n${JSON.stringify(DOCUMENT_CACHE.qaVoice).slice(0, MAX_CHARS)}`);
  }
  if (docsSelection.qaGroup && DOCUMENT_CACHE.qaGroup) {
    parts.push(`QA GROUPS RUBRIC:\n${JSON.stringify(DOCUMENT_CACHE.qaGroup).slice(0, MAX_CHARS)}`);
  }
  if (wantMatrix && DOCUMENT_CACHE.matrix) {
    parts.push(`SERVICE MATRIX 2026:\n${JSON.stringify(DOCUMENT_CACHE.matrix).slice(0, MAX_CHARS)}`);
  }
  if (docsSelection.trainingGuide && DOCUMENT_CACHE.trainingGuide) {
    parts.push(
      `TRAINING GUIDE (JSON):\n${JSON.stringify(DOCUMENT_CACHE.trainingGuide).slice(0, MAX_CHARS)}`
    );
  }
  if (docsSelection.rppGuide && DOCUMENT_CACHE.rppGuide) {
    parts.push(
      `RPP PROTECTION GUIDE (JSON):\n${JSON.stringify(DOCUMENT_CACHE.rppGuide).slice(0, MAX_CHARS)}`
    );
  }

  return parts.join("\n\n---\n\n") || "NOT FOUND IN DOCS";
}

// ✅✅✅ MATRIX: direct lookup (NO AI) for exact agent steps/scripts from Service Matrix
// Your layout: Column B = Concern, Column C = Answer/Steps (exact).

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

function isNoValue(v) {
  const s = norm(v);
  return (
    !s ||
    s === "no" ||
    s === "n" ||
    s === "none" ||
    s === "na" ||
    s === "n a" ||
    s === "n/a" ||
    s === "0" ||
    s === "false"
  );
}

function normalizeYesNo(v) {
  const s = norm(v);
  if (s === "y" || s === "yes" || s === "true" || s === "1") return "Yes";
  if (s === "n" || s === "no" || s === "false" || s === "0") return "No";
  return String(v ?? "").trim();
}

function detectHeaderRowIndex(rows) {
  const MAX_SCAN = Math.min(40, rows.length);
  for (let r = 0; r < MAX_SCAN; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const joined = row.map((x) => norm(x)).join(" | ");
    if (joined.includes("instructions") || joined.includes("concern") || joined.includes("issue")) {
      return r;
    }
  }
  return -1;
}

function buildHeaderMap(headerRow) {
  const map = new Map();
  if (!Array.isArray(headerRow)) return map;
  for (let i = 0; i < headerRow.length; i++) {
    const h = norm(headerRow[i]);
    if (!h) continue;
    if (!map.has(h)) map.set(h, i);
  }
  return map;
}

// ✅ Column C (index 2) is returned verbatim.
// ✅ Additionally, if your sheet has Slack/Refund Queue/Create Ticket/Supervisor columns with YES,
//    we append them as "Slack: Yes" etc (NO is omitted).
function extractMatrixSteps(rows, headerIndex, rowIndex) {
  const row = rows[rowIndex];
  if (!Array.isArray(row)) return null;

  const colC = String(row[2] ?? "").trim(); // Column C
  const base = colC && !isNoValue(colC) ? colC : "";

  const headerRow = headerIndex >= 0 ? rows[headerIndex] : null;
  const headerMap = buildHeaderMap(headerRow);

  const preferredHeaders = ["slack", "refund queue", "create a ticket", "supervisor"];

  const extras = [];
  for (const h of preferredHeaders) {
    if (!headerMap.has(h)) continue;
    const idx = headerMap.get(h);
    const v = row[idx];
    const yn = normalizeYesNo(v);
    const ynNorm = norm(yn);

    // Only show when it is a real "Yes" OR some non-empty meaningful value (like a channel name)
    if (!yn || isNoValue(yn)) continue;
    if (ynNorm === "no" || ynNorm === "n") continue;

    const label =
      h === "refund queue"
        ? "Refund Queue"
        : h === "create a ticket"
        ? "Create a Ticket"
        : h === "supervisor"
        ? "Supervisor"
        : "Slack";

    extras.push(`${label}: ${yn}`);
  }

  if (!base && !extras.length) return null;
  if (!extras.length) return base;

  return base ? `${base}\n\n${extras.join("\n")}` : extras.join("\n");
}

// Small alias expansion (fast + safe)
function expandQueryVariants(qNorm) {
  const variants = new Set([qNorm]);
  const add = (s) => s && variants.add(norm(s));

  if (
    qNorm.includes("double charged") ||
    qNorm.includes("charged twice") ||
    qNorm.includes("double charge")
  ) {
    add("double charged");
    add("charged twice");
    add("duplicate charge");
    add("double charge");
  }

  if (qNorm.includes("early departure")) {
    add("early departure after check in");
    add("early departure after check-in");
  }

  return Array.from(variants).filter(Boolean);
}

function scoreMatch(cellNorm, qNorm) {
  if (!cellNorm || !qNorm) return 0;
  if (cellNorm === qNorm) return 100;
  if (cellNorm.includes(qNorm) || qNorm.includes(cellNorm)) return 85;

  const qTokens = qNorm.split(" ").filter(Boolean);
  const cTokens = cellNorm.split(" ").filter(Boolean);
  if (!qTokens.length || !cTokens.length) return 0;

  const cSet = new Set(cTokens);
  let overlap = 0;
  for (const t of qTokens) if (cSet.has(t)) overlap++;

  const minOverlap = qTokens.length <= 2 ? 1 : 2;
  if (overlap < minOverlap) return 0;

  return Math.min(80, 45 + overlap * 10);
}

// ✅ Match Column B (index 1) as your "Concern" column, then return Column C (index 2)
function findDirectMatrixAnswer(matrixDoc, userQuestion) {
  if (!matrixDoc || typeof matrixDoc !== "object") {
    DEBUG && console.log("[matrix] not loaded / wrong type");
    return null;
  }

  const q0 = norm(userQuestion);
  if (!q0) return null;

  const queries = expandQueryVariants(q0);
  let bestHit = null;

  const tabNames = Object.keys(matrixDoc);
  DEBUG &&
    console.log("[matrix] searching", {
      q0,
      variants: queries,
      tabs: tabNames.length,
      tabsPreview: tabNames.slice(0, 10),
    });

  for (const [sheetName, rows] of Object.entries(matrixDoc)) {
    if (!Array.isArray(rows)) continue;

    const headerIndex = detectHeaderRowIndex(rows);

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;

      // ✅ primary: Column B only
      const colsToCheck = row.length > 1 ? [1] : [0];

      for (const c of colsToCheck) {
        const cellRaw = row[c];
        const cellNorm = norm(cellRaw);
        if (!cellNorm) continue;

        let score = 0;
        for (const q of queries) {
          score = Math.max(score, scoreMatch(cellNorm, q));
          if (score === 100) break;
        }
        if (score === 0) continue;

        const steps = extractMatrixSteps(rows, headerIndex, r);
        if (!steps) continue;

        const hit = {
          score,
          sheetName,
          rowIndex: r,
          colIndex: c,
          matchedText: String(cellRaw ?? "").trim(),
          answer: steps.trim(),
        };

        if (!bestHit || hit.score > bestHit.score) bestHit = hit;
      }
    }
  }

  if (DEBUG && bestHit) {
    console.log("[matrix] bestHit", {
      score: bestHit.score,
      sheet: bestHit.sheetName,
      row1Based: bestHit.rowIndex + 1,
      matchedText: bestHit.matchedText?.slice(0, 120),
    });
  } else if (DEBUG) {
    console.log("[matrix] no hit");
  }

  return bestHit;
}

// -------------------- providers --------------------
async function callNebius(question, systemPrompt) {
  log("[nebius] sending request...");
  const response = await fetch("https://api.tokenfactory.nebius.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${NEBIUS_API_KEY}`,
    },
    body: JSON.stringify({
      model: NEBIUS_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const errorMsg = err.error?.message || `Nebius API error: ${response.status}`;
    const e = new Error(errorMsg);
    e.status = response.status;
    throw e;
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || "No response";
}

async function callKimi(question, systemPrompt) {
  log("[kimi] sending request...");
  const response = await fetch("https://api.moonshot.cn/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KIMI_API_KEY}`,
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const errorMsg = err.error?.message || `Kimi API error: ${response.status}`;
    const e = new Error(errorMsg);
    e.status = response.status;
    throw e;
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || "No response";
}

async function callAnthropic(question, systemPrompt) {
  log("[anthropic] sending request...", { model: ANTHROPIC_MODEL });
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const msg = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1500,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: "user", content: question }],
  });

  return msg.content[0]?.text || "No response";
}

// -------------------- main handler --------------------
async function handleAsk(req, res) {
  const reqId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const { question, mode = "cloud", docs = {} } = req.body;

  console.log("➡️ /ask", {
    reqId,
    mode,
    provider: AI_PROVIDER,
    docs,
    qPreview: String(question || "").slice(0, 180),
  });

  if (!question) return res.status(400).json({ ok: false, error: "Missing question" });

  if (Object.keys(DOCUMENT_CACHE).length === 0 && !DOCS_LOADING) {
    console.log("📚 Cache empty. Triggering background loadDocuments()...");
    loadDocuments().catch((e) => errlog("docs load error:", e?.message || e));
  }

  if (mode === "local") {
    return res.json({
      ok: true,
      answer: `[LOCAL MODE]\nProvider: ${AI_PROVIDER}\nQ: ${question}`,
      provider: "local",
    });
  }

  const keyCheck = {
    nebius: NEBIUS_API_KEY,
    kimi: KIMI_API_KEY,
    anthropic: ANTHROPIC_API_KEY,
  };

  if (!keyCheck[AI_PROVIDER]) {
    console.error("❌ Missing provider key:", AI_PROVIDER);
    return res.status(500).json({
      ok: false,
      error: `Server missing ${AI_PROVIDER.toUpperCase()}_API_KEY`,
    });
  }

  try {
    // ✅ Matrix first (no AI): match Column B and return Column C (+ Yes-only flags)
    console.log("🔎 Matrix direct lookup starting...", {
      matrixLoaded: !!DOCUMENT_CACHE.matrix,
      cachedTabs: DOCUMENT_CACHE.matrix ? Object.keys(DOCUMENT_CACHE.matrix).length : 0,
    });

    const direct = findDirectMatrixAnswer(DOCUMENT_CACHE.matrix, question);

    console.log("🔎 Matrix lookup result:", direct ? { score: direct.score, sheet: direct.sheetName, row: direct.rowIndex + 1 } : null);

    if (direct && direct.score >= 70) {
      console.log("✅ Matrix DIRECT HIT - returning without AI", {
        reqId,
        sheet: direct.sheetName,
        row1Based: direct.rowIndex + 1,
        score: direct.score,
      });

      return res.json({
        ok: true,
        answer: direct.answer,
        provider: "matrix",
        model: "Service Matrix (Google Sheets)",
        citation: {
          doc: "Service Matrix 2026",
          source: "google_sheets",
          sheetId: MATRIX_SHEET_ID,
          tab: direct.sheetName,
          row: direct.rowIndex + 1,
          concernColumn: "B",
          answerColumn: "C",
        },
      });
    }

    console.log("🤖 No strong matrix hit. Falling back to AI with context...");

    const context = buildContext(docs);

    const systemPrompt = `
You are the "HotelPlanner Compliance & Revenue Copilot."
Your goal is to help agents resolve guest issues efficiently while protecting the company's revenue and maintaining 100% strict compliance.

YOUR SOURCES OF TRUTH (Hierarchy of Authority):
1. Service Matrix 2026 (Highest Authority)
2. RPP Protection Guide
3. QA Voice / QA Groups
4. Training Guide (General Context)
${context}

CORE INSTRUCTIONS:
1. **Analyze the Request Type:**
   - *General Question:* If the agent asks a policy question (e.g., "What is the fee for..."), answer directly citing the Matrix. Do not ask for guest details.
   - *Specific Scenario:* If the agent describes a specific guest situation, YOU MUST verify if enough info is present (Booking Status, Rate Type, Check-in Date). If not, ask for it immediately.

2. **Revenue Protection First:**
   - Unless the Matrix explicitly mandates a full refund, ALWAYS look for compliant alternatives first (e.g., Vouchers, Date Changes, or "Save the Sale" tactics found in RPP docs).

3. **Strict Compliance & Specificity:**
   - **CRITICAL:** Do NOT tell the agent to "check the Service Matrix" or "follow the procedure". YOU are the tool. You must read the Matrix content provided above and output the *exact* steps, fees, or rules the agent needs to follow.
   - Never invent policies. If a situation isn't in the docs, state: "SCENARIO NOT FOUND IN DOCS - Consult Team Lead."
   - If documents conflict, follow the Hierarchy of Authority above.
   - Never promise a refund unless the documentation explicitly guarantees it for that specific rate type/status.

OUTPUT FORMAT ( STRICTLY FOLLOW THIS):

🎯 **Action Plan:**
(1-2 sentences. Direct instruction on what button to click, what queue to use, or the exact policy outcome. Do NOT say "refer to matrix".)

🗣️ **Agent Script (Natural & Professional):**
"..."
(Provide the exact words the agent should say to the guest. Tone: Empathetic to the guest, but firm on policy.)

⚠️ **Compliance & Risk:**
- **Risk Level:** [Low / Medium / High]
- **Reasoning:** (One sentence explaining *why* this is the rule, e.g., "Strict Non-Refundable policy prevents revenue loss.")

📝 **Required Steps:**
1. [Step 1 from Matrix]
2. [Step 2 from Matrix]
(List the actual physical steps found in the documentation.)

🔍 **Citations:**
- [Doc: Name | Section: X | Row/Page: Y]
`.trim();

    let apiPromise;
    switch (AI_PROVIDER) {
      case "anthropic":
        apiPromise = callAnthropic(question, systemPrompt);
        break;
      case "nebius":
        apiPromise = callNebius(question, systemPrompt);
        break;
      case "kimi":
        apiPromise = callKimi(question, systemPrompt);
        break;
      default:
        throw new Error(`Unknown provider: ${AI_PROVIDER}`);
    }

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error("Request timeout"), { status: 504 })), 55000)
    );

    const answer = await Promise.race([apiPromise, timeoutPromise]);

    console.log("✅ AI success", { reqId, provider: AI_PROVIDER });
    return res.json({
      ok: true,
      answer,
      provider: AI_PROVIDER,
      model:
        AI_PROVIDER === "nebius"
          ? NEBIUS_MODEL
          : AI_PROVIDER === "kimi"
          ? KIMI_MODEL
          : ANTHROPIC_MODEL,
    });
  } catch (error) {
    errlog(`[${reqId}] Error:`, error?.message || error);
    const status = error.status || 500;

    return res.status(status).json({
      ok: false,
      error: error.message || "Unknown server error",
      provider: AI_PROVIDER,
    });
  }
}

["/api/claude", "/api/ask", "/api/query", "/ask"].forEach((route) => {
  app.post(route, handleAsk);
});

app.post("/admin/reload-docs", async (req, res) => {
  try {
    console.log("🔄 Admin requested reload-docs");
    await loadDocuments(true);
    res.json({ ok: true, message: "Documents reloaded", cached: Object.keys(DOCUMENT_CACHE) });
  } catch (e) {
    errlog("reload-docs error:", e?.message || e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not found",
    endpoints: [
      "/health",
      "/api/claude",
      "/api/ask",
      "/api/query",
      "/ask",
      "/api/reviews",
      "/api/reviews/upsert",
      "/api/reviews/ping",
      "/api/matrix/ping",
    ],
    provider: AI_PROVIDER,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Allowed Frontends: ${Array.from(ALLOWED_ORIGINS).join(", ")}`);
  console.log(`🤖 Current Provider: ${AI_PROVIDER.toUpperCase()}`);
  console.log(`🔑 Nebius: ${NEBIUS_API_KEY ? "✅" : "❌"}`);
  console.log(`🔑 Kimi: ${KIMI_API_KEY ? "✅" : "❌"}`);
  console.log(`🔑 Anthropic: ${ANTHROPIC_API_KEY ? "✅" : "❌"}`);
  safeSheetsStatusLog();

  console.log("⏳ Loading documents (background)...");
  loadDocuments().catch((e) => errlog("docs load error:", e?.message || e));
});
