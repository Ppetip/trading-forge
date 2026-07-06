import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, Beaker, Check, FileText, Sparkles } from "lucide-react";
import { saasApi, type ApiAccount } from "./saas-api";
import { opsApi, type TranscriptSource } from "./saas-ops-api";
import { PaywallModal, type PaywallInfo } from "./PaywallModal";

export default function TranscriptBuilder() {
  const [account, setAccount] = useState<ApiAccount | null>(null);
  const [sources, setSources] = useState<TranscriptSource[]>([]);
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("video_transcript");
  const [sourceUrl, setSourceUrl] = useState("");
  const [content, setContent] = useState("");
  const [selected, setSelected] = useState<TranscriptSource | null>(null);
  const [paywall, setPaywall] = useState<PaywallInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    Promise.all([saasApi.account(), opsApi.transcripts()])
      .then(([accountResult, sourceResult]) => {
        setAccount(accountResult.account);
        setSources(sourceResult.sources);
      })
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setBusy(false));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if ((account?.usage.limits.transcriptExtractions ?? 0) === 0) {
      setPaywall({ title: "Transcript extraction is a paid research tool", message: "Video and notes extraction uses AI processing. Free users can still paste a strategy directly into the workspace, while paid plans unlock transcript-to-rules workflows.", options: ["Upgrade for transcript extraction", "Paste the strategy idea directly into Test a Strategy", "Manually summarize the rules and run one free backtest"], primaryHref: "#/account", primaryLabel: "View plans" });
      return;
    }
    setBusy(true);
    try {
      const { source } = await opsApi.extractTranscript({ title, sourceType, sourceUrl: sourceUrl || undefined, content });
      setSources((current) => [source, ...current]);
      setSelected(source);
      setTitle("");
      setSourceUrl("");
      setContent("");
      setAccount((await saasApi.account()).account);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (busy && !account) return <div className="plans-loading"><Sparkles />Loading transcript workspaceâ€¦</div>;
  const limit = account?.usage.limits.transcriptExtractions ?? 0;
  const used = account?.usage.used.transcriptExtractions ?? 0;

  return <div className="transcript-page">
    <header><a className="saas-brand" href="#/"><span><Beaker size={17} /></span>Edge<i>Lab</i></a><nav><a href="#/saas">Workspace</a><a href="#/samples">Strategy packs</a><a href="#/plans">Plans</a></nav></header>
    <main>
      <div className="transcript-title"><p>PAID RESEARCH TOOL</p><h1>Transcript-to-strategy</h1><span>Extract candidate rules from user-provided transcripts and notes. Review all output before testing.</span><b>{used}/{limit} extractions this month</b></div>
      {limit === 0 && <div className="transcript-paywall"><Sparkles /><div><strong>Trial or Pro required</strong><span>Transcript extraction has API and processing cost, so the free plan does not include it.</span></div><a href="#/plans">View plans <ArrowRight size={12} /></a></div>}
      <div className="transcript-layout">
        <form onSubmit={submit}>
          <label>Source type<select value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="video_transcript">Video transcript</option><option value="youtube_transcript">YouTube transcript</option><option value="trading_notes">Trading notes</option><option value="course_notes">Course notes</option><option value="discord">Discord explanation</option><option value="x_thread">X/Twitter thread</option></select></label>
          <label>Title<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="8 AM ORB video notes" /></label>
          <label>Source URL <small>optional</small><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://â€¦" /></label>
          <label>Transcript or notes<textarea required minLength={40} maxLength={100000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Paste the transcript or strategy explanationâ€¦" /></label>
          <small>{content.length.toLocaleString()} / 100,000 characters</small>
          {error && <div className="transcript-error"><AlertTriangle size={12} />{error}</div>}
          <button disabled={busy} onClick={(event) => { if (limit === 0) { event.preventDefault(); setPaywall({ title: "Transcript extraction is a paid research tool", message: "Video and notes extraction uses AI processing. Free users can still paste a strategy directly into the workspace, while paid plans unlock transcript-to-rules workflows.", options: ["Upgrade for transcript extraction", "Paste the strategy idea directly into Test a Strategy", "Manually summarize the rules and run one free backtest"], primaryHref: "#/account", primaryLabel: "View plans" }); } }}>{busy ? "Extractingâ€¦" : "Extract candidate rules"} <ArrowRight size={12} /></button>
        </form>
        <section>
          {selected ? <Extraction source={selected} /> : <div className="transcript-empty"><FileText /><h2>No extraction selected</h2><p>Choose a saved source or submit new material.</p></div>}
          <div className="source-list"><h2>Uploaded sources</h2>{sources.map((source) => <button key={source.id} onClick={() => setSelected(source)}><div><strong>{source.title}</strong><span>{source.sourceType.replaceAll("_", " ")} Â· {new Date(source.createdAt).toLocaleDateString()}</span></div><em>{source.status}</em></button>)}</div>
        </section>
      </div>
    </main>
    {paywall && <PaywallModal info={paywall} onClose={() => setPaywall(null)} />}
  </div>;
}

function Extraction({ source }: { source: TranscriptSource }) {
  const detected = source.extraction.detected;
  function testStrategy() {
    window.localStorage.setItem("edgelab.iterateRules", JSON.stringify(source.extraction.rules));
    window.localStorage.setItem("edgelab.iteratePrompt", `Test the strategy extracted from "${source.title}". Preserve detected rules and clarify every missing or unsupported detail.`);
    window.location.hash = "#/app";
  }
  return <div className="extraction">
    <div><p>EXTRACTED CANDIDATE</p><h2>{source.title}</h2><span>{source.extraction.warning}</span></div>
    {detected && <div className="detected-strategy"><h3>Detected strategy</h3><dl><div><dt>Market</dt><dd>{String(detected.market ?? "Missing")}</dd></div><div><dt>Symbol</dt><dd>{String(detected.symbol ?? "Missing")}</dd></div><div><dt>Timeframe</dt><dd>{String(detected.timeframe ?? "Missing")}</dd></div><div><dt>Entry</dt><dd>{String(detected.entry ?? "Missing")}</dd></div><div><dt>Stop</dt><dd>{String(detected.stop ?? "Missing")}</dd></div><div><dt>Target</dt><dd>{String(detected.target ?? "Missing")}</dd></div></dl></div>}
    <h3>Candidate rules</h3><pre>{JSON.stringify(source.extraction.rules, null, 2)}</pre>
    <div className="extraction-columns">
      <section><h3>Assumptions</h3>{source.extraction.assumptions.length ? source.extraction.assumptions.map((item) => <p key={item}><AlertTriangle size={11} />{item}</p>) : <p><Check size={11} />No parser defaults applied.</p>}</section>
      <section><h3>Cannot test yet</h3>{source.extraction.untestable.length ? source.extraction.untestable.map((item) => <p key={item}><AlertTriangle size={11} />{item}</p>) : <p><Check size={11} />No discretionary language detected.</p>}</section>
    </div>
    <button className="test-extraction" onClick={testStrategy}>{detected?.backtestReady ? "Test this strategy" : "Clarify before testing"} <ArrowRight size={12} /></button>
    <div className="extraction-boundary">This extraction contains no performance results. Only the backtest engine calculates results.</div>
  </div>;
}



