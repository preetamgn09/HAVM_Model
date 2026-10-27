import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Minus, Plus, Play } from "lucide-react";
import { useApi } from "../lib/useApi";
import { post } from "../lib/api";
import { STATE_COLOR, STATE_LABEL, fx, humanize, mname } from "../lib/format";
import { ErrorState, EvidenceChip, HarmBadge, KV, Loading, Note, PageHeader, Panel, SourceChip, StateBadge, Tabs } from "../components/ui";

export default function Governance() {
  const { data, error, loading, reload } = useApi<any>("/api/governance");
  const [part, setPart] = useState<"observed" | "injected">("observed");
  const [selIdx, setSelIdx] = useState<number | null>(null);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const g = data.data;
  const tl = g.timeline;
  const rows = tl ? tl[part] : [];
  const sel = rows.find((r: any) => r.audit_index === selIdx) ?? rows[0];

  return (
    <>
      <PageHeader title="Governance"
        lead="How monitor output becomes a governance recommendation, using the state machine implemented in src/havm/governance.py. Two policies run on identical monitor output so their difference can be counted.">
        <div className="mt-3"><Note tone="warn">{g.disclaimer}</Note></div>
      </PageHeader>

      <Panel title="States, in order of severity" aside={<EvidenceChip cls="POLICY" small />}>
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {g.states.map((s: any) => (
            <div key={s.state} className="rounded-md border-t-2 bg-ink px-3 py-2.5" style={{ borderColor: STATE_COLOR[s.state] }}>
              <div className="text-sm font-medium" style={{ color: STATE_COLOR[s.state] }}>{STATE_LABEL[s.state]}</div>
              <div className="mt-1 text-xs leading-5 text-muted">{s.meaning}</div>
            </div>))}
        </div>
      </Panel>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Panel title="Decision rules" aside={<span className="text-xs text-muted">GovernanceEngine._proposed_state</span>}>
          <div className="grid gap-5 md:grid-cols-2">
            {(["separated", "collapsed"] as const).map((v) => (
              <div key={v}>
                <h3>{v === "separated" ? "Separated: detect → assess harm → govern" : "Collapsed: detect → act"}</h3>
                <table className="tbl mt-2"><thead><tr><th>Harm</th><th>Condition</th><th>Proposes</th></tr></thead>
                  <tbody>{g.rules[v].map((r: any, i: number) => (
                    <tr key={i}><td>{r.harm === "not assessed" ? <span className="text-xs text-faint">not assessed</span> : <HarmBadge level={r.harm} />}</td>
                      <td className="text-xs">{r.condition}</td><td><StateBadge state={r.proposes} size="xs" /></td></tr>))}</tbody></table>
              </div>))}
          </div>
          <p className="mt-4 text-xs leading-5 text-muted">{g.persistence_note}</p>
        </Panel>
        <Panel title="Policy configuration" source={g.config.source}>
          <KV rows={[["Review band", `AHS < ${g.config.bands.review}`], ["Suspension band", `AHS < ${g.config.bands.suspension}`],
            ["Persistence", `${g.config.persistence_windows} consecutive windows to escalate`], ["Corroboration", g.config.require_corroboration ? "Two independent input detectors must agree" : "Not required"],
            ["Variants", g.config.variants.join(", ")], ["Matches recorded run", g.config_matches_recorded_run === null ? "—" : g.config_matches_recorded_run ? "Yes" : "No — current config differs from EXP003"]]} />
          <h3 className="mb-2 mt-4">Harm levels</h3>
          <div className="space-y-1.5 text-xs leading-5">{Object.entries(g.harm_levels).map(([k, v]: any) => <div key={k}><HarmBadge level={k} /> <span className="text-muted">— {v}</span></div>)}</div>
        </Panel>
      </div>

      {tl && (
        <Panel title="Recorded decision timeline, EXP003" className="mt-5" source={tl.source}
          aside={<Tabs value={part} onChange={(p) => { setPart(p); setSelIdx(null); }} options={[{ id: "observed", label: "Observed W000–W009" }, { id: "injected", label: "Injected ramp R00–R09" }]} />}>
          <div className="overflow-x-auto">
            <div className="grid min-w-[760px] gap-y-1.5" style={{ gridTemplateColumns: `8rem repeat(${rows.length}, minmax(0,1fr))` }}>
              <div />{rows.map((r: any) => (
                <button key={r.window_id} onClick={() => setSelIdx(r.audit_index)}
                  className={`rounded px-1 py-1 text-center font-mono text-xs ${sel?.audit_index === r.audit_index ? "bg-raised text-text" : "text-muted hover:text-text"}`}>
                  {r.window_id}{r.severity !== null && r.severity !== undefined && <div className="font-sans text-2xs text-[#D9A04A]">sev {r.severity}</div>}
                </button>))}
              <div className="self-center text-xs text-muted">AHS</div>
              {rows.map((r: any) => <div key={r.window_id} className="text-center text-xs num">{fx(r.ahs, 2)}</div>)}
              <div className="self-center text-xs text-muted">Harm</div>
              {rows.map((r: any) => <div key={r.window_id} className="text-center"><HarmBadge level={r.harm.harm_level} /></div>)}
              {(["separated", "collapsed"] as const).map((v) => (<Fragment key={v}>
                <div className="self-center text-xs text-muted capitalize">{v}</div>
                {rows.map((r: any) => {
                  const t = r[v];
                  return (
                    <button key={`${v}${r.window_id}`} onClick={() => setSelIdx(r.audit_index)} title={`${STATE_LABEL[t.to_state]} — ${t.reason}`}
                      className={`h-9 rounded text-2xs ${sel?.audit_index === r.audit_index ? "ring-1 ring-text/60" : ""}`}
                      style={{ background: `${STATE_COLOR[t.to_state]}33`, borderBottom: `3px solid ${STATE_COLOR[t.to_state]}` }}>
                      {t.event === "held" ? "held" : t.event === "escalation" ? "▲" : t.event === "de_escalation" ? "▼" : ""}
                    </button>);
                })}</Fragment>))}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted">
            {Object.keys(STATE_LABEL).map((s) => <span key={s} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: STATE_COLOR[s] }} />{STATE_LABEL[s]}</span>)}
            <span>▲ escalation · ▼ de-escalation · held = proposed escalation waiting for persistence</span>
          </div>
          {sel && <TransitionDetail r={sel} />}
        </Panel>
      )}

      {g.comparison && (
        <Panel title="Separated versus collapsed" className="mt-5" source={g.comparison.source} pad={false}>
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>Windows</th><th>Policy</th><th>Escalations</th><th>De-escalations</th><th>Suspension windows</th><th>Abstention windows</th><th>Final state</th></tr></thead>
            <tbody>{(["observed", "injected"] as const).flatMap((p) => (["separated", "collapsed"] as const).map((v) => {
              const s = g.comparison[p][v];
              return (<tr key={p + v}><td>{p === "observed" ? "Observed partition" : "Injected ramp"}</td><td className="capitalize">{v}</td>
                <td className="num">{s.escalations}</td><td className="num">{s.de_escalations}</td>
                <td className="num" style={{ color: s.state_occupancy.AUTOMATED_PREDICTION_SUSPENSION ? STATE_COLOR.AUTOMATED_PREDICTION_SUSPENSION : undefined }}>{s.state_occupancy.AUTOMATED_PREDICTION_SUSPENSION}</td>
                <td className="num">{s.state_occupancy.ABSTENTION_RECOMMENDED}</td><td><StateBadge state={s.final_state} size="xs" /></td></tr>);
            }))}</tbody></table></div>
          <p className="px-5 py-3 text-sm leading-6 text-[#c5cfdf]">On the observed windows the collapsed policy recommends suspension in {g.comparison.observed.collapsed.state_occupancy.AUTOMATED_PREDICTION_SUSPENSION} of {g.comparison.observed.collapsed.n_windows};
            the separated policy in {g.comparison.observed.separated.state_occupancy.AUTOMATED_PREDICTION_SUSPENSION}. Separation is structural and cheap — it is not the aggregation the framework claims as novel.</p>
        </Panel>
      )}

      <Simulator />
    </>
  );
}

