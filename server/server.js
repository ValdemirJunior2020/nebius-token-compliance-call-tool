// server/server.js - Supports Kimi, Anthropic, and Nebius (FIXED CORS + Frontend URL handling)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import xlsx from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(process.cwd(), ".env") });

const app = express();

const PORT = Number(process.env.PORT || 5050);
const DEBUG = process.env.DEBUG === "true";
const AI_PROVIDER = (process.env.AI_PROVIDER || "nebius").toLowerCase();

const NEBIUS_API_KEY = process.env.NEBIUS_API_KEY || "";
const KIMI_API_KEY = process.env.KIMI_API_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

const NEBIUS_MODEL =
  process.env.NEBIUS_MODEL || "meta-llama/Meta-Llama-3.1-70B-Instruct";
const KIMI_MODEL = process.env.KIMI_MODEL || "moonshot-v1-8k";
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620";

const log = (...a) => DEBUG && console.log("[server]", ...a);
const errlog = (...a) => console.error("[server]", ...a);

let DOCUMENT_CACHE = {};
let LAST_LOAD = 0;

/**
 * IMPORTANT:
 * Your browser is showing "Failed to fetch" even though Render logs look fine.
 * That is almost always CORS blocking your Netlify domain.
 *
 * Set this in Render:
 * FRONTEND_URLS=https://nebius-api-call-compliance-tool.netlify.app,https://qa-tool-managment.netlify.app
 *
 * Or leave it and we allow *.netlify.app anyway.
 */
