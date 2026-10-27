import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { useApi } from "../lib/useApi";
import { CHART, EVIDENCE_COLOR, fx, humanize, int } from "../lib/format";
import { ChartTip, Collapsible, Empty, ErrorState, EvidenceChip, JsonBlock, KV, Loading, MonitorStatus, Note, PageHeader, Panel, SourceChip, Stat, Tabs } from "../components/ui";
import { ReliabilityChart } from "./Performance";

const ORDER = ["a1_distribution", "a2_relational", "a3_structural", "a4_operational", "ood", "calibration", "fairness"];

function valueFmt(id: string, v: any) {
  if (v === null || v === undefined) return "—";
  if (id === "a3_structural") return `${(v * 100).toFixed(0)}% of columns`;
  if (id === "a4_operational") return `${v} fault${v === 1 ? "" : "s"}`;
  return fx(v, 4);
}
const METRIC_LABEL: Record<string, string> = {
  a1_distribution: "Max PSI", a2_relational: "Score PSI", a3_structural: "Contract columns affected",
  a4_operational: "Operational faults", ood: "Excess OOD rate", calibration: "ECE", fairness: "Max ΔTPR",
};

export default function Monitors() {
  const { id = "a1_distribution" } = useParams();
  const nav = useNavigate();
  const list = useApi<any>("/api/monitors");
  const valid = ORDER.includes(id);
  const detail = useApi<any>(valid ? `/api/monitors/${id}` : null, [id]);

  if (list.loading) return <Loading />;
  if (list.error) return <ErrorState error={list.error} retry={list.reload} />;
  const monitors: any[] = list.data.data;

  return (
    <>
      <PageHeader title="Monitor Explorer"
        lead="Seven assumption monitors share one contract: a raw measurement, a declared threshold, a normalised violation in [0, 1] and an evidence class. Select a monitor to see what it measures, what it found and where its evidence stops." />
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <div className="space-y-2" role="listbox" aria-label="Monitors">
          {monitors.map((m) => (
            <button key={m.id} role="option" aria-selected={m.id === id} onClick={() => nav(`/monitors/${m.id}`)}
              className={`panel w-full px-4 py-3 text-left transition-colors ${m.id === id ? "border-teal/60 bg-raised" : "hover:bg-raised/50"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{m.name}</span>
                <span className="text-2xs text-faint">{m.assumption}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <MonitorStatus status={m.snapshot.status ?? m.snapshot.availability} />
                <span className="text-2xs text-muted num">weight {fx(m.config.weight, 2)}</span>
              </div>
            </button>
          ))}
          <p className="px-1 pt-2 text-2xs leading-4 text-faint">Status is the full deployment-domain measurement from EXP008, the only run with all seven monitors.</p>
        </div>

        <div className="min-w-0">
          {!valid ? <Empty title="Unknown monitor">Choose one from the list.</Empty>
            : detail.loading ? <Loading /> : detail.error ? <ErrorState error={detail.error} retry={detail.reload} />
            : <Detail m={detail.data.data} />}
        </div>
      </div>
    </>
  );
}

function Detail({ m }: { m: any }) {
  const s = m.snapshot;
  const [tab, setTab] = useState<"exp003" | "bank" | "exp002">(m.exp003_series.available ? "exp003" : "bank");
  return (
    <div className="space-y-5">
      <Panel title={<span>{m.name} <span className="ml-1 text-muted font-normal">· {m.id}</span></span>} source={s.source}>
        <p className="text-sm leading-6 text-[#c5cfdf] max-w-[75ch]">{m.question}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
          <span>{m.family === "behaviour" ? "Observes model behaviour (can establish harm)" : "Observes inputs (cannot establish harm alone)"}</span>
          <span>·</span><span>Labels: {m.needs_labels === true ? "required" : m.needs_labels === false ? "not required" : "partly"}</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-6">
          <div><div className="label">Status</div><div className="mt-2"><MonitorStatus status={s.status} /></div></div>
          <Stat label={METRIC_LABEL[m.id]} value={<span className="text-xl">{valueFmt(m.id, s.value)}</span>} />
          <Stat label="Threshold" value={<span className="text-xl">{s.threshold === null || s.threshold === undefined ? (m.id === "a3_structural" ? "any" : "rules") : fx(s.threshold, 3)}</span>} sub="POLICY" />
          <Stat label="Freeze baseline" value={<span className="text-xl">{m.freeze_baseline ? fx(m.freeze_baseline.value, 4) : "—"}</span>}
            sub={m.freeze_baseline ? m.freeze_baseline.metric : "absolute entry"} />
          <Stat label="Violation" value={<span className="text-xl">{fx(s.violation, 3)}</span>} sub={s.violation >= 1 ? "saturated" : "normalised"} />
          <div><div className="label">Evidence</div><div className="mt-2"><EvidenceChip cls={s.evidence_class} /></div></div>
        </div>
        <div className="mt-2 text-2xs text-faint">{s.context}. AHS contribution {fx(s.ahs_contribution, 3)}.</div>
        {s.notes?.length > 0 && <div className="mt-4 space-y-2">{s.notes.map((n: string) => <Note key={n}>{n}</Note>)}</div>}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="How the signal works">
          <KV rows={[["Measures", m.signal], ["Violation", m.violation_rule], ["Entry to AHS", humanize(m.config.entry_mode)],
            ["Weight", fx(m.config.weight, 2)]]} />
          <h3 className="mb-2 mt-4">Known limitations</h3>
          <ul className="space-y-1.5 text-sm leading-6 text-[#c5cfdf]">{m.limitations.map((l: string) => <li key={l} className="flex gap-2"><span className="text-faint">–</span>{l}</li>)}</ul>
        </Panel>
        <Panel title="Configured parameters" source={m.config.source}>
          <KV rows={Object.entries(m.config.parameters).map(([k, v]) => [humanize(k), String(v)])} />
          <p className="mt-3 text-xs text-muted">Every threshold is a POLICY choice of this project, varied in the Gate 6 sensitivity experiments. None is clinically validated.</p>
        </Panel>
      </div>

      <Panel title="Results across windows" aside={<Tabs value={tab} onChange={setTab} options={[
        { id: "exp003", label: "EXP003 replay" }, { id: "bank", label: "Detection bank" }, { id: "exp002", label: "EXP002 comparisons" }]} />}>
        {tab === "exp003" && <Exp003 m={m} />}
        {tab === "bank" && <Bank m={m} />}
        {tab === "exp002" && <Exp002 m={m} />}
      </Panel>

      <Evidence m={m} />
    </div>
  );
}

function Exp003({ m }: { m: any }) {
  const e = m.exp003_series;
  if (!e.available) return <Empty title="Not evaluated in this experiment">{e.reason}</Empty>;
  const rows = e.windows.map((w: any) => ({ ...w, v: w.value }));
  const thr = rows.find((r: any) => typeof r.threshold === "number")?.threshold;
  return (<>
    <div className="h-64"><ResponsiveContainer>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="window_id" stroke={CHART.axis} interval={0} tick={{ fontSize: 10 }} />
        <YAxis stroke={CHART.axis} width={52} />
        <Tooltip content={<ChartTip fmt={(v: number) => valueFmt(m.id, v)} />} cursor={{ fill: "#ffffff08" }} />
        {thr !== undefined && <ReferenceLine y={thr} stroke={CHART.rose} strokeDasharray="4 3" label={{ value: `threshold ${thr}`, fill: CHART.rose, fontSize: 10, position: "insideTopRight" }} />}
        <Bar dataKey="v" name={METRIC_LABEL[m.id]}>{rows.map((r: any) => <Cell key={r.window_id} fill={EVIDENCE_COLOR[r.evidence_class] ?? CHART.slate} />)}</Bar>
      </BarChart></ResponsiveContainer></div>
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
      <EvidenceChip cls="OBSERVED" small /> W000–W009, random partition (not a time series)
      <EvidenceChip cls="INJECTED" small /> R00–R09, severities {rows.filter((r: any) => r.severity !== null && r.severity !== undefined).map((r: any) => r.severity).join(", ")}
      <SourceChip source={e.source} />
    </div>
  </>);
}

function Bank({ m }: { m: any }) {
  const b = m.window_bank;
  if (!b.available) return <Empty title="Not in the detection bank">{b.reason}</Empty>;
  const rows = b.rows.map((r: any) => ({ x: r.severity, y: r.value, id: r.window_id, kind: r.kind }));
  return (<>
    <div className="h-64"><ResponsiveContainer>
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={CHART.grid} />
        <XAxis type="number" dataKey="x" name="Severity" domain={[-0.05, 1.05]} ticks={[0, 0.1, 0.25, 0.5, 0.75, 1]} stroke={CHART.axis} />
        <YAxis type="number" dataKey="y" name={b.metric} stroke={CHART.axis} width={56} />
        <ZAxis range={[40, 40]} />
        <Tooltip content={<ChartTip fmt={(v: number, p: any) => p.dataKey === "x" ? fx(v, 2) : fx(v, 4)} />} />
        <Scatter data={rows} name={b.metric}>{rows.map((r: any) => <Cell key={r.id} fill={r.x === 0 ? CHART.teal : CHART.amber} />)}</Scatter>
      </ScatterChart></ResponsiveContainer></div>
    <p className="mt-2 text-xs leading-5 text-muted">{b.rows.length} windows: {b.rows.filter((r: any) => !r.degraded).length} clean (resampled from source validation) and {b.rows.filter((r: any) => r.degraded).length} perturbed at declared severities. Ground truth is injected — a window is “degraded” because a perturbation was applied, not because patients were harmed. <SourceChip source={b.source} /></p>
  </>);
}

function Exp002({ m }: { m: any }) {
  const e = m.exp002_comparisons;
  if (!e.available) return <Empty title="EXP002 results unavailable" />;
  return (
    <div className="overflow-x-auto"><table className="tbl">
      <thead><tr><th>Comparison</th><th>Rows</th><th>Evidence</th><th>{METRIC_LABEL[m.id]}</th><th>Threshold</th><th>Violation</th><th>Status</th></tr></thead>
      <tbody>{e.rows.map((r: any) => (
        <tr key={r.comparison}><td>{humanize(r.comparison)}</td><td className="num">{int(r.n_window)}</td><td><EvidenceChip cls={r.evidence_class} small /></td>
          <td className="num">{r.availability === "measured" ? valueFmt(m.id, r.value) : "not evaluated"}</td>
          <td className="num">{r.threshold === null || r.threshold === undefined ? "—" : fx(r.threshold, 3)}</td><td className="num">{fx(r.violation)}</td>
          <td>{r.availability === "measured" ? <MonitorStatus status={r.triggered ? "triggered" : "within_bound"} /> : <MonitorStatus status="not_evaluated" />}</td></tr>))}
      </tbody></table>
      <p className="mt-2 text-xs text-muted">The null control compares source validation with training data: an in-distribution window that should stay quiet. <SourceChip source={e.source} /></p>
    </div>);
}

function Evidence({ m }: { m: any }) {
  const ev = m.evidence ?? {};
  if (m.id === "a1_distribution" && ev.per_feature) {
    const rows = ev.per_feature.map((f: any) => ({ ...f, psi_plot: Math.min(f.psi, 1) }));
    return (
      <Panel title="Per-feature drift, full deployment domain" aside={<EvidenceChip cls="OBSERVED" small />}>
        <div className="h-[520px]"><ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid horizontal={false} stroke={CHART.grid} />
            <XAxis type="number" domain={[0, 1]} stroke={CHART.axis} />
            <YAxis type="category" dataKey="feature" width={168} stroke={CHART.axis} tick={{ fontSize: 11 }} interval={0} />
            <Tooltip content={<ChartTip fmt={(_v: number, p: any) => `PSI ${fx(p.payload.psi, 4)}${p.payload.significant_fdr ? ", FDR-significant" : ""}`} />} cursor={{ fill: "#ffffff08" }} />
            <ReferenceLine x={0.2} stroke={CHART.rose} strokeDasharray="4 3" />
            <ReferenceLine x={0.1} stroke={CHART.amber} strokeDasharray="2 3" />
            <Bar dataKey="psi_plot" name="PSI (clipped at 1)">{rows.map((r: any) => <Cell key={r.feature} fill={r.psi >= 0.2 ? CHART.rose : r.psi >= 0.1 ? CHART.amber : CHART.cyan} />)}</Bar>
          </BarChart></ResponsiveContainer></div>
        <p className="text-xs leading-5 text-muted">{rows.filter((r: any) => r.significant_fdr).length} of {rows.length} features are significant under Benjamini–Hochberg, but only {rows.filter((r: any) => r.psi >= 0.2).length} exceed the PSI effect-size bound of 0.2. admission_type_id reaches PSI {fx(rows[0]?.psi, 2)} (clipped in the chart). Linear MMD² = {fx(ev.mmd?.mmd2, 4)} on {int(ev.mmd?.n_used)} rows.</p>
      </Panel>);
  }
  if (m.id === "fairness" && ev.per_attribute) return (
    <Panel title="Subgroup rates at the operating point, full deployment domain" aside={<EvidenceChip cls="OBSERVED" small />}>
      <div className="grid gap-5 lg:grid-cols-3">
        {Object.entries(ev.per_attribute).map(([attr, a]: any) => {
          const nb = ev.null_bands?.[attr];
          return (
            <div key={attr}>
              <h3 className="capitalize">{attr}</h3>
              <div className="mt-1 text-xs text-muted num">ΔTPR {fx(a.delta_tpr)} · null band p95 {fx(nb?.null_p95)} ·{" "}
                <span style={{ color: nb?.exceeds_null_band ? "#E2686A" : "#4E9E8C" }}>{nb?.exceeds_null_band ? "exceeds noise" : "within noise"}</span></div>
              <table className="tbl mt-2"><thead><tr><th>Group</th><th>n</th><th>TPR</th><th>FPR</th></tr></thead>
                <tbody>{a.groups.map((g: any) => <tr key={g.group}><td className="text-xs">{g.group}</td><td className="num text-xs">{int(g.n)}</td><td className="num text-xs">{fx(g.tpr)}</td><td className="num text-xs">{fx(g.fpr)}</td></tr>)}</tbody></table>
              {ev.suppressed?.[attr] && <p className="mt-1 text-2xs text-faint">Suppressed: {ev.suppressed[attr].map((s: any) => `${s.group} (${s.gate.replace("_", " ")})`).join(", ")}</p>}
            </div>);
        })}
      </div>
      <p className="mt-4 text-xs leading-5 text-muted max-w-[90ch]">A disparity above the declared {m.snapshot.thresholds?.delta_tpr} threshold but inside its {Object.values(ev.null_bands ?? {})[0] ? (Object.values(ev.null_bands)[0] as any).n_permutations : ""}-permutation null band is indistinguishable from sampling noise; triage discounts it. Groups are suppressed below {m.snapshot.thresholds?.min_group_size} rows or {m.snapshot.thresholds?.min_positives} positives because TPR is conditional on positives.</p>
    </Panel>);
  if (m.id === "calibration" && ev.bins) return (
    <Panel title="Reliability, full deployment domain" aside={<EvidenceChip cls="OBSERVED" small />}>
      <ReliabilityChart series={[{ name: "Deployment domain", bins: ev.bins, color: CHART.amber }]} />
    </Panel>);
  if (m.id === "a3_structural") return (
    <Panel title="Schema contract violations, full deployment domain">
      {ev.schema_violations?.length ? (
        <table className="tbl"><thead><tr><th>Type</th><th>Column</th><th>Detail</th></tr></thead>
          <tbody>{ev.schema_violations.map((v: any, i: number) => (
            <tr key={i}><td>{humanize(v.type)}</td><td className="font-mono text-xs">{v.column}</td>
              <td className="text-xs text-muted">{v.type === "unseen_category" ? `unseen: ${v.values.join(", ")}` : v.type === "out_of_range" ? `${v.above_max} above max, ${v.below_min} below min (range ${v.expected_range.join("–")})` : ""}</td></tr>))}</tbody></table>
      ) : <Empty title="No schema violations recorded" />}
    </Panel>);
  if (m.id === "a2_relational" && ev.label_blind) return (
    <Panel title="Label-blind view" aside={<EvidenceChip cls="OBSERVED" small />}>
      <p className="text-sm leading-6 text-[#c5cfdf]">A live deployment would not yet have outcomes. With labels withheld, only score drift is available:
        score PSI {fx(ev.label_blind.raw.score_psi, 4)}, violation {fx(ev.label_blind.violation)}, {ev.label_blind.triggered ? "beyond bound" : "within bound"}.
        With labels, AUROC fell {fx(m.snapshot.raw.auroc_delta, 3)} from {fx(m.snapshot.raw.baseline_auroc, 3)}.</p>
    </Panel>);
  if (m.id === "a4_operational") return (
    <Panel title="Simulated batch record" aside={<EvidenceChip cls="SIMULATED" small />}>
      <Note tone="warn">Invented telemetry. No public dataset carries pipeline logs; this exists only so the monitor can be exercised.</Note>
      <div className="mt-3"><JsonBlock value={ev.batch} max={220} /></div>
    </Panel>);
  if (m.id === "ood") return (
    <Panel title="Detector choice">
      <p className="text-sm leading-6 text-[#c5cfdf]">The OOD monitor uses Mahalanobis distance, the strongest detector in the EXP007 bake-off.
        Flagged {fx(m.snapshot.raw.flagged_rate * 100, 2)}% of rows against an expected {fx(m.snapshot.raw.expected_rate * 100, 0)}%.</p>
      <Link to="/evidence#ood" className="mt-2 inline-block text-sm text-cyan">See the detector comparison in the Evidence Lab</Link>
    </Panel>);
  return <Collapsible title="Raw snapshot"><JsonBlock value={m.snapshot.raw} /></Collapsible>;
}