function TransitionDetail({ r }: { r: any }) {
  const s = r.separated;
  return (
    <div className="mt-5 grid gap-5 border-t border-hair pt-5 xl:grid-cols-[1.3fr_1fr]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-mono">{r.window_id}</h3><EvidenceChip cls={r.evidence_class} small /><EvidenceChip cls="SIMULATED" small />
          <Link to={`/audit?open=${r.audit_index}`} className="ml-auto text-xs text-cyan">Audit record #{r.audit_index}</Link>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <StateBadge state={s.from_state} /><ArrowRight size={14} className="text-faint" />
          <span className="text-xs text-muted">proposed</span><StateBadge state={s.proposed_state} /><ArrowRight size={14} className="text-faint" />
          <span className="text-xs text-muted">applied</span><StateBadge state={s.to_state} />
        </div>
        <p className="mt-3 text-sm leading-6"><span className="text-muted">Reason: </span>{s.reason}</p>
        <p className="mt-2 text-sm leading-6"><span className="text-muted">Harm assessment: </span><HarmBadge level={r.harm.harm_level} /> — {r.harm.rationale}</p>
        {r.harm.affected_population && <p className="mt-1 text-xs text-muted">Largest subgroup gap: {r.harm.affected_population}</p>}
        <p className="mt-2 text-sm"><span className="text-muted">Collapsed policy: </span><StateBadge state={r.collapsed.to_state} size="xs" /> <span className="text-xs text-muted">{r.collapsed.reason}</span></p>
      </div>
      <div>
        <div className="label mb-2">Why AHS = {fx(r.ahs)}: contributions to the deficit</div>
        {Object.entries(r.ahs_components).sort((a: any, b: any) => b[1] - a[1]).map(([k, v]: any) => (
          <div key={k} className="mb-1.5 grid grid-cols-[9.5rem_1fr_3rem] items-center gap-2 text-xs">
            <span className="truncate text-muted">{mname(k)}</span>
            <div className="h-2 rounded bg-hair"><div className="h-2 rounded bg-cyan" style={{ width: `${Math.min(v / 0.6, 1) * 100}%` }} /></div>
            <span className="num text-right">{fx(v)}</span></div>))}
        <div className="mt-2 text-xs text-muted">Triggered: {r.triggered_monitors.map(mname).join(", ") || "none"}</div>
      </div>
    </div>);
}

