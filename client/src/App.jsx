import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import "./App.css";

// LOCAL TESTING: http://localhost:5050
// PRODUCTION: https://your-render-app.onrender.com
const API_BASE = "https://nebius-token-compliance-call-tool.onrender.com";

// ✅ UI label for your cloud model (you are using Claude)
const CLOUD_PROVIDER_LABEL = "Claude";

// ✅ INPUT LIMIT (saves money by preventing huge prompts)
const MAX_USER_INPUT_CHARS = 1200;

// public assets
const LOADING_GIF_SRC = "/loading.gif";
const NAV_LOGO_VIDEO_SRC = "/Video_Generation_Confirmation.mp4";
const ERROR_VIDEO_SRC = "/error.mp4";

// downloads (public)
const QA_GROUP_XLSX_PATH = "/qa-group.xlsx";
const QA_VOICE_XLSX_PATH = "/qa-voice.xlsx";
const MATRIX_PUBLIC_PATH = "/Service Matrix's 2026.xlsx";

// ✅ Training guide JSON (client/public/hotelplanner_training_guide.json)
const TRAINING_GUIDE_JSON_PATH = "/hotelplanner_training_guide.json";

// --- QA Master Intro (fixed text) --------------------------------------------
const QA_MASTER_INTRO = `I'm ready to assist as QA Master.

Please provide the guest situation or agent question so I can give you the exact compliant procedure.
`;

// --- logging ----------------------------------------------------------------
const DEBUG = true;
function log(...args) {
  if (!DEBUG) return;
  console.log("[CC]", ...args);
}
function warn(...args) {
  if (!DEBUG) return;
  console.warn("[CC]", ...args);
}
function errlog(...args) {
  if (!DEBUG) return;
  console.error("[CC]", ...args);
}

// --- utils -------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function genId() {
  try {
    return crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return String(Date.now());
  }
}
function safeString(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
function normalizeWs(s) {
  return safeString(s).replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function isAbort(error) {
  return error?.name === "AbortError" || /aborted/i.test(String(error?.message || ""));
}
function asHumanError(error) {
  const msg = String(error?.message || error || "");
  return msg.length > 900 ? msg.slice(0, 900) + "…" : msg;
}
function stripDangerousHtml(html) {
  let out = String(html || "");
  out = out.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  out = out.replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");
  out = out.replace(/(href|src)\s*=\s*("|\')\s*javascript:[\s\S]*?\2/gi, "$1=$2#$2");
  return out;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    log("fetchWithTimeout ->", { url, timeoutMs });
    const res = await fetch(url, { ...options, signal: ctrl.signal, cache: "no-store" });
    log("fetchWithTimeout <-", { url, status: res.status, ok: res.ok });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function postToAnyEndpoint({ base, paths, payload, timeoutMs }) {
  let lastErr = null;
  for (const p of paths) {
    const url = base.replace(/\/+$/, "") + p;
    log("POST attempt:", url);
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        timeoutMs
      );
      const contentType = res.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");
      const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");
      log("POST response:", { path: p, status: res.status, isJson });
      if (!res.ok) {
        const detailText = normalizeWs(isJson ? safeString(body) : body) || res.statusText;
        const error = new Error(`HTTP ${res.status} on ${p}: ${detailText}`);
        error.status = res.status;
        error.body = body;
        error.path = p;
        throw error;
      }
      return { ok: true, status: res.status, path: p, body };
    } catch (e) {
      lastErr = e;
      warn("POST failed:", { path: p, status: e?.status, message: String(e?.message || e) });
      if (e?.status === 401 || e?.status === 403) throw e;
      if (isAbort(e)) throw e;
    }
  }
  throw lastErr || new Error("No endpoint responded.");
}

function pickAnswerFromBody(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;

  const candidates = [
    body.answer,
    body.text,
    body.message,
    body.result,
    body.output,
    body.content,
    body?.data?.answer,
    body?.data?.text,
    body?.data?.message,
  ];
  for (const c of candidates) {
    const s = normalizeWs(c);
    if (s) return s;
  }
  return normalizeWs(body);
}

function tryLoadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const v = raw == null ? fallback : JSON.parse(raw);
    return v;
  } catch (e) {
    return fallback;
  }
}

function trySaveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

function useAutoResizeTextarea(ref, value) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    const next = clamp(el.scrollHeight, 28, 200);
    el.style.height = next + "px";
  }, [ref, value]);
}

