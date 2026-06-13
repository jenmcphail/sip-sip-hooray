import { useState } from "react";

const ALC_OPTIONS = [
  { value: "both", label: "🍹 Everything" },
  { value: "alc", label: "🍷 Alc Only" },
  { value: "nonalc", label: "🧃 Non-Alc Only" },
];

const LEVELS = [
  {
    key: "casual",
    label: "🥤 Casual",
    marker: "🥤 CASUAL",
    bg: "bg-mint",
    border: "border-mint-dark",
    empty: "Your everyday sip will appear here",
  },
  {
    key: "mid",
    label: "🍶 Mid",
    marker: "🍶 MID",
    bg: "bg-lavender",
    border: "border-lavender-dark",
    empty: "Your mid-tier pairing will appear here",
  },
  {
    key: "elevated",
    label: "✨ Elevated",
    marker: "✨ ELEVATED",
    bg: "bg-peach",
    border: "border-peach-dark",
    empty: "Your fancy sip will appear here",
  },
];

function parseResponse(response) {
  const sections = { casual: "", mid: "", elevated: "" };
  if (!response) return sections;

  const casualMatch = response.match(/🥤 CASUAL:([\s\S]*?)(?=🍶 MID:|$)/);
  const midMatch = response.match(/🍶 MID:([\s\S]*?)(?=✨ ELEVATED:|$)/);
  const elevatedMatch = response.match(/✨ ELEVATED:([\s\S]*?)$/);

  if (casualMatch) sections.casual = casualMatch[1].trim();
  if (midMatch) sections.mid = midMatch[1].trim();
  if (elevatedMatch) sections.elevated = elevatedMatch[1].trim();

  return sections;
}

function PairingCard({ level, content, loading }) {
  const isEmpty = !content && !loading;

  return (
    <div
      className={`
        flex-1 rounded-2xl border-2 p-5 flex flex-col gap-3 min-h-48
        ${level.bg} ${level.border}
        shadow-sm transition-all duration-300
      `}
    >
      <span className="text-sm font-bold tracking-widest uppercase text-neutral-500">
        {level.label}
      </span>

      {isEmpty && (
        <p className="text-neutral-400 text-sm italic mt-2">{level.empty}</p>
      )}

      {loading && !content && (
        <div className="flex flex-col gap-2 mt-2">
          <div className="h-3 bg-white/60 rounded-full animate-pulse w-3/4" />
          <div className="h-3 bg-white/60 rounded-full animate-pulse w-full" />
          <div className="h-3 bg-white/60 rounded-full animate-pulse w-2/3" />
        </div>
      )}

      {content && (
        <p className="text-neutral-700 text-sm leading-relaxed whitespace-pre-wrap">
          {content}
        </p>
      )}
    </div>
  );
}

export default function App() {
  const [meal, setMeal] = useState("");
  const [alcFilter, setAlcFilter] = useState("both");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sections = parseResponse(response);

  const handleSubmit = async () => {
    if (!meal.trim()) return;
    setLoading(true);
    setResponse("");
    setError("");

    try {
      const res = await fetch("http://localhost:3001/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meal, alcFilter }),
      });

      if (!res.ok) throw new Error("Something went wrong");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ") && !line.includes("[DONE]")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                setResponse((prev) => prev + data.content);
              }
            } catch { }
          }
        }
      }
    } catch (err) {
      setError("Something went wrong. Try again!");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fdf6ff] flex flex-col items-center px-4 py-14">
      <div className="w-full max-w-2xl flex flex-col gap-8">

        {/* Header */}
        <div className="text-center flex flex-col gap-2">
          <h1
            className="text-6xl text-[#b388e8]"
            style={{ fontFamily: "'Fredoka One', cursive" }}
          >
            Sip Sip Hooray
          </h1>
          <p className="text-neutral-500 text-base">
            Tell us what you're eating. We'll find your perfect sip.
          </p>
        </div>

        {/* Input area */}
        <div className="flex flex-col gap-3">
          <textarea
            rows={3}
            placeholder="e.g. spicy Thai chicken curry, mushroom risotto, Korean BBQ short ribs..."
            value={meal}
            onChange={(e) => setMeal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            className="w-full rounded-2xl border-2 border-[#e8d5f5] bg-white px-4 py-3 text-neutral-700 placeholder-neutral-400 resize-none focus:outline-none focus:border-[#b388e8] transition-colors text-base shadow-sm"
          />

          {/* Alc toggle */}
          <div className="flex gap-2">
            {ALC_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setAlcFilter(opt.value)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all duration-200 border-2 ${alcFilter === opt.value
                    ? "bg-[#b388e8] border-[#b388e8] text-white shadow-sm"
                    : "bg-white border-[#e8d5f5] text-neutral-500 hover:border-[#b388e8]"
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading || !meal.trim()}
            className="w-full py-3 rounded-2xl bg-[#f7b8a2] text-white font-bold text-base hover:bg-[#f4a088] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-sm tracking-wide"
          >
            {loading ? "Sipping..." : "Find My Sip →"}
          </button>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
        </div>

        {/* Results cards */}
        <div className="flex flex-col sm:flex-row gap-4">
          {LEVELS.map((level) => (
            <PairingCard
              key={level.key}
              level={level}
              content={sections[level.key]}
              loading={loading}
            />
          ))}
        </div>

      </div>
    </div>
  );
}