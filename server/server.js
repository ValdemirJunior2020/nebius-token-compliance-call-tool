// server/server.js - Anthropic (Claude) + Excel + JSON docs + FIXED CORS + Reviews (Google Sheets)
// ✅ Fixes 502/health timeouts by NOT blocking startup with doc loading (preloads in background)
// ✅ Loads .env from repo root AND server/.env for local dev
// ✅ Adds safe guards: global error handlers + docs-loading flags

import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import xlsx from "xlsx";
import { listReviews, upsertReview } from "./lib/googleSheetsReviews.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------- dotenv (root + server/.env) --------------------
const ROOT_ENV = path.join(process.cwd(), ".env");
const SERVER_ENV = path.join(__dirname, ".env");

// Load repo-root first (Render uses Environment Vars anyway; this is for local dev)
dotenv.config({ path: ROOT_ENV });
// Then server/.env if it exists (local dev convenience)
if (fs.existsSync(SERVER_ENV)) dotenv.config({ path: SERVER_ENV });

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

// ✅ track loading so /health never “hangs”
let DOCS_LOADING = false;
let DOCS_LOADING_PROMISE = null;

// -------------------- Global crash guards (log + keep process alive) --------------------
process.on("unhandledRejection", (reason) => {
  console.error("[server] ❌ UnhandledRejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[server] ❌ UncaughtException:", error);
});

// -------------------- CORS (FIXED) --------------------
const FRONTEND_URLS = String(
  process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "https://nebius-api-call-compliance-tool.netlify.app"
)
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const FRONTEND_URL_DEV = (process.env.FRONTEND_URL_DEV || "http://localhost:5173").replace(/\/+$/, "");

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

  // Allow server-to-server calls (no Origin)
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

// -------------------- Reviews (Google Sheets) --------------------
app.get("/api/reviews", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim();
    const callCenter = String(req.query.callCenter || "").trim();

    const out = await listReviews({
      email: email || undefined,
      callCenter: callCenter || undefined,
    });

    res.json({ ok: true, ...out });
  } catch (e) {
    const msg = e?.message || "Failed to load reviews";
    console.error("[REVIEWS] list error:", e);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/reviews/upsert", async (req, res) => {
  try {
    const { callCenter, name, email, stars, comment } = req.body || {};
    log("[REVIEWS] upsert body:", { callCenter, name, email, stars, comment: String(comment || "").slice(0, 80) });

    const out = await upsertReview({ callCenter, name, email, stars, comment });

    log("[REVIEWS] upsert result:", out.action, out.review?.reviewId);
    res.json({ ok: true, ...out });
  } catch (e) {
    console.error("[REVIEWS] upsert error:", e);
    const msg = e?.message || "Failed to save review";
    const status = /missing field|invalid email|invalid stars|invalid/i.test(msg) ? 400 : 500;
    res.status(status).json({ ok: false, error: msg });
  }
});

// -------------------- health --------------------
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    port: PORT,
    provider: AI_PROVIDER,
    nebiusConfigured: !!NEBIUS_API_KEY,
    kimiConfigured: !!KIMI_API_KEY,
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    sheetsConfigured: {
      email: !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      key: !!process.env.GOOGLE_SHEETS_PRIVATE_KEY,
      sheetId: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      tab: !!process.env.GOOGLE_SHEETS_TAB_NAME,
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
// ✅ Prefer local repo assets first (Render + local dev)
const LOCAL_ASSETS_DIR = path.join(__dirname, "../client/public/Assets");
const LOCAL_SERVER_DATA_DIR = path.join(__dirname, "data");

// ✅ Netlify/Frontend base (only used as final fallback)
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
  // 1) LOCAL FIRST
  const localPath = resolveLocalDocPath(fileName);
  if (localPath) {
    log(`Loading ${docName} from local: ${localPath}`);
    const workbook = xlsx.readFile(localPath);
    return parseWorkbook(workbook, docName);
  }

  // 2) REMOTE FALLBACK
  const docsBase = getDocsBase();
  const netlifyUrl = `${String(docsBase).replace(/\/+$/, "")}/Assets/${encodeURIComponent(fileName)}`;
  log(`Fetching ${docName} from remote: ${netlifyUrl}`);

  const response = await fetch(netlifyUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${netlifyUrl}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const workbook = xlsx.read(buffer, { type: "buffer" });
  return parseWorkbook(workbook, docName);
}

async function fetchJsonDocument(docName, fileName) {
  // 1) LOCAL FIRST
  const localPath = resolveLocalDocPath(fileName);
  if (localPath) {
    log(`Loading ${docName} from local: ${localPath}`);
    const raw = fs.readFileSync(localPath, "utf-8");
    const json = JSON.parse(raw);
    log(`✅ Parsed ${docName}: JSON keys=${Object.keys(json || {}).length}`);
    return json;
  }

  // 2) REMOTE FALLBACK
  const docsBase = getDocsBase();
  const netlifyUrl = `${String(docsBase).replace(/\/+$/, "")}/Assets/${encodeURIComponent(fileName)}`;
  log(`Fetching ${docName} from remote: ${netlifyUrl}`);

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

async function loadDocuments(force = false) {
  if (!force && Object.keys(DOCUMENT_CACHE).length > 0) return;

  // prevent overlapping loads
  if (DOCS_LOADING_PROMISE && !force) return DOCS_LOADING_PROMISE;

  const docs = [
    { key: "qaVoice", file: "qa-voice.xlsx", name: "QA Voice", kind: "excel" },
    { key: "qaGroup", file: "qa-group.xlsx", name: "QA Groups", kind: "excel" },
    { key: "matrix", file: "Service Matrix's 2026.xlsx", name: "Service Matrix", kind: "excel" },
    { key: "trainingGuide", file: "hotelplanner_training_guide.json", name: "Training Guide", kind: "json" },
    { key: "rppGuide", file: "rpp_protection_guide.json", name: "RPP Protection Guide", kind: "json" },
  ];

  DOCS_LOADING = true;

  DOCS_LOADING_PROMISE = (async () => {
    const timings = [];

    for (const doc of docs) {
      const t0 = Date.now();
      try {
        DOCUMENT_CACHE[doc.key] =
          doc.kind === "json"
            ? await fetchJsonDocument(doc.name, doc.file)
            : await fetchExcelDocument(doc.name, doc.file);

        timings.push({ ok: true, name: doc.name, file: doc.file, ms: Date.now() - t0 });
      } catch (e) {
        timings.push({ ok: false, name: doc.name, file: doc.file, ms: Date.now() - t0, err: e?.message || String(e) });
        errlog(`❌ Failed to load ${doc.name}:`, e?.message || e);
      }
    }

    LAST_LOAD = Date.now();
    DOCS_LOADING = false;

    console.log("📚 Document load summary:");
    for (const r of timings) {
      console.log(`${r.ok ? "✅" : "❌"} ${r.name} (${r.file}) in ${r.ms}ms${r.ok ? "" : ` :: ${r.err}`}`);
    }
    console.log(`📦 Cached docs: ${Object.keys(DOCUMENT_CACHE).join(", ") || "(none)"}`);
    console.log("✅ Documents load finished.");

    DOCS_LOADING_PROMISE = null;
  })();

  return DOCS_LOADING_PROMISE;
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
    parts.push(`TRAINING GUIDE (JSON):\n${JSON.stringify(DOCUMENT_CACHE.trainingGuide).slice(0, MAX_CHARS)}`);
  }
  if (docsSelection.rppGuide && DOCUMENT_CACHE.rppGuide) {
    parts.push(`RPP PROTECTION GUIDE (JSON):\n${JSON.stringify(DOCUMENT_CACHE.rppGuide).slice(0, MAX_CHARS)}`);
  }

  return parts.join("\n\n---\n\n") || "NOT FOUND IN DOCS";
}

// -------------------- providers --------------------
async function callNebius(question, systemPrompt) {
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
    const errorMsg = err?.error?.message || `Nebius API error: ${response.status}`;
    const e = new Error(errorMsg);
    e.status = response.status;
    throw e;
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "No response";
}

async function callKimi(question, systemPrompt) {
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
    const errorMsg = err?.error?.message || `Kimi API error: ${response.status}`;
    const e = new Error(errorMsg);
    e.status = response.status;
    throw e;
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "No response";
}

async function callAnthropic(question, systemPrompt) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const msg = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1500,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: "user", content: question }],
  });

  return msg?.content?.[0]?.text || "No response";
}

