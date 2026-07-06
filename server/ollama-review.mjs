const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "gemma3:12b";

function parseJson(content) {
  const text = String(content ?? "").trim();
  try { return JSON.parse(text); } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    throw new Error("Ollama returned an invalid report review.");
  }
}

export async function reviewReportWithOllama(report, { mode = "review", question = "", fetchImpl = fetch, baseUrl = process.env.OLLAMA_URL ?? DEFAULT_URL, model = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL } = {}) {
  const result = report.result;
  const evidence = {
    reportId: report.id, engineVersion: report.engineVersion, createdAt: report.createdAt,
    rules: report.rules,
    metrics: {
      totalR: result.totalR, averageR: result.averageR, winRate: result.winRate,
      wins: result.wins, losses: result.losses, trades: result.trades.length,
      profitFactor: result.profitFactor, maxDrawdownR: result.maxDrawdown,
      longestLosingStreak: result.longestLosingStreak,
      bestMonth: result.bestMonth, worstMonth: result.worstMonth
    },
    monthly: result.monthly,
    firstTrade: result.trades[0] ?? null,
    lastTrade: result.trades.at(-1) ?? null
  };
  const instruction = mode === "plan"
    ? "Create a disciplined next-test game plan. Each experiment must change exactly one rule, state the hypothesis, and name the metric to compare. Include an untouched holdout or walk-forward validation step."
    : "Review the report. Separate direct observations from hypotheses. Diagnose weaknesses conservatively and suggest only controlled follow-up experiments.";
  const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, "")}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: false, format: "json", options: { temperature: 0.15 }, messages: [
      { role: "system", content: `You are EdgeLab's grounded strategy research analyst. ${instruction} Use only the supplied frozen report evidence. Never invent trades, market regimes, causes, profitability, or metrics. Never promise improvement. Return JSON only with keys headline, summary, findings, experiments, risks, answer. findings, experiments, and risks must be arrays of concise strings. If evidence cannot answer the question, say so in answer and propose a measurable test.` },
      { role: "user", content: JSON.stringify({ mode, question: String(question).slice(0, 2000), evidence }) }
    ] })
  });
  if (!response.ok) { const error = new Error(`Ollama report review failed (${response.status}).`); error.status = 502; error.code = "AI_REVIEW_FAILED"; throw error; }
  const generated = parseJson((await response.json()).message?.content);
  return {
    model, mode,
    headline: String(generated.headline ?? "Report review"),
    summary: String(generated.summary ?? ""),
    findings: Array.isArray(generated.findings) ? generated.findings.map(String).slice(0, 8) : [],
    experiments: Array.isArray(generated.experiments) ? generated.experiments.map(String).slice(0, 8) : [],
    risks: Array.isArray(generated.risks) ? generated.risks.map(String).slice(0, 8) : [],
    answer: String(generated.answer ?? "")
  };
}
