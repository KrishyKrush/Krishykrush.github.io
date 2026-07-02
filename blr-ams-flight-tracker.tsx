import React, { useState, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

// ------------------------------------------------------------------
// BLR → AMS Fare & Baggage Tracker
// Traveler 1: Student, one-way, must land AMS morning of 15 Aug 2026
// Traveler 2: Adult, return, AMS → BLR on 5 Sep 2026
// Airlines: Etihad · Air France · Lufthansa
// ------------------------------------------------------------------

const INK = "#1B1F3B";
const YELLOW = "#F9D616";
const PAPER = "#FAFAF7";
const SLATE = "#6B7085";
const GREEN = "#1E7A46";

// Baseline estimates gathered late June 2026 (peak-season August fares).
// The Refresh button asks Claude to re-search the web and overwrite these.
const BASELINE = {
  fetchedAt: "2026-07-02 (baseline estimate)",
  fares: {
    etihad: { oneWay: 32000, ret: 58000 },
    airfrance: { oneWay: 48000, ret: 80000 },
    lufthansa: { oneWay: 59000, ret: 85000 },
  },
};

const AIRLINES = [
  {
    id: "etihad",
    name: "Etihad Airways",
    code: "EY",
    route: "BLR → AUH → AMS · 1 stop (Abu Dhabi)",
    morningFit:
      "Late-night 14 Aug departure from BLR connects via AUH; typically lands AMS late morning–midday 15 Aug. Verify exact arrival before booking.",
    checkedKg: 46,
    baggageNote:
      "Standard economy from India: usually 2 × 23 kg checked + 7 kg cabin. Student offer gives ~10% off Economy but no extra baggage on this route.",
    studentNote:
      "10% off Economy for verified students aged 18–32 (Etihad Guest sign-up + student ID). India ⇄ Netherlands is an eligible route.",
    studentDiscount: 0.10,
  },
  {
    id: "airfrance",
    name: "Air France",
    code: "AF",
    route: "BLR → CDG → AMS · 1 stop (Paris)",
    morningFit:
      "~2 AM departure from BLR on 15 Aug reaches CDG early morning; short hop lands AMS by late morning. Good fit for a morning arrival.",
    checkedKg: 46,
    baggageNote:
      "Standard economy: 1 × 23 kg checked + 12 kg cabin. Student fares typically add a second 23 kg bag (2 × 23 kg total) — confirm at booking.",
    studentNote:
      "Student discount via Air France's student programme; usually includes extra checked baggage at no cost on India–Europe routes.",
    studentDiscount: 0.08,
  },
  {
    id: "lufthansa",
    name: "Lufthansa",
    code: "LH",
    route: "BLR → FRA/MUC → AMS · 1 stop (Germany)",
    morningFit:
      "~1 AM departure from BLR lands Frankfurt ~7:45 AM; connection puts you in AMS mid-morning 15 Aug. Strongest morning-arrival fit.",
    checkedKg: 46,
    baggageNote:
      "Student fare: 2 × 23 kg checked + 8 kg cabin + flexible rebooking. Standard light fares carry much less — book the Student fare specifically.",
    studentNote:
      "Lufthansa Student Fares (via Travel ID verification) apply from Bengaluru to Europe: discounted fare, 2 × 23 kg bags, flexible changes.",
    studentDiscount: 0.10,
  },
];

const inr = (n) =>
  n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");

export default function FareTracker() {
  const [traveler, setTraveler] = useState("student"); // student | adult
  const [sortBy, setSortBy] = useState("price"); // price | baggage
  const [data, setData] = useState(BASELINE);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  // Load saved fares + history on mount
  useEffect(() => {
    (async () => {
      try {
        const saved = await window.storage.get("blr-ams-tracker");
        if (saved?.value) {
          const parsed = JSON.parse(saved.value);
          if (parsed.latest) setData(parsed.latest);
          if (parsed.history) setHistory(parsed.history);
        }
      } catch {
        /* first run — nothing saved yet */
      }
    })();
  }, []);

  const persist = async (latest, hist) => {
    try {
      await window.storage.set(
        "blr-ams-tracker",
        JSON.stringify({ latest, history: hist })
      );
    } catch (e) {
      console.error("Could not save fare history", e);
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [
            {
              role: "user",
              content:
                "Search the web for the current cheapest economy fares in INR from Bengaluru (BLR) to Amsterdam (AMS) for: (a) a ONE-WAY ticket arriving the morning of 15 August 2026, and (b) a RETURN ticket departing 14/15 August 2026 and returning AMS to BLR on 5 September 2026. I only care about Etihad Airways, Air France, and Lufthansa. Respond with ONLY a JSON object, no markdown fences, no prose, in exactly this shape: {\"fares\":{\"etihad\":{\"oneWay\":number,\"ret\":number},\"airfrance\":{\"oneWay\":number,\"ret\":number},\"lufthansa\":{\"oneWay\":number,\"ret\":number}},\"notes\":\"one short sentence on anything notable\"}. Use your best estimate in INR if an exact fare isn't published.",
            },
          ],
        }),
      });
      const json = await res.json();
      const text = (json.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const clean = text.replace(/```json|```/g, "").trim();
      const start = clean.indexOf("{");
      const end = clean.lastIndexOf("}");
      const parsed = JSON.parse(clean.slice(start, end + 1));
      const stamp = new Date().toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      const latest = { fetchedAt: stamp, fares: parsed.fares, notes: parsed.notes };
      setData(latest);
      const day = new Date().toISOString().slice(0, 10);
      const newHist = [
        ...history.filter((h) => h.date !== day),
        {
          date: day,
          etihad: parsed.fares.etihad?.oneWay,
          airfrance: parsed.fares.airfrance?.oneWay,
          lufthansa: parsed.fares.lufthansa?.oneWay,
        },
      ].slice(-30);
      setHistory(newHist);
      persist(latest, newHist);
    } catch (e) {
      setErr(
        "Couldn't fetch updated fares just now — showing the last saved prices. Try again in a moment."
      );
    } finally {
      setLoading(false);
    }
  }, [history]);

  const isStudent = traveler === "student";

  const rows = AIRLINES.map((a) => {
    const f = data.fares[a.id] || {};
    const base = isStudent ? f.oneWay : f.ret ?? f.return;
    const price = isStudent && base ? base * (1 - a.studentDiscount) : base;
    return { ...a, listed: base, price };
  }).sort((x, y) =>
    sortBy === "price"
      ? (x.price ?? 1e12) - (y.price ?? 1e12)
      : y.checkedKg - x.checkedKg
  );

  const cheapest = rows.reduce(
    (m, r) => (r.price != null && r.price < (m?.price ?? 1e12) ? r : m),
    null
  );
  const maxBag = rows.reduce((m, r) => (r.checkedKg > (m?.checkedKg ?? 0) ? r : m), null);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: PAPER,
        color: INK,
        fontFamily:
          "'Archivo', 'Helvetica Neue', Arial, sans-serif",
        paddingBottom: 48,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800&display=swap');
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
        button:focus-visible { outline: 3px solid ${INK}; outline-offset: 2px; }
      `}</style>

      {/* Schiphol-signage header */}
      <header
        style={{
          background: YELLOW,
          padding: "22px 20px 18px",
          borderBottom: `4px solid ${INK}`,
        }}
      >
        <div style={{ maxWidth: 880, margin: "0 auto" }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: 3,
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            Fare & baggage tracker
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              flexWrap: "wrap",
              marginTop: 4,
            }}
          >
            <span style={{ fontSize: 42, fontWeight: 800, letterSpacing: 1 }}>
              BLR
            </span>
            <span style={{ fontSize: 30, fontWeight: 800 }}>→</span>
            <span style={{ fontSize: 42, fontWeight: 800, letterSpacing: 1 }}>
              AMS
            </span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              land by morning · Sat 15 Aug 2026
            </span>
          </div>
          <div style={{ fontSize: 13, marginTop: 2 }}>
            Adult returns AMS → BLR on Sat 5 Sep 2026 · Etihad / Air France /
            Lufthansa only
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 880, margin: "0 auto", padding: "20px 16px" }}>
        {/* Controls */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { id: "student", label: "Student · one-way" },
              { id: "adult", label: "Adult · return" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTraveler(t.id)}
                style={{
                  padding: "10px 16px",
                  borderRadius: 6,
                  border: `2px solid ${INK}`,
                  background: traveler === t.id ? INK : "transparent",
                  color: traveler === t.id ? YELLOW : INK,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: SLATE, fontWeight: 600 }}>
              Sort by
            </span>
            {[
              { id: "price", label: "Cheapest" },
              { id: "baggage", label: "Max baggage" },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => setSortBy(s.id)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: `1.5px solid ${sortBy === s.id ? INK : "#C9CBD6"}`,
                  background: sortBy === s.id ? "#EDEEF4" : "transparent",
                  color: INK,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Refresh bar */}
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            border: `1.5px dashed ${SLATE}`,
            borderRadius: 8,
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 13,
          }}
        >
          <div>
            <strong>Prices last checked:</strong> {data.fetchedAt}
            {data.notes ? (
              <div style={{ color: SLATE, marginTop: 2 }}>{data.notes}</div>
            ) : null}
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              padding: "10px 18px",
              borderRadius: 6,
              border: "none",
              background: loading ? SLATE : GREEN,
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "Searching live fares…" : "Refresh today's prices"}
          </button>
        </div>
        {err && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#A03030" }}>
            {err}
          </div>
        )}

        {/* Airline cards */}
        <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
          {rows.map((a) => {
            const isCheapest = cheapest?.id === a.id;
            const isMaxBag = maxBag?.id === a.id;
            return (
              <div
                key={a.id}
                style={{
                  border: `2px solid ${isCheapest ? GREEN : "#D8DAE3"}`,
                  borderRadius: 10,
                  background: "#fff",
                  padding: "16px 18px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    alignItems: "baseline",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 800 }}>
                    {a.name}{" "}
                    <span style={{ color: SLATE, fontWeight: 600, fontSize: 13 }}>
                      {a.code}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {isCheapest && (
                      <span style={badge(GREEN)}>Cheapest</span>
                    )}
                    {isMaxBag && <span style={badge(INK)}>Max baggage</span>}
                  </div>
                </div>

                <div style={{ marginTop: 6, fontSize: 13, color: SLATE }}>
                  {a.route}
                </div>

                <div
                  style={{
                    marginTop: 12,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: 12,
                  }}
                >
                  <Stat
                    label={isStudent ? "Student fare (est.)" : "Adult return (est.)"}
                    value={inr(a.price)}
                    sub={
                      isStudent
                        ? `listed ${inr(a.listed)} − ${Math.round(
                            a.studentDiscount * 100
                          )}% student`
                        : "out 14/15 Aug · back 5 Sep"
                    }
                  />
                  <Stat
                    label="Checked baggage"
                    value={`${a.checkedKg} kg`}
                    sub={isStudent ? "on student fare" : "standard economy"}
                  />
                </div>

                <Detail title="Morning arrival, 15 Aug" text={a.morningFit} />
                <Detail title="Baggage" text={a.baggageNote} />
                {isStudent && <Detail title="Student offer" text={a.studentNote} />}
              </div>
            );
          })}
        </div>

        {/* Price history */}
        {history.length > 1 && (
          <div style={{ marginTop: 28 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>
              One-way fare history (your daily refreshes)
            </div>
            <div style={{ height: 220, background: "#fff", border: "1.5px solid #D8DAE3", borderRadius: 10, padding: 8 }}>
              <ResponsiveContainer>
                <LineChart data={history}>
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v) => "₹" + v / 1000 + "k"} />
                  <Tooltip formatter={(v) => inr(v)} />
                  <Legend />
                  <Line dataKey="etihad" stroke={GREEN} strokeWidth={2} dot />
                  <Line dataKey="airfrance" stroke="#B0413E" strokeWidth={2} dot />
                  <Line dataKey="lufthansa" stroke={INK} strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <p style={{ marginTop: 24, fontSize: 12, color: SLATE, lineHeight: 1.6 }}>
          Fares are estimates from web searches, not live booking-system quotes —
          final prices appear only at airline checkout. Student discounts require
          verification before booking (Etihad Guest, Lufthansa Travel ID, or Air
          France's student programme). Baggage figures reflect typical
          India–Europe economy and student-fare rules; always confirm on the fare
          conditions page. Hit "Refresh today's prices" once a day to build your
          own price trend above.
        </p>
      </main>
    </div>
  );
}

const badge = (bg) => ({
  background: bg,
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  padding: "4px 10px",
  borderRadius: 999,
  letterSpacing: 0.5,
  textTransform: "uppercase",
});

function Stat({ label, value, sub }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: SLATE, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: SLATE }}>{sub}</div>}
    </div>
  );
}

function Detail({ title, text }) {
  return (
    <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5 }}>
      <strong>{title}: </strong>
      <span style={{ color: "#3A3F5C" }}>{text}</span>
    </div>
  );
}