const FRONTEND_URLS = String(
  process.env.FRONTEND_URLS ||
    process.env.FRONTEND_URL ||
    "https://nebius-api-call-compliance-tool.netlify.app"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const FRONTEND_URL_DEV =
  process.env.FRONTEND_URL_DEV || "http://localhost:5173";

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

app.use(
  cors({
    origin: (origin, cb) => {
      // allow server-to-server, curl, health monitors
      if (!origin) return cb(null, true);

      if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      if (isNetlifySubdomain(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked origin: ${origin}`), false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  })
);

app.options("*", cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    port: PORT,
    provider: AI_PROVIDER,
    nebiusConfigured: !!NEBIUS_API_KEY,
    kimiConfigured: !!KIMI_API_KEY,
    anthropicConfigured: !!ANTHROPIC_API_KEY,
    documentsCached: Object.keys(DOCUMENT_CACHE),
    lastLoad: LAST_LOAD ? new Date(LAST_LOAD).toISOString() : null,
    frontendAllowed: Array.from(ALLOWED_ORIGINS),
    ts: new Date().toISOString(),
  });
});

async function fetchExcelDocument(docName, urlPath) {
  // Prefer a "docs host" (your Netlify site) to fetch the XLSX files.
  // Uses first FRONTEND_URLS entry by default.
  const docsBase =
    process.env.DOCS_BASE_URL || FRONTEND_URLS[0] || FRONTEND_URL_DEV;

  try {
    const netlifyUrl = `${String(docsBase).replace(/\/+$/, "")}/${urlPath}`;
    log(`Fetching ${docName} from ${netlifyUrl}`);

    const response = await fetch(netlifyUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const workbook = xlsx.read(buffer, { type: "buffer" });
    return parseWorkbook(workbook, docName);
  } catch (netlifyError) {
    log(`Docs fetch failed, trying local: ${netlifyError.message}`);
    const localPath = path.join(__dirname, "data", urlPath);
    if (!fs.existsSync(localPath))
      throw new Error(`Document not found: ${localPath}`);

    const workbook = xlsx.readFile(localPath);
    return parseWorkbook(workbook, docName);
  }
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
  if (Object.keys(DOCUMENT_CACHE).length > 0 && !force) return;

  const docs = [
    { key: "qaVoice", file: "qa-voice.xlsx", name: "QA Voice" },
    { key: "qaGroup", file: "qa-group.xlsx", name: "QA Groups" },
    { key: "matrix", file: "Service Matrix's 2026.xlsx", name: "Service Matrix" },
  ];

  for (const doc of docs) {
    try {
      DOCUMENT_CACHE[doc.key] = await fetchExcelDocument(doc.name, doc.file);
    } catch (err) {
      errlog(`❌ Failed to load ${doc.name}:`, err.message);
    }
  }

  LAST_LOAD = Date.now();
  log(`📚 Document cache updated: ${Object.keys(DOCUMENT_CACHE).join(", ")}`);
}

function buildContext(docsSelection) {
  const parts = [];
  const MAX_CHARS = 6000;

  if (docsSelection.qaVoice && DOCUMENT_CACHE.qaVoice) {
    parts.push(
      `QA VOICE RUBRIC:\n${JSON.stringify(DOCUMENT_CACHE.qaVoice).slice(
        0,
        MAX_CHARS
      )}`
    );
  }
  if (docsSelection.qaGroup && DOCUMENT_CACHE.qaGroup) {
    parts.push(
      `QA GROUPS RUBRIC:\n${JSON.stringify(DOCUMENT_CACHE.qaGroup).slice(
        0,
        MAX_CHARS
      )}`
    );
  }
  if (docsSelection.matrix && DOCUMENT_CACHE.matrix) {
    parts.push(
      `SERVICE MATRIX 2026:\n${JSON.stringify(DOCUMENT_CACHE.matrix).slice(
        0,
        MAX_CHARS
      )}`
    );
  }

  return parts.join("\n\n---\n\n") || "Use general call center best practices.";
}

async function callNebius(question, systemPrompt) {
  const response = await fetch(
    "https://api.tokenfactory.nebius.com/v1/chat/completions",
    {
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
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const errorMsg = err.error?.message || `Nebius API error: ${response.status}`;

    if (
      response.status === 402 ||
      errorMsg.includes("balance") ||
      errorMsg.includes("credit") ||
      errorMsg.includes("billing")
    ) {
      const e = new Error(errorMsg);
      e.noCredits = true;
      e.status = 402;
      throw e;
    }

    const e = new Error(errorMsg);
    e.status = response.status;
    throw e;
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || "No response";
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
    const errorMsg = err.error?.message || `Kimi API error: ${response.status}`;
    if (response.status === 402 || errorMsg.includes("credit") || errorMsg.includes("余额")) {
      const e = new Error(errorMsg);
      e.noCredits = true;
      e.status = 402;
      throw e;
    }
    const e = new Error(errorMsg);
    e.status = response.status;
    throw e;
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || "No response";
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

  return msg.content[0]?.text || "No response";
}

async function handleAsk(req, res) {
  const reqId = `req_${Date.now()}`;
  const { question, mode = "cloud", docs = {} } = req.body;

  log(`[${reqId}] Question: ${String(question || "").slice(0, 80)}...`);
  if (!question) return res.status(400).json({ ok: false, error: "Missing question" });

  if (Object.keys(DOCUMENT_CACHE).length === 0) await loadDocuments();

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
      case "nebius":
        apiPromise = callNebius(question, systemPrompt);
        break;
      case "kimi":
        apiPromise = callKimi(question, systemPrompt);
        break;
      case "anthropic":
        apiPromise = callAnthropic(question, systemPrompt);
        break;
      default:
        throw new Error(`Unknown provider: ${AI_PROVIDER}`);
    }

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
    errlog(`[${reqId}] Error:`, error.message);
    const status = error.status || 500;

    return res.status(status).json({
      ok: false,
      error: error.message,
      noCredits: !!error.noCredits,
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
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not found",
    endpoints: ["/health", "/api/claude"],
    provider: AI_PROVIDER,
  });
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Allowed Frontends: ${Array.from(ALLOWED_ORIGINS).join(", ")}`);
  console.log(`🤖 Current Provider: ${AI_PROVIDER.toUpperCase()}`);
  console.log(`🔑 Nebius: ${NEBIUS_API_KEY ? "✅" : "❌"}`);
  console.log(`🔑 Kimi: ${KIMI_API_KEY ? "✅" : "❌"}`);
  console.log(`🔑 Anthropic: ${ANTHROPIC_API_KEY ? "✅" : "❌"}`);

  const currentKey = { nebius: NEBIUS_API_KEY, kimi: KIMI_API_KEY, anthropic: ANTHROPIC_API_KEY }[AI_PROVIDER];

  if (currentKey) {
    console.log("⏳ Loading Excel documents...");
    await loadDocuments();
  } else {
    console.log(`⚠️  No API key for ${AI_PROVIDER}`);
  }
});
