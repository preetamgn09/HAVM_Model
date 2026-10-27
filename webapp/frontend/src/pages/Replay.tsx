import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Pause, Play, PlayCircle, SkipForward, XCircle } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "../lib/useApi";
import { get, post } from "../lib/api";
import { CHART, STATE_COLOR, fx, humanize, mname, when } from "../lib/format";
import { ChartTip, Empty, ErrorState, EvidenceChip, HarmBadge, KV, Loading, MonitorStatus, Note, PageHeader, Panel, StateBadge, Tabs } from "../components/ui";

const TERMINAL = ["completed", "failed", "timed_out", "interrupted"];

export default function Replay() {
  const { runId = "EXP003" } = useParams();
  const nav = useNavigate();
  const caps = useApi<any>("/api/replay/capabilities");
  const runs = useApi<any>("/api/replay");

  return (
    <>
      <PageHeader title="Replay Lab"
        lead="Run the project’s own pipeline — splits, monitors, AHS, triage, governance and audit — over windows of the retrospective dataset, then step through what it decided and why. Every window is observed or injected retrospective data; nothing here is a live hospital feed." />
      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <div className="space-y-5">
          <Launcher caps={caps} onStarted={(id) => { runs.reload(); nav(`/replay/${id}`); }} />
          <Panel title="Runs" pad={false}>
            {runs.loading ? <Loading /> : runs.error ? <div className="p-3"><ErrorState error={runs.error} /></div> : (
              <div className="max-h-[420px] divide-y divide-hair overflow-y-auto">
                {runs.data.data.map((r: any) => (
                  <Link key={r.run_id} to={`/replay/${r.run_id}`} className={`block px-4 py-2.5 text-sm hover:bg-raised/50 ${r.run_id === runId ? "bg-raised" : ""}`}>
                    <div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-xs">{r.run_id}</span><RunState s={r.state} /></div>
                    <div className="mt-0.5 text-xs text-muted">{r.kind === "historical" ? "Recorded experiment" : `${humanize(r.params.scenario)}, ${r.params.monitor_set} monitors`}</div>
                  </Link>))}
              </div>)}
          </Panel>
        </div>
        <div className="min-w-0">{caps.data ? <RunView runId={runId} onDone={runs.reload} bands={caps.data.data.bands} /> : caps.error ? <ErrorState error={caps.error} retry={caps.reload} /> : <Loading />}</div>
      </div>
    </>
  );
}

function RunState({ s }: { s: string }) {
  const c = s === "completed" ? "#2FB5A3" : TERMINAL.includes(s) ? "#E2686A" : "#5BC6E4";
  return <span className="text-2xs" style={{ color: c }}>{humanize(s)}</span>;
}