// --- Error Boundary -----------------------------------------------------------
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    errlog("ErrorBoundary:", error, info);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="cc-root">
        <div className="cc-thread">
          <div className="cc-threadInner">
            <div className="cc-bannerError">
              <div style={{ fontWeight: 700 }}>🚨 UI Error</div>
              <div className="cc-bannerSub">Refresh to fix.</div>
              <button className="cc-sendBtn" onClick={() => window.location.reload()} style={{ marginTop: 10 }}>
                Reload
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

// --- UI Configuration ---------------------------------------------------------
// ✅ Matrix is ALWAYS included (locked ON). Buttons choose extra docs.
const DEFAULT_DOCS = {
  matrix: true, // locked
  trainingGuide: true,
  qaVoice: true,
  qaGroup: false,
};

const DOC_META = [
  { key: "matrix", label: "Matrix 2026", path: MATRIX_PUBLIC_PATH, locked: true },
  { key: "trainingGuide", label: "Training Guide (JSON)", path: TRAINING_GUIDE_JSON_PATH },
  { key: "qaVoice", label: "QA Voice", path: QA_VOICE_XLSX_PATH },
  { key: "qaGroup", label: "QA Groups", path: QA_GROUP_XLSX_PATH },
];

const RESOURCES = [
  { label: "Service Matrix 2026 (.xlsx)", href: MATRIX_PUBLIC_PATH, fileName: "Service Matrix's 2026.xlsx" },
  { label: "Training Guide (JSON)", href: TRAINING_GUIDE_JSON_PATH, fileName: "hotelplanner_training_guide.json" },
  { label: "QA Voice (.xlsx)", href: QA_VOICE_XLSX_PATH, fileName: "qa-voice.xlsx" },
  { label: "QA Groups (.xlsx)", href: QA_GROUP_XLSX_PATH, fileName: "qa-group.xlsx" },
];

function buildPayload({ question, mode, docs }) {
  return {
    question,
    mode,
    docs,
    client: { app: "Call Center Compliance App", ts: nowIso(), ui: "react" },
  };
}

function build404Message({ apiBase, attemptedPath }) {
  const base = (apiBase || "").replace(/\/+$/, "");
  return normalizeWs(`
🔎 Server cannot find the requested resource (HTTP 404).

Frontend tried: ${attemptedPath || "(unknown path)"}

Fix:
1) Check that server.js has the route: app.post("/api/claude", ...)
2) Verify API_BASE in App.jsx matches your server URL
3) Try: ${base}/health (should return JSON)

Current API_BASE: ${apiBase}
`);
}

function isNoCreditsError(e) {
  const status = Number(e?.status || 0);
  const rawBody = safeString(e?.body);
  const msg = String(e?.message || "");
  const hay = (msg + "\n" + rawBody).toLowerCase();
  const hit =
    hay.includes("credit") ||
    hay.includes("billing") ||
    hay.includes("余额") ||
    hay.includes("insufficient") ||
    status === 402;
  return hit && (status === 400 || status === 402 || status === 403);
}

function buildNoCreditsMessage() {
  return normalizeWs(`
💳 No credits available.

Fix:
1) Check your AI provider billing / credits
2) Restart the server after updating credentials
`);
}

