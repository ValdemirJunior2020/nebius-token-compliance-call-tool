import React, { useEffect, useMemo, useRef, useState } from "react";
import StarRating from "./StarRating.jsx";

const CALL_CENTERS = ["Buwelo", "Concentrix", "WNS", "Ideal", "TEP"];

function norm(s) {
  return String(s ?? "").trim();
}
function normKey(s) {
  return norm(s).toLowerCase();
}
function isEmail(s) {
  const e = norm(s);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function averageStars(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 0;
  const sum = list.reduce((a, r) => a + (Number(r?.stars) || 0), 0);
  return Math.round((sum / list.length) * 10) / 10;
}

// ✅ safe base even if prop missing
function cleanBase(apiBase) {
  const base = norm(apiBase);
  return (base || window.location.origin).replace(/\/+$/, "");
}

// ✅ safe string formatting to avoid ".replace of undefined" anywhere
function safeStr(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return String(v);
  } catch {
    return "";
  }
}

export default function ReviewsPage({ apiBase }) {
  const base = useMemo(() => cleanBase(apiBase), [apiBase]);

  const [tab, setTab] = useState("write"); // write | view
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [reviews, setReviews] = useState([]);

  const [callCenter, setCallCenter] = useState(CALL_CENTERS[0]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");

  const abortRef = useRef(null);

  async function fetchJson(url, options = {}) {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const res = await fetch(url, {
      ...options,
      signal: ctrl.signal,
      headers: {
        ...(options.headers || {}),
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const ct = res.headers.get("content-type") || "";
    const isJsonRes = ct.includes("application/json");
    const body = isJsonRes ? await res.json().catch(() => null) : await res.text().catch(() => "");

    if (!res.ok) {
      const msg =
        (body && typeof body === "object" && body.error) ||
        (typeof body === "string" && body) ||
        res.statusText ||
        "Request failed";
      const e = new Error(String(msg));
      e.status = res.status;
      e.body = body;
      throw e;
    }
    return body;
  }

  async function ping() {
    setError("");
    setOkMsg("");
    setLoading(true);
    try {
      const data = await fetchJson(`${base}/api/reviews/ping`);
      setOkMsg(data?.ok ? "Reviews API online ✅" : "Ping OK ✅");
    } catch (e) {
      setError(e?.message || "Ping failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadAll() {
    setError("");
    setOkMsg("");
    setLoading(true);
    try {
      const data = await fetchJson(`${base}/api/reviews`);
      setReviews(Array.isArray(data?.reviews) ? data.reviews : []);
    } catch (e) {
      setError(e?.message || "Failed to load reviews");
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }

  async function findMine() {
    setError("");
    setOkMsg("");
    const em = norm(email);
    if (!isEmail(em)) {
      setError("Please enter a valid email first.");
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams({ email: em, callCenter: norm(callCenter) });
      const data = await fetchJson(`${base}/api/reviews?${qs.toString()}`);
      const mine = Array.isArray(data?.reviews) ? data.reviews[0] : null;

      if (!mine) {
        setOkMsg("No existing review found. You can submit a new one.");
        return;
      }

      setName(safeStr(mine?.name));
      setStars(Number(mine?.stars) || 5);
      setComment(safeStr(mine?.comment));
      setOkMsg("Loaded your existing review. Edit and click Save.");
    } catch (e) {
      setError(e?.message || "Failed to find your review");
    } finally {
      setLoading(false);
    }
  }

  async function saveReview() {
    setError("");
    setOkMsg("");

    const cc = norm(callCenter);
    const nm = norm(name);
    const em = norm(email);
    const cm = norm(comment);
    const st = Number(stars);

    if (!cc) return setError("Please select a call center.");
    if (!nm) return setError("Please enter your name.");
    if (!isEmail(em)) return setError("Please enter a valid email.");
    if (!Number.isFinite(st) || st < 1 || st > 5) return setError("Rating must be 1 to 5.");

    setLoading(true);
    try {
      const data = await fetchJson(`${base}/api/reviews/upsert`, {
        method: "POST",
        body: JSON.stringify({ callCenter: cc, name: nm, email: em, stars: st, comment: cm }),
      });

      setOkMsg(data?.action === "updated" ? "Review updated ✅" : "Review saved ✅");
      await loadAll();
    } catch (e) {
      setError(e?.message || "Failed to save review");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    return () => abortRef.current?.abort?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const rows = Array.isArray(reviews) ? reviews : [];
    const avg = averageStars(rows);
    const counts = CALL_CENTERS.map((cc) => {
      const list = rows.filter((r) => normKey(r?.callCenter) === normKey(cc));
      return { callCenter: cc, count: list.length, avg: averageStars(list) };
    });
    return { total: rows.length, avg, counts };
  }, [reviews]);

  return (
    <div className="rv-wrap">
      <div className="rv-card">
        <div className="rv-head">
          <div>
            <div className="rv-title">Reviews</div>
            <div className="rv-sub">
              Rate the tool and your experience (1–5 stars). You can edit anytime using the same Call Center + Email.
            </div>
            <div className="rv-sub" style={{ opacity: 0.75, marginTop: 6 }}>
              API Base: <span style={{ fontWeight: 700 }}>{base}</span>
            </div>
          </div>

          <div className="rv-tabs">
            <button className={`rv-tab ${tab === "write" ? "is-active" : ""}`} type="button" onClick={() => setTab("write")}>
              Write / Edit
            </button>
            <button className={`rv-tab ${tab === "view" ? "is-active" : ""}`} type="button" onClick={() => setTab("view")}>
              View Reviews
            </button>
          </div>
        </div>

        {error ? <div className="rv-alert is-err">{error}</div> : null}
        {okMsg ? <div className="rv-alert is-ok">{okMsg}</div> : null}

        <div className="rv-row" style={{ gap: 10, marginBottom: 14 }}>
          <button className="rv-btn rv-btnGhost" type="button" onClick={ping} disabled={loading}>
            {loading ? "Pinging…" : "Ping"}
          </button>
          <button className="rv-btn rv-btnGhost" type="button" onClick={loadAll} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {tab === "write" ? (
          <div className="rv-grid">
            <div className="rv-field">
              <label className="rv-label">Call Center</label>
              <select className="rv-input" value={callCenter} onChange={(e) => setCallCenter(e.target.value)} disabled={loading}>
                {CALL_CENTERS.map((cc) => (
                  <option key={cc} value={cc}>
                    {cc}
                  </option>
                ))}
              </select>
            </div>

            <div className="rv-field">
              <label className="rv-label">Name</label>
              <input className="rv-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" disabled={loading} />
            </div>

            <div className="rv-field">
              <label className="rv-label">Email</label>
              <input
                className="rv-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                disabled={loading}
              />
              <div className="rv-row">
                <button className="rv-btn rv-btnGhost" type="button" onClick={findMine} disabled={loading || !email.trim()}>
                  Find My Review
                </button>
                <div className="rv-hint">(Loads your existing review if it exists.)</div>
              </div>
            </div>

            <div className="rv-field">
              <label className="rv-label">Rating</label>
              <StarRating value={stars} onChange={setStars} size="lg" />
              <div className="rv-hint">{stars} / 5</div>
            </div>

            <div className="rv-field rv-span2">
              <label className="rv-label">Comment (optional)</label>
              <textarea
                className="rv-input rv-textarea"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What should we improve? What do you like?"
                rows={4}
                disabled={loading}
              />
            </div>

            <div className="rv-actions">
              <button className="rv-btn" type="button" onClick={saveReview} disabled={loading}>
                {loading ? "Saving…" : "Save Review"}
              </button>
              <button
                className="rv-btn rv-btnGhost"
                type="button"
                onClick={() => {
                  setName("");
                  setEmail("");
                  setStars(5);
                  setComment("");
                  setOkMsg("");
                  setError("");
                }}
                disabled={loading}
              >
                Clear
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="rv-stats">
              <div className="rv-stat">
                <div className="rv-statLabel">Total Reviews</div>
                <div className="rv-statVal">{stats.total}</div>
              </div>
              <div className="rv-stat">
                <div className="rv-statLabel">Average Rating</div>
                <div className="rv-statVal">
                  {stats.avg}
                  <span className="rv-statSmall"> / 5</span>
                </div>
              </div>
              <div className="rv-stat rv-statWide">
                <div className="rv-statLabel">By Call Center</div>
                <div className="rv-miniGrid">
                  {stats.counts.map((x) => (
                    <div key={x.callCenter} className="rv-mini">
                      <div className="rv-miniTop">{x.callCenter}</div>
                      <div className="rv-miniRow">
                        <span>{x.count}</span>
                        <span>{x.avg}★</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rv-listHead">
              <div className="rv-listTitle">Latest</div>
              <button className="rv-btn rv-btnGhost" type="button" onClick={loadAll} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            <div className="rv-list">
              {Array.isArray(reviews) && reviews.length ? (
                reviews.map((r) => {
                  const key = r?.reviewId || `${safeStr(r?.email)}-${safeStr(r?.callCenter)}-${safeStr(r?.updatedAt)}`;
                  const updatedAt = r?.updatedAt ? new Date(r.updatedAt).toLocaleString() : "";
                  return (
                    <div key={key} className="rv-item">
                      <div className="rv-itemTop">
                        <div className="rv-itemLeft">
                          <div className="rv-itemName">{safeStr(r?.name) || "(no name)"}</div>
                          <div className="rv-itemMeta">
                            <span className="rv-pill">{safeStr(r?.callCenter) || "Unknown"}</span>
                            <span className="rv-dot">•</span>
                            <span className="rv-date">{updatedAt}</span>
                          </div>
                        </div>
                        <StarRating value={Number(r?.stars) || 0} readOnly />
                      </div>
                      {r?.comment ? <div className="rv-itemComment">{safeStr(r.comment)}</div> : null}
                    </div>
                  );
                })
              ) : (
                <div className="rv-empty">No reviews yet.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
