// client/src/components/Reviews/StarRating.jsx
import React from "react";

export default function StarRating({ value = 0, onChange, readOnly = false, size = "md" }) {
  const v = Number(value) || 0;
  const fontSize = size === "lg" ? 22 : size === "sm" ? 16 : 18;
  return (
    <div className="rv-stars" role={readOnly ? undefined : "radiogroup"} aria-label="Rating">
      {Array.from({ length: 5 }).map((_, i) => {
        const n = i + 1;
        const active = n <= v;
        return (
          <button
            key={n}
            type="button"
            className={`rv-star ${active ? "is-on" : ""} ${readOnly ? "is-ro" : ""}`}
            style={{ fontSize }}
            onClick={() => {
              if (readOnly) return;
              onChange?.(n);
            }}
            disabled={readOnly}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            aria-checked={active}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}