function Launcher({ caps, onStarted }: { caps: any; onStarted: (id: string) => void }) {
  const [scenario, setScenario] = useState("observed_partition");
  const [n, setN] = useState(10);
  const [seed, setSeed] = useState(20260819);
  const [ms, setMs] = useState("four");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (caps.loading) return <Panel title="Start a replay"><Loading /></Panel>;
  if (caps.error) return <ErrorState error={caps.error} retry={caps.reload} />;
  const c = caps.data.data;
  const sc = c.scenarios.find((s: any) => s.id === scenario);
  async function start() {
    setBusy(true); setErr(null);
    try { const r = await post<any>("/api/replay", { scenario, n_windows: n, seed, monitor_set: ms }); onStarted(r.run_id); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); caps.reload(); }
  }
  return (
    <Panel title="Start a replay">
      <div className="space-y-3 text-sm">
        <div><label className="label" htmlFor="sc">Scenario</label>
          <select id="sc" className="field mt-1 w-full" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {c.scenarios.map((s: any) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <p className="mt-1 text-xs leading-5 text-muted">{sc?.description} <EvidenceChip cls={sc?.evidence_class} small /></p></div>
        {scenario === "observed_partition" && (
          <div><label className="label" htmlFor="nw">Windows: {n}{c.deployment_encounters ? ` (≈${Math.round(c.deployment_encounters / n).toLocaleString()} rows each)` : ""}</label>
            <input id="nw" type="range" min={5} max={20} value={n} onChange={(e) => setN(+e.target.value)} className="w-full accent-[#2FB5A3]" /></div>)}
        <div><label className="label" htmlFor="ms">Monitors</label>
          <select id="ms" className="field mt-1 w-full" value={ms} onChange={(e) => setMs(e.target.value)}>
            {c.monitor_sets.map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          {ms === "seven" && <p className="mt-1 text-xs leading-5 text-muted">{c.monitor_sets.find((m: any) => m.id === "seven")?.note}</p>}</div>
        <div><label className="label" htmlFor="seed">Seed</label>
          <input id="seed" className="field mt-1 w-full num" type="number" min={0} value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(+e.target.value || 0)))} />
          <p className="mt-1 text-2xs text-faint">20260819 with the EXP003 monitors reproduces the recorded run.</p></div>
        <button className="btn btn-primary w-full justify-center" onClick={start} disabled={!c.can_start || c.busy || busy}>
          <PlayCircle size={16} />{busy ? "Starting…" : c.busy ? "A replay is running" : "Start replay"}</button>
        {!c.can_start && <Note tone="warn">{c.reason}</Note>}
        {err && <Note tone="warn">{err}</Note>}
        {!c.sklearn.match && <p className="text-2xs text-[#E2A543]">scikit-learn {c.sklearn.runtime} differs from the {c.sklearn.model_recorded} used to freeze the model.</p>}
        <p className="text-2xs leading-4 text-faint">One replay runs at a time (limit {c.timeout_seconds}s). {c.live_integration.reason}</p>
      </div>
    </Panel>);
}