function MessageBubble({ m, isIntro }) {
  const isUser = m.role === "user";
  const isAssistant = m.role === "assistant";

  const html = useMemo(() => {
    if (!isAssistant) return "";
    const raw = normalizeWs(m.text);
    if (!raw) return "";
    marked.setOptions({ gfm: true, breaks: true, mangle: false, headerIds: false });
    return stripDangerousHtml(marked.parse(raw));
  }, [m.text, isAssistant]);

  return (
    <div className={`cc-msg ${isUser ? "cc-user" : "cc-assistant"} ${isIntro ? "cc-intro" : ""}`}>
      <div className={`cc-bubble ${isAssistant ? "cc-bubbleAssistant" : ""}`}>
        {m.kind === "loading" ? (
          <div className="cc-loadingWrap">
            <img
              className="cc-loadingGif"
              src={LOADING_GIF_SRC}
              alt="loading"
              onError={(e) => {
                e.currentTarget.src = "https://media.tenor.com/e_E1hMZnbdAAAAAi/meme-coffee.gif";
              }}
            />
            <div className="cc-thinking">{m.thinkingText || `Thinking with ${CLOUD_PROVIDER_LABEL}…`}</div>
          </div>
        ) : m.kind === "error401" ? (
          <div className="cc-loadingWrap">
            <video className="cc-errorVideo" autoPlay loop muted playsInline src={ERROR_VIDEO_SRC} />
            <div className="cc-errorHint">
              <div className="cc-error" style={{ textAlign: "center" }}>
                🔒 Unauthorized (401)
              </div>
              <div className="cc-bannerSub" style={{ textAlign: "center" }}>
                Check your server API key / auth.
              </div>
              {m.text ? (
                <pre className="cc-error" style={{ marginTop: 10 }}>
                  {normalizeWs(m.text)}
                </pre>
              ) : null}
            </div>
          </div>
        ) : m.kind === "error404" ? (
          <div className="cc-error">{normalizeWs(m.text)}</div>
        ) : m.kind === "errorNoCredits" ? (
          <div className="cc-loadingWrap">
            <video className="cc-errorVideo" autoPlay loop muted playsInline src={ERROR_VIDEO_SRC} />
            <div className="cc-errorHint">
              <div className="cc-error" style={{ textAlign: "center" }}>
                💳 Credits / billing issue.
              </div>
              {m.text ? (
                <pre className="cc-error" style={{ marginTop: 10 }}>
                  {normalizeWs(m.text)}
                </pre>
              ) : null}
            </div>
          </div>
        ) : m.kind === "error" ? (
          <div className="cc-error">{normalizeWs(m.text)}</div>
        ) : isAssistant ? (
          <div className="cc-answer" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="cc-bubbleText">{normalizeWs(m.text)}</div>
        )}
      </div>
    </div>
  );
}