// -------------------- main handler --------------------
async function handleAsk(req, res) {
  const reqId = `req_${Date.now()}`;
  const { question, mode = "cloud", docs = {} } = req.body || {};

  log(`[${reqId}] Question: ${String(question || "").slice(0, 120)}...`);
  if (!question) return res.status(400).json({ ok: false, error: "Missing question" });

  // lazy-load docs on first ask (non-blocking)
  if (Object.keys(DOCUMENT_CACHE).length === 0 && !DOCS_LOADING) {
    // fire and forget
    loadDocuments(false).catch((e) => errlog("Doc load error:", e?.message || e));
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
    return res.status(500).json({
      ok: false,
      error: `Server missing ${AI_PROVIDER.toUpperCase()}_API_KEY`,
    });
  }

  try {
    const context = buildContext(docs);

    const systemPrompt = `
You are "QA Master" — the strictest, smartest HotelPlanner Call Center Quality & Compliance Analyst.

YOUR JOB
- Give agents the exact compliant procedure for the guest situation.
- Use ONLY the provided documents as your source of truth:
${context}

NON-NEGOTIABLE RULES (HARD FAIL IF BROKEN)
1) Do NOT use outside knowledge. If the docs do not cover it, say: "NOT FOUND IN DOCS" and ask 1–2 clarifying questions.
2) Do NOT invent policies, time limits, fees, refund eligibility, or steps.
3) ALWAYS prefer the most restrictive/compliance-safe option when multiple options exist, and explain why using citations.
4) If there is a conflict between docs, resolve by priority:
   Service Matrix 2026 > QA Voice > QA Groups > Training Guide
   If still unclear, output: "CONFLICT IN DOCS" + quote the conflicting sections and ask what to follow.
5) Never promise outcomes (refund approved / cancellation confirmed) unless docs explicitly say it can be confirmed.
6) For any booking-related issue, require verification fields when applicable:
   Itinerary/confirmation #, guest name, hotel name, check-in, check-out, destination/city.
7) Keep it short, executable, and measurable.

OUTPUT FORMAT (ALWAYS EXACTLY THIS)
Acknowledge:
- (1 sentence empathic acknowledgement)

Decision:
- One line: the correct path / dropdown / queue / action outcome

Steps:
1) ...
2) ...
3) ...

Do/Don’t Script (agent lines):
- Say: "..."
- Say: "..."
- Don’t say: "..."

Citations:
- [Doc: <name> | Sheet/Section: <sheet/heading> | Row/Cell: <reference>]
- [Doc: ...]
(If you cannot cite: write "NO CITATION AVAILABLE" and stop.)

QUALITY CHECK
- Compliance Risk: Low/Medium/High + 1 reason
- Missing Info Needed: (list) or "None"

Now answer the user question using the rules above.
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

    log(`[${reqId}] Success (${AI_PROVIDER})`);
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
    const status = error?.status || 500;

    return res.status(status).json({
      ok: false,
      error: error?.message || "Unknown server error",
      provider: AI_PROVIDER,
    });
  }
}

["/api/claude", "/api/ask", "/api/query", "/ask"].forEach((route) => {
  app.post(route, handleAsk);
});

app.post("/admin/reload-docs", async (req, res) => {
  try {
    await loadDocuments(true);
    res.json({ ok: true, message: "Documents reloaded", cached: Object.keys(DOCUMENT_CACHE) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "Failed to reload docs" });
  }
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not found",
    endpoints: ["/health", "/api/claude", "/api/reviews", "/api/reviews/upsert"],
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

  console.log(
    `🧾 Sheets: email=${process.env.GOOGLE_SHEETS_CLIENT_EMAIL ? "✅" : "❌"} key=${
      process.env.GOOGLE_SHEETS_PRIVATE_KEY ? "✅" : "❌"
    } sheetId=${process.env.GOOGLE_SHEETS_SPREADSHEET_ID ? "✅" : "❌"} tab=${
      process.env.GOOGLE_SHEETS_TAB_NAME ? "✅" : "❌"
    }`
  );

  // ✅ IMPORTANT: preload docs in the background so /health never gets blocked
  const hasAnyKey = { nebius: NEBIUS_API_KEY, kimi: KIMI_API_KEY, anthropic: ANTHROPIC_API_KEY }[AI_PROVIDER];
  if (hasAnyKey) {
    console.log("⏳ Loading documents (background)...");
    setTimeout(() => {
      loadDocuments(false).catch((e) => errlog("Doc load error:", e?.message || e));
    }, 0);
  } else {
    console.log(`⚠️  No API key for ${AI_PROVIDER}`);
  }
});