function RunView({ runId, onDone, bands }: { runId: string; onDone: () => void; bands: { review: number; suspension: number } }) {
  const [run, setRun] = useState<any>(null);
  const [error, setError] = useState<Error | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<"all" | "playback">("all");
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1500);

  useEffect(() => {
    let stop = false; let timer: any;
    setRun(null); setError(null); setSel(null); setMode("all"); setPlaying(false);
    const tick = async () => {
      try {
        const r = await get<any>(`/api/replay/${runId}`);
        if (stop) return;
        setRun(r);
        if (!TERMINAL.includes(r.state)) timer = setTimeout(tick, 1000); else onDone();
      } catch (e: any) { if (!stop) setError(e); }
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const windows: any[] = run?.windows ?? [];
  const visible = mode === "playback" ? windows.slice(0, shown) : windows;
  useEffect(() => {
    if (!playing) return;
    if (shown >= windows.length) { setPlaying(false); return; }
    const t = setTimeout(() => { setShown((s) => s + 1); setSel(windows[shown]?.window_id ?? null); }, speed);
    return () => clearTimeout(t);
  }, [playing, shown, windows, speed]);
  useEffect(() => { if (!sel && visible.length) setSel(visible[visible.length - 1].window_id); }, [visible.length, sel]); // eslint-disable-line

  if (error) return <ErrorState error={error} />;
  if (!run) return <Loading label="Loading run" />;
  const done = TERMINAL.includes(run.state);
  const pctDone = run.windows_total ? run.windows_completed / run.windows_total : 0;

  return (
    <div className="space-y-5">
      <Panel title={<span>{run.title} <span className="ml-1 font-mono text-xs font-normal text-muted">{run.run_id}</span></span>}
        aside={<RunState s={run.state} />}>
        {run.description && <p className="mb-3 text-sm leading-6 text-[#c5cfdf] max-w-[85ch]">{run.description}</p>}
        <div className="h-1.5 overflow-hidden rounded bg-hair"><div className="h-1.5 rounded bg-teal transition-all" style={{ width: `${pctDone * 100}%` }} /></div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <span>{run.windows_completed} of {run.windows_total} windows</span><span>{run.message}</span>
          {run.elapsed_seconds !== undefined && <span>{run.elapsed_seconds}s elapsed</span>}
          <span>Created {when(run.created_at)}</span>
          {run.params.seed !== undefined && <span>seed {run.params.seed}</span>}
        </div>
        {run.error && <div className="mt-3"><Note tone="warn">{run.error}</Note></div>}
        {run.reproduction && (
          <div className="mt-3 flex items-start gap-2 text-sm">
            {run.reproduction.comparable ? (run.reproduction.reproduces_recorded
              ? <><CheckCircle2 size={16} className="mt-0.5 text-teal" />Reproduces the recorded {run.reproduction.compared_with}: max |ΔAHS| {fx(run.reproduction.max_abs_ahs_difference, 6)}, governance states identical.</>
              : <><XCircle size={16} className="mt-0.5 text-st-abstain" />Differs from {run.reproduction.compared_with}: max |ΔAHS| {fx(run.reproduction.max_abs_ahs_difference, 6)}; states identical: {String(run.reproduction.governance_states_identical)}.</>)
              : <span className="text-xs text-muted">{run.reproduction.reason}</span>}
          </div>)}
        {done && windows.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hair pt-4">
            <Tabs value={mode} onChange={(m) => { setMode(m); setPlaying(false); setShown(m === "playback" ? 0 : windows.length); setSel(null); }}
              options={[{ id: "all", label: "All windows" }, { id: "playback", label: "Simulated streaming" }]} />
            {mode === "playback" && (<>
              <button className="btn btn-quiet" onClick={() => setPlaying(!playing)} disabled={shown >= windows.length}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? "Pause" : "Play"}</button>
              <button className="btn btn-quiet" onClick={() => { setShown(Math.min(shown + 1, windows.length)); setSel(windows[shown]?.window_id ?? sel); }} disabled={shown >= windows.length}><SkipForward size={14} />Step</button>
              <select className="field" value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Playback speed">
                <option value={2500}>Slow</option><option value={1500}>Normal</option><option value={600}>Fast</option></select>
              <span className="text-xs text-[#A08EF0]">Playback of already-computed windows at a controlled pace — not live observations.</span>
            </>)}
          </div>)}
      </Panel>

      {visible.length === 0 ? (
        <Empty title={done ? (mode === "playback" ? "Press play to reveal windows" : "No windows were produced") : "Waiting for the first window"}>
          {!done && "The pipeline loads the dataset, builds splits and measures freeze baselines before the first window (about 10 seconds)."}
        </Empty>) : (<>
        <Panel title="AHS by window" aside={<span className="text-xs text-muted">{windows[0]?.part === "injected" || run.params.scenario === "injected_ramp" ? "Declared ramp order" : "Partition index — not time"}</span>}>
          <div className="h-60"><ResponsiveContainer>
            <LineChart data={visible} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} onClick={(s: any) => s?.activeLabel && setSel(s.activeLabel)}>
              <CartesianGrid stroke={CHART.grid} />
              <XAxis dataKey="window_id" stroke={CHART.axis} tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 1]} stroke={CHART.axis} width={36} />
              <ReferenceArea y1={0} y2={bands.suspension} fill={CHART.rose} fillOpacity={0.06} />
              <ReferenceArea y1={bands.suspension} y2={bands.review} fill={CHART.amber} fillOpacity={0.05} />
              <ReferenceLine y={bands.review} stroke={CHART.amber} strokeDasharray="4 3" />
              <ReferenceLine y={bands.suspension} stroke={CHART.rose} strokeDasharray="4 3" />
              {sel && <ReferenceLine x={sel} stroke={CHART.text} strokeOpacity={0.4} />}
              <Tooltip content={<ChartTip />} />
              <Line dataKey="ahs" name="AHS" stroke={CHART.cyan} strokeWidth={2} isAnimationActive={false}
                dot={(p: any) => <circle key={p.payload.window_id} cx={p.cx} cy={p.cy} r={4} fill={STATE_COLOR[p.payload.states?.separated] ?? CHART.cyan} stroke="#0C1524" strokeWidth={1.5} />} />
            </LineChart></ResponsiveContainer></div>
          <div className="mt-2 flex flex-wrap gap-1">
            {visible.map((w: any) => (
              <button key={w.window_id} onClick={() => setSel(w.window_id)}
                className={`rounded px-2 py-1 font-mono text-xs ${sel === w.window_id ? "bg-raised text-text ring-1 ring-cyan/60" : "text-muted hover:bg-raised"}`}
                style={{ borderBottom: `2px solid ${STATE_COLOR[w.states?.separated]}` }}>{w.window_id}</button>))}
          </div>
        </Panel>
        {sel && <WindowDetail runId={runId} windowId={sel} live={!done} />}
      </>)}
    </div>);
}