function ResourcePopover({ open, onClose }) {
  if (!open) return null;
  return (
    <>
      <div className="cc-popoverScrim" onClick={onClose} />
      <div className="cc-popover" role="dialog" aria-modal="true">
        <div className="cc-popoverHeader">
          <div className="cc-popoverTitle">Resources</div>
          <button className="cc-pillBtn cc-pillBtnGhost" onClick={onClose} type="button" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="cc-popoverBody">
          <div className="cc-popoverHint">Download compliance files:</div>
          <div className="cc-resourceList">
            {RESOURCES.map((r) => (
              <a key={r.href} className="cc-resourceItem" href={r.href} download={r.fileName} target="_blank" rel="noreferrer">
                <div className="cc-resourceName">{r.label}</div>
                <div className="cc-resourceSub">{r.fileName}</div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// --- Main App ----------------------------------------------------------------
export default function App() {
  const textareaRef = useRef(null);
  const threadEndRef = useRef(null);

  // ✅ stop random "local" mode stuck in localStorage
  const [mode, setMode] = useState(() => {
    const saved = tryLoadLocal("cc_mode", "cloud");
    return saved === "local" || saved === "cloud" ? saved : "cloud";
  });

  // docs state (matrix always true)
  const [docs, setDocs] = useState(() => {
    const saved = tryLoadLocal("cc_docs", DEFAULT_DOCS);
    return { ...DEFAULT_DOCS, ...(saved || {}), matrix: true };
  });

  // availability (real check)
  const [docAvail, setDocAvail] = useState(() =>
    DOC_META.reduce((acc, d) => {
      acc[d.key] = true; // optimistic until probed
      return acc;
    }, {})
  );

  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [banner, setBanner] = useState(null);
  const [health, setHealth] = useState({ ok: null, last: null });
  const [resourcesOpen, setResourcesOpen] = useState(false);

  const [messages, setMessages] = useState(() => [
    {
      id: genId(),
      role: "assistant",
      text: QA_MASTER_INTRO,
      ts: Date.now(),
    },
  ]);

  useAutoResizeTextarea(textareaRef, input);

  const firstAssistantId = useMemo(() => messages.find((x) => x.role === "assistant")?.id ?? null, [messages]);

  const activeDocsLabel = useMemo(() => {
    const enabled = DOC_META.filter((d) => (d.locked ? true : !!docs[d.key]))
      .filter((d) => !!docAvail[d.key])
      .map((d) => d.label);
    return enabled.length ? enabled.join(", ") : "No docs selected";
  }, [docs, docAvail]);

  const scrollToBottom = useCallback(() => {
    const el = threadEndRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => trySaveLocal("cc_mode", mode), [mode]);
  useEffect(() => trySaveLocal("cc_docs", { ...docs, matrix: true }), [docs]);

  // ✅ probe which docs exist (so chips can disable + show clear banner)
  const probeDocs = useCallback(async () => {
    const results = {};
    for (const d of DOC_META) {
      try {
        // HEAD sometimes blocked by some hosts; fallback to GET if needed
        const head = await fetchWithTimeout(d.path, { method: "HEAD" }, 8000).catch(() => null);
        if (head && head.ok) {
          results[d.key] = true;
        } else {
          const get = await fetchWithTimeout(d.path, { method: "GET" }, 8000);
          results[d.key] = !!get.ok;
        }
      } catch (e) {
        results[d.key] = false;
      }
    }
    setDocAvail((prev) => ({ ...prev, ...results }));
  }, []);

  // Check server health
  const runHealthCheck = useCallback(async () => {
    try {
      const url = `${API_BASE.replace(/\/+$/, "")}/health`;
      const res = await fetchWithTimeout(url, {}, 8000);
      const ok = res.ok;
      setHealth({ ok, last: Date.now() });
      if (!ok) setBanner({ type: "error", title: "🛰️ Server offline", sub: `Health check failed: ${res.status}` });
    } catch (e) {
      setHealth({ ok: false, last: Date.now() });
      setBanner({ type: "error", title: "🛰️ Server not reachable", sub: isAbort(e) ? "Timeout." : asHumanError(e) });
    }
  }, []);

  useEffect(() => {
    runHealthCheck();
    probeDocs();
    const t = setInterval(() => runHealthCheck(), 60000);
    const t2 = setInterval(() => probeDocs(), 120000);
    return () => {
      clearInterval(t);
      clearInterval(t2);
    };
  }, [runHealthCheck, probeDocs]);

  const addMessage = useCallback((m) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const replaceLastAssistant = useCallback((replacement) => {
    setMessages((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === "assistant") {
          copy[i] = { ...copy[i], ...replacement };
          break;
        }
      }
      return copy;
    });
  }, []);

  const toggleDoc = useCallback((key) => {
    // ✅ matrix is locked ON
    if (key === "matrix") return;
    setDocs((prev) => ({ ...prev, [key]: !prev[key], matrix: true }));
  }, []);

  const clearInput = useCallback(() => {
    setInput("");
    textareaRef.current?.focus?.();
    setBanner(null);
  }, []);

  const setModeSafe = useCallback((next) => {
    setMode(next === "local" ? "local" : "cloud");
    setBanner(null);
  }, []);

  const send = useCallback(async () => {
    const question = normalizeWs(input);
    if (!question || isSending) return;

    if (question.length > MAX_USER_INPUT_CHARS) {
      setBanner({
        type: "error",
        title: "✂️ Message too long",
        sub: `Please keep your message under ${MAX_USER_INPUT_CHARS} characters.`,
      });
      return;
    }

    // ✅ always include matrix + only selected docs
    const docsForPayload = { ...docs, matrix: true };

    // ✅ if user accidentally turned everything off except matrix (or matrix missing), protect:
    const enabledCount = DOC_META.reduce((n, d) => {
      const enabled = d.locked ? true : !!docsForPayload[d.key];
      const available = !!docAvail[d.key];
      return n + (enabled && available ? 1 : 0);
    }, 0);

    if (enabledCount === 0) {
      setBanner({
        type: "error",
        title: "📌 No docs available",
        sub: "Docs are missing/unreachable. Make sure the files exist in client/public and are deployed.",
      });
      return;
    }

    // warn if a selected doc is missing
    const missingSelected = DOC_META.filter((d) => (d.locked ? true : !!docsForPayload[d.key]))
      .filter((d) => !docAvail[d.key])
      .map((d) => d.label);

    if (missingSelected.length) {
      setBanner({
        type: "error",
        title: "📁 Missing file(s)",
        sub: `These selected docs are not reachable: ${missingSelected.join(", ")}.`,
      });
      // still allow send (server may load locally); remove return if you want hard-block
      // return;
    } else {
      setBanner(null);
    }

    setIsSending(true);

    addMessage({ id: genId(), role: "user", text: question, ts: Date.now() });
    addMessage({
      id: genId(),
      role: "assistant",
      kind: "loading",
      text: "",
      thinkingText: `Analyzing with ${CLOUD_PROVIDER_LABEL}…`,
      ts: Date.now(),
    });

    setInput("");

    const payload = buildPayload({
      question,
      mode,
      docs: {
        ...docsForPayload,
        _availability: docAvail,
        _activeDocsLabel: activeDocsLabel,
      },
    });

    const endpoints = ["/api/claude"];

    try {
      const result = await postToAnyEndpoint({ base: API_BASE, paths: endpoints, payload, timeoutMs: 65000 });
      const answerText = pickAnswerFromBody(result?.body);
      const finalText = normalizeWs(answerText) || "No answer returned.";

      replaceLastAssistant({
        kind: undefined,
        text: finalText,
        ts: Date.now(),
        meta: {
          endpoint: result?.path,
          status: result?.status,
          provider: result?.body?.provider || "claude",
        },
      });

      setHealth((h) => ({ ...h, ok: true, last: Date.now() }));
    } catch (e) {
      errlog("send() error:", e);
      const status = e?.status;

      if (status === 401) {
        replaceLastAssistant({ kind: "error401", text: normalizeWs(e?.message), ts: Date.now() });
      } else if (status === 404) {
        const friendly404 = build404Message({ apiBase: API_BASE, attemptedPath: e?.path });
        replaceLastAssistant({ kind: "error404", text: friendly404, ts: Date.now(), meta: { endpoint: e?.path, status } });
        setBanner({ type: "error", title: "🧯 Endpoint not found", sub: `Route ${e?.path} does not exist on server.` });
      } else if (isNoCreditsError(e)) {
        const noCreditsText = buildNoCreditsMessage();
        replaceLastAssistant({ kind: "errorNoCredits", text: noCreditsText, ts: Date.now(), meta: { status, endpoint: e?.path } });
        setBanner({ type: "error", title: "💳 Credits / billing issue", sub: "Check provider billing/credits." });
      } else {
        const friendly =
          status === 429
            ? "⏳ Rate limit (429)."
            : status === 413
            ? "📦 Request too large (413)."
            : isAbort(e)
            ? "⏱️ Timed out."
            : status
            ? `⚠️ Server error (HTTP ${status}).`
            : "⚠️ Network error.";

        replaceLastAssistant({ kind: "error", text: `${friendly}\n\n${normalizeWs(e?.message || asHumanError(e))}`, ts: Date.now() });
        setBanner({ type: "error", title: "🧯 Error", sub: normalizeWs(e?.message || asHumanError(e)) });
      }

      setHealth((h) => ({ ...h, ok: false, last: Date.now() }));
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, docs, mode, addMessage, replaceLastAssistant, docAvail, activeDocsLabel]);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  const remainingChars = MAX_USER_INPUT_CHARS - (input?.length || 0);

  return (
    <ErrorBoundary>
      <div className="cc-root">
        {/* NAVBAR */}
        <div className="cc-topbar">
          <div className="cc-navPill">
            <img className="cc-navLogo" src="/HP-logo-gold.png" alt="HotelPlanner" />
            <button className={`cc-navItem ${resourcesOpen ? "cc-navItemPill is-active" : ""}`} type="button" onClick={() => setResourcesOpen(true)}>
              Resources
            </button>
            <div className="cc-navTitle">Call Center Compliance Tool</div>
            <div className="cc-navSpacer" />
          </div>
        </div>

        <ResourcePopover open={resourcesOpen} onClose={() => setResourcesOpen(false)} />

        {/* Main Content */}
        <div className="cc-main">
          <div className="cc-thread">
            <div className="cc-threadInner">
              {banner ? (
                <div className="cc-bannerError">
                  <div style={{ fontWeight: 700 }}>{banner.title}</div>
                  <div className="cc-bannerSub">{banner.sub}</div>
                </div>
              ) : null}

              <div className="cc-hero">
                <div className="cc-heroTitle">
                  Mode: <b>{mode === "cloud" ? CLOUD_PROVIDER_LABEL : "Local"}</b> • Docs: <b>{activeDocsLabel}</b>
                </div>
                <div className="cc-heroSub">
                  Server:{" "}
                  <span style={{ fontWeight: 700 }}>{health.ok == null ? "checking…" : health.ok ? "online" : "offline"}</span>
                  {health.last ? (
                    <span style={{ marginLeft: 8, color: "rgba(17,24,39,0.45)", fontSize: 12 }}>({new Date(health.last).toLocaleTimeString()})</span>
                  ) : null}
                </div>
              </div>

              {messages.map((m) => (
                <MessageBubble key={m.id} m={m} isIntro={m.id === firstAssistantId} />
              ))}

              <div ref={threadEndRef} />
              <div className="cc-spacer" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="cc-footer">
          <div className="cc-footer-inner">
            {/* Mode toggle (so you never get stuck in Local unknowingly) */}
            <div className="cc-modeRow">
              <button className={`cc-chip ${mode === "cloud" ? "is-active" : ""}`} type="button" onClick={() => setModeSafe("cloud")} aria-pressed={mode === "cloud"}>
                Cloud
              </button>
              <button className={`cc-chip ${mode === "local" ? "is-active" : ""}`} type="button" onClick={() => setModeSafe("local")} aria-pressed={mode === "local"}>
                Local
              </button>
            </div>

            <div className="cc-docRow">
              {DOC_META.map((d) => {
                const locked = !!d.locked;
                const active = locked ? true : !!docs[d.key];
                const available = !!docAvail[d.key];
                const disabled = !available;

                return (
                  <button
                    key={d.key}
                    className={`cc-chip ${active ? "is-active" : ""} ${locked ? "is-locked" : ""} ${disabled ? "is-disabled" : ""}`}
                    title={
                      locked
                        ? `${d.label} (always included)`
                        : disabled
                        ? `${d.label} unavailable`
                        : `Toggle ${d.label}`
                    }
                    onClick={() => {
                      if (locked) return;
                      if (disabled) {
                        setBanner({ type: "error", title: "📁 Missing file", sub: `${d.label} not found or unreachable.` });
                        return;
                      }
                      toggleDoc(d.key);
                    }}
                    style={{ opacity: disabled ? 0.45 : 1 }}
                    type="button"
                    aria-pressed={active}
                  >
                    {locked ? `🔒 ${d.label}` : d.label}
                  </button>
                );
              })}
            </div>

            <div className="cc-inputShell">
              <button className="cc-iconBtn" type="button" disabled title="Attachments disabled">
                <span className="cc-plus">+</span>
              </button>

              <textarea
                ref={textareaRef}
                className="cc-textarea"
                value={input}
                placeholder={`Type your question here… (max ${MAX_USER_INPUT_CHARS} chars)`}
                onChange={(e) => {
                  const next = e.target.value || "";
                  if (next.length <= MAX_USER_INPUT_CHARS) {
                    setInput(next);
                    if (banner?.title === "✂️ Message too long") setBanner(null);
                  } else {
                    setInput(next.slice(0, MAX_USER_INPUT_CHARS));
                    setBanner({
                      type: "error",
                      title: "✂️ Message too long",
                      sub: `Max ${MAX_USER_INPUT_CHARS} characters. Your text was trimmed.`,
                    });
                  }
                }}
                onKeyDown={onKeyDown}
                disabled={isSending}
                spellCheck
              />

              <button className="cc-sendBtn" type="button" onClick={clearInput} disabled={isSending || !input.trim()} title="Clear">
                ✕
              </button>
              <button className="cc-sendBtn" type="button" onClick={send} disabled={isSending || !input.trim()} title="Send">
                ➤
              </button>
            </div>

            <div className="cc-footer-note">
              Powered by {CLOUD_PROVIDER_LABEL} • Matrix always included •{" "}
              <span style={{ fontWeight: 700 }}>{remainingChars}</span> chars left
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