type Step = { ahs: number; harm_level: "NONE" | "POTENTIAL" | "MEASURED"; input_change: boolean };
// Example INPUT for the simulator (editable), not a result. Every output comes from GovernanceEngine.
const PRESET: Step[] = [
  { ahs: 0.9, harm_level: "NONE", input_change: false }, { ahs: 0.45, harm_level: "POTENTIAL", input_change: true },
  { ahs: 0.43, harm_level: "POTENTIAL", input_change: true }, { ahs: 0.42, harm_level: "MEASURED", input_change: true },
  { ahs: 0.41, harm_level: "MEASURED", input_change: true }, { ahs: 0.85, harm_level: "NONE", input_change: false },
];

function Simulator() {
  const [steps, setSteps] = useState<Step[]>(PRESET);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upd = (i: number, p: Partial<Step>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  async function run() {
    setBusy(true); setErr(null);
    try { setRes((await post<any>("/api/governance/simulate", { steps })).data); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Panel title="Policy simulator" className="mt-5" aside={<EvidenceChip cls="SIMULATED" small />}>
      <p className="mb-4 text-sm leading-6 text-[#c5cfdf] max-w-[90ch]">Define a sequence of windows and step the real <code className="font-mono text-xs">GovernanceEngine</code> through it with the configured bands and
        persistence. The rows below are an editable example input, not recorded data. Use it to show why a state was proposed, held or released.</p>
      <div className="overflow-x-auto"><table className="tbl">
        <thead><tr><th>Window</th><th>AHS</th><th>Harm level</th><th>Input change</th><th>Separated</th><th>Collapsed</th><th /></tr></thead>
        <tbody>{steps.map((s, i) => {
          const t = res?.transitions?.[i];
          return (
            <tr key={i}><td className="font-mono text-xs">S{String(i).padStart(2, "0")}</td>
              <td><div className="flex items-center gap-2"><input type="range" min={0} max={1} step={0.01} value={s.ahs} onChange={(e) => upd(i, { ahs: +e.target.value })} className="w-28 accent-[#2FB5A3]" aria-label={`AHS for window ${i}`} /><span className="num text-xs">{s.ahs.toFixed(2)}</span></div></td>
              <td><select className="field" value={s.harm_level} onChange={(e) => upd(i, { harm_level: e.target.value as Step["harm_level"] })} aria-label="Harm level">
                {["NONE", "POTENTIAL", "MEASURED"].map((h) => <option key={h}>{h}</option>)}</select></td>
              <td><input type="checkbox" checked={s.input_change} onChange={(e) => upd(i, { input_change: e.target.checked })} aria-label="Input monitor triggered" /></td>
              <td>{t ? <div title={t.separated.reason}><StateBadge state={t.separated.to_state} size="xs" /><div className="text-2xs text-faint">{humanize(t.separated.event)}</div></div> : <span className="text-faint">—</span>}</td>
              <td>{t ? <StateBadge state={t.collapsed.to_state} size="xs" /> : <span className="text-faint">—</span>}</td>
              <td><button aria-label="Remove window" className="text-faint hover:text-text disabled:opacity-30" disabled={steps.length <= 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Minus size={14} /></button></td></tr>);
        })}</tbody></table></div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn btn-quiet" disabled={steps.length >= 50} onClick={() => setSteps([...steps, { ...steps[steps.length - 1] }])}><Plus size={14} />Add window</button>
        <button className="btn btn-quiet" onClick={() => { setSteps(PRESET); setRes(null); }}>Reset example</button>
        <button className="btn btn-primary" onClick={run} disabled={busy}><Play size={14} />{busy ? "Running…" : "Step the engine"}</button>
      </div>
      {err && <div className="mt-3"><Note tone="warn">{err}</Note></div>}
      {res && <p className="mt-3 text-xs text-muted">{res.method} Hover a state to read the engine’s reason. <SourceChip source={{ file: "configs/monitors.yaml", field: "governance", evidence_class: "POLICY" }} /></p>}
    </Panel>
  );
}