function WindowDetail({ runId, windowId, live }: { runId: string; windowId: string; live: boolean }) {
  const { data, error, loading } = useApi<any>(`/api/replay/${runId}/windows/${windowId}`, [runId, windowId, live]);
  const comps = useMemo(() => data ? Object.entries(data.data.components).sort((a: any, b: any) => (b[1].contribution ?? 0) - (a[1].contribution ?? 0)) : [], [data]);
  if (loading) return <Loading label={`Loading ${windowId}`} />;
  if (error) return <ErrorState error={error} />;
  const w = data.data;
  const sep = w.governance.separated, col = w.governance.collapsed;
  const agree = w.alert_ahs === w.alert_or_rule;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel title={<span className="font-mono">{w.window_id}</span>} aside={<EvidenceChip cls={w.evidence_class} small />}>
          <KV rows={[["Rows", w.n?.toLocaleString()], ["Severity", w.severity ?? "—"], ["AHS", fx(w.ahs)], ["AHS, missing as zero", fx(w.ahs_declared_weights)],
            ["Not run", w.missing_monitors.length ? <span key="m" className="text-xs">{w.missing_monitors.map(mname).join(", ")}</span> : "none"], ["Recorded", when(w.recorded_at)]]} />
          {w.meta?.caveat && <p className="mt-2 text-xs text-muted">{w.meta.caveat}</p>}
        </Panel>
        <Panel title="AHS rule vs independent monitors">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md bg-ink p-3"><div className="label">AHS &lt; {w.review_band}</div><div className="mt-1 text-lg" style={{ color: w.alert_ahs ? "#E2686A" : "#4E9E8C" }}>{w.alert_ahs ? "Alert" : "No alert"}</div></div>
            <div className="rounded-md bg-ink p-3"><div className="label">Any monitor beyond bound</div><div className="mt-1 text-lg" style={{ color: w.alert_or_rule ? "#E2686A" : "#4E9E8C" }}>{w.alert_or_rule ? "Alert" : "No alert"}</div></div>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">{agree ? "Both rules agree on this window." : "The rules disagree on this window."} Triggered: {w.triggered.map(mname).join(", ") || "none"}.</p>
        </Panel>
        <Panel title="Governance" aside={<EvidenceChip cls="SIMULATED" small />}>
          <div className="space-y-3 text-sm">
            <div><div className="label">Separated</div><div className="mt-1 flex flex-wrap items-center gap-1.5"><StateBadge state={sep.from_state} size="xs" /><span className="text-faint">→</span><StateBadge state={sep.to_state} size="xs" /></div>
              <div className="mt-1 text-xs text-muted">{sep.reason}</div></div>
            <div><div className="label">Collapsed</div><div className="mt-1 flex flex-wrap items-center gap-1.5"><StateBadge state={col.from_state} size="xs" /><span className="text-faint">→</span><StateBadge state={col.to_state} size="xs" /></div>
              <div className="mt-1 text-xs text-muted">{col.reason}</div></div>
          </div>
        </Panel>
      </div>

      <Panel title="Monitor outputs" pad={false}>
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Monitor</th><th>Evidence</th><th>Status</th><th>Key measurement</th><th>Violation</th><th>Entering AHS</th><th>Weight</th><th>Contribution</th></tr></thead>
          <tbody>{w.monitors.map((m: any) => {
            const c = w.components[m.monitor] ?? {};
            return (<tr key={m.monitor}><td>{mname(m.monitor)}</td><td><EvidenceChip cls={m.evidence_class} small /></td>
              <td><MonitorStatus status={m.triggered ? "triggered" : "within_bound"} /></td><td className="text-xs text-muted">{keyMeasure(m)}</td>
              <td className="num">{fx(m.violation)}</td><td className="num">{fx(c.violation_entering_ahs)}{c.saturated ? <span className="ml-1 text-2xs text-[#E2686A]">sat.</span> : null}</td>
              <td className="num">{fx(c.weight, 2)}</td><td className="num">{fx(c.contribution)}</td></tr>);
          })}</tbody></table></div>
        <div className="px-5 py-2 text-2xs text-faint">Calibration and fairness enter the AHS as change from their freeze-time baselines, so “entering AHS” can be lower than the absolute violation.</div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Why the score moved">
          {comps.map(([k, c]: any) => (
            <div key={k} className="mb-2 grid grid-cols-[10rem_1fr_3.5rem] items-center gap-2 text-sm">
              <span className="truncate text-muted">{mname(k)}</span>
              <div className="relative h-2.5 rounded bg-hair"><div className="absolute inset-y-0 rounded bg-hair/80" style={{ width: `${(c.weight ?? 0) * 100}%`, background: "#24375A" }} />
                <div className="absolute inset-y-0 rounded" style={{ width: `${(c.contribution ?? 0) * 100}%`, background: c.saturated ? "#E2686A" : "#5BC6E4" }} /></div>
              <span className="num text-right text-xs">{fx(c.contribution)}</span></div>))}
          <p className="mt-2 text-xs leading-5 text-muted">Bar track is the monitor’s weight (its maximum possible contribution); fill is its actual contribution. AHS = 1 − total = {fx(w.ahs)}.</p>
          {w.ahs_notes?.length > 0 && <div className="mt-3 space-y-2">{w.ahs_notes.map((n: string) => <Note key={n}>{n}</Note>)}</div>}
        </Panel>
        <Panel title="Harm assessment and alert packet">
          <p className="text-sm leading-6"><HarmBadge level={w.harm.harm_level} /> — {w.harm.rationale}</p>
          <div className="mt-3"><KV rows={[["Corroborated", w.harm.corroborated ? "Yes" : "No"], ["Input monitors", w.harm.input_monitors_triggered.map(mname).join(", ") || "none"],
            ["Behaviour monitors", w.harm.behaviour_monitors_triggered.map(mname).join(", ") || "none"], ["Discounted as noise", w.harm.discounted_as_noise?.join(", ") || "none"],
            ["Largest subgroup gap", w.harm.affected_population ?? "—"], ["Investigation", w.alert_packet.recommended_investigation]]} /></div>
          <Link to={`/audit?source=${runId}&open=${w.index}`} className="mt-3 inline-block text-sm text-cyan">Open audit record #{w.index}</Link>
        </Panel>
      </div>
    </div>);
}

function keyMeasure(m: any) {
  const r = m.raw ?? {};
  switch (m.monitor) {
    case "a1_distribution": return `max PSI ${fx(r.max_psi, 3)} (${r.worst_feature}); ${r.n_features_above_psi_threshold} features ≥ ${m.threshold?.psi}`;
    case "a2_relational": return `score PSI ${fx(r.score_psi, 3)}; AUROC ${fx(r.auroc, 3)}`;
    case "a3_structural": return `${r.n_columns_affected} of ${r.n_columns_total} columns affected`;
    case "a4_operational": return `latency ${fx(r.latency_ms, 0)} ms; ${r.faults?.length ?? 0} faults`;
    case "ood": return `flagged ${fx((r.flagged_rate ?? 0) * 100, 2)}% vs ${fx((r.expected_rate ?? 0) * 100, 0)}% expected`;
    case "calibration": return `ECE ${fx(r.ece, 4)} (bound ${m.threshold?.ece})`;
    case "fairness": return `ΔTPR ${fx(r.max_delta_tpr, 3)}${r.worst_pair ? ` (${r.worst_pair[0]})` : ""}; beyond null band: ${r.exceeds_null_band === null ? "—" : r.exceeds_null_band ? "yes" : "no"}`;
    default: return "—";
  }
}
