import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, MessageSquareQuote } from "lucide-react";
import { useApi } from "../lib/useApi";
import { post } from "../lib/api";
import { CHART, fx, humanize, int, mname, pct, signed } from "../lib/format";
import { BandStrip, ChartTip, Collapsible, Empty, ErrorState, EvidenceChip, Loading, Note, PageHeader, Panel, SourceChip, Stat, Tabs } from "../components/ui";
import { FindingCard } from "./shared";

const SECTIONS = [
  ["summary", "Summary"], ["ladder", "Baseline ladder"], ["bootstrap", "Bootstrap"], ["stability", "Window size"],
  ["ood", "OOD detectors"], ["thresholds", "Thresholds"], ["playground", "Policy playground"],
  ["weights", "Weights & normalisation"], ["ablation", "Ablation"], ["severity", "Severity ramp"],
  ["missing", "Missing monitors"], ["scalability", "Scalability"], ["figures", "Figures"],
] as const;

function Defence({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex gap-2.5 rounded-md border border-hair bg-ink px-3 py-2.5 text-sm leading-6 text-[#c5cfdf]">
      <MessageSquareQuote size={16} className="mt-1 shrink-0 text-cyan" /><div><span className="text-muted">If asked: </span>{children}</div>
    </div>);
}

export default function Evidence() {
  const { data, error, loading, reload } = useApi<any>("/api/evidence");
  useEffect(() => {
    if (data && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [data]);
  if (loading) return <Loading label="Loading experiment results" />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const e = data.data;

  return (
    <>
      <PageHeader title="Research Evidence Lab"
        lead={<>The capstone’s findings, rebuilt interactively from the recorded result files. The framework was implemented
          so that it could be shown wrong; the headline result is negative and that is the contribution. Injected
          perturbations are not clinical harm, and nothing here is clinical validation.</>} />

      <nav className="sticky top-14 z-10 -mx-4 mb-6 overflow-x-auto border-b border-hair bg-ink/95 px-4 py-2 backdrop-blur lg:-mx-8 lg:px-8" aria-label="Sections">
        <div className="flex gap-1 whitespace-nowrap">
          {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="tab text-xs">{label}</a>)}
        </div>
      </nav>

      <div className="space-y-8">
        <section id="summary" className="scroll-mt-28">
          <div className="grid gap-4 md:grid-cols-2">{e.findings.map((f: any) => <FindingCard key={f.id} f={f} />)}</div>
        </section>

        {e.ladder ? <Ladder e={e} /> : <Empty title="Sensitivity results (EXP004–006) are not available" />}
        {e.bootstrap && <Bootstrap e={e} />}
        {e.stability && <Stability e={e} />}
        {e.ood ? <Ood e={e} /> : <Empty title="OOD results (EXP007) are not available" />}
        {e.thresholds && <Thresholds e={e} />}
        {e.ladder && <Playground />}
        {e.weights && <Weights e={e} />}
        {e.ladder && <Ablation e={e} />}
        {e.severity_ramp && <Severity e={e} />}
        {e.missing_monitors && <Missing m={e.missing_monitors} bands={e.bands} />}
        {e.scalability && <Scalability s={e.scalability} />}
        <Figures />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ ladder */
function LadderDefence({ e }: { e: any }) {
  const get = (id: string) => e.ladder.rows.find((r: any) => r.id === id);
  const a = get("full_havm_ahs"), o = get("independent_or_rule"), b = e.ladder.bank;
  return <Defence>AHS trades recall for precision ({fx(a.precision, 2)} / {fx(a.recall, 2)} against the OR-rule’s {fx(o.precision, 2)} / {fx(o.recall, 2)}).
    With {b.n_eval} windows one more detected window moves F1 by {fx(b.one_window_f1_step)}, and the AHS–OR gap is {fx(a.f1 - o.f1)} — about one window. See the bootstrap below.</Defence>;
}

function ThresholdDefence({ rows, band }: { rows: any[]; band: number }) {
  const cur = rows.find((r) => r.band === band);
  const best = rows.reduce((m, r) => ((r.f1 ?? 0) > (m.f1 ?? 0) ? r : m), rows[0]);
  if (!cur) return null;
  return <Defence>The configured review band of {band} gives {cur.fp} false alarms with recall {fx(cur.recall, 2)}{best.band === band ? ", the best F1 in this sweep" : `; the best F1 is at ${best.band}`}.
    That choice is POLICY, not a validated threshold — and section 3 shows the same band opening reviews on unchanged data when windows are small.</Defence>;
}

function scaleText(s: any) {
  const w = s.by_window_size;
  if (!w?.length) return "";
  const a = w[0], z = w[w.length - 1];
  return `A ${(z.n / a.n).toFixed(0)}× increase in rows costs ${(z.seconds / a.seconds).toFixed(1)}× the time: fixed overhead dominates, so there is no computational argument for small windows.`;
}

const KIND_COLOR: Record<string, string> = { single: CHART.slate, pair: CHART.cyan, full_havm_ahs: CHART.teal, independent_or_rule: CHART.amber, no_monitoring: "#3a4a66", ablate: CHART.violet };

const LADDER_NAME: Record<string, string> = { full_havm_ahs: "Full HAVM (AHS)", independent_or_rule: "Independent OR-rule", no_monitoring: "No monitoring" };

function Ladder({ e }: { e: any }) {
  const [sel, setSel] = useState<string>("full_havm_ahs");
  const rows = e.ladder.rows.filter((r: any) => r.kind !== "ablate")
    .map((r: any) => ({ ...r, name: r.kind === "single" ? `Single: ${r.label}` : r.kind === "pair" ? `Pair: ${r.label}` : LADDER_NAME[r.id] ?? humanize(r.id), f1v: r.f1 ?? 0 }))
    .sort((a: any, b: any) => a.f1v - b.f1v);
  const cur = rows.find((r: any) => r.id === sel) ?? rows[rows.length - 1];
  return (
    <section id="ladder" className="scroll-mt-28">
      <Panel title="1 · Baseline ladder: does integration beat simpler monitoring?" source={e.ladder.source} aside={<EvidenceChip cls="INJECTED" small />}>
        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <div className="h-[340px]"><ResponsiveContainer>
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 30 }} onClick={(s: any) => s?.activePayload && setSel(s.activePayload[0].payload.id)}>
              <CartesianGrid horizontal={false} stroke={CHART.grid} />
              <XAxis type="number" domain={[0, 1]} stroke={CHART.axis} />
              <YAxis type="category" dataKey="name" width={210} stroke={CHART.axis} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip content={<ChartTip fmt={(v: number) => (v ? fx(v) : "undefined (no alerts)")} />} cursor={{ fill: "#ffffff08" }} />
              <Bar dataKey="f1v" name="F1" className="cursor-pointer" label={{ position: "right", fill: CHART.text, fontSize: 11, formatter: (v: number) => (v ? v.toFixed(3) : "—") }}>
                {rows.map((r: any) => <Cell key={r.id} fill={KIND_COLOR[r.kind] ?? CHART.slate} opacity={r.id === sel ? 1 : 0.75} />)}
              </Bar>
            </BarChart></ResponsiveContainer></div>
          <div>
            <h3>{cur.name}</h3>
            <div className="mt-3 grid grid-cols-3 gap-4">
              <Stat label="Precision" value={fx(cur.precision)} /><Stat label="Recall" value={fx(cur.recall)} /><Stat label="False-alarm rate" value={fx(cur.false_alarm_rate)} />
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs num">
              {[["TP", cur.tp, "#2FB5A3"], ["FP", cur.fp, "#E2A543"], ["FN", cur.fn, "#E2686A"], ["TN", cur.tn, "#4E9E8C"]].map(([l, v, c]) =>
                <div key={l as string} className="rounded py-2" style={{ background: `${c}1a` }}><div style={{ color: c as string }}>{l}</div><div className="text-base">{v}</div></div>)}
            </div>
            <p className="mt-4 text-sm leading-6 text-[#c5cfdf]">{e.ladder.n_eval_windows} evaluation windows ({e.ladder.bank.n_eval_degraded} perturbed, {e.ladder.bank.n_eval_clean} clean;
              {" "}{e.ladder.bank.n_held_out_clean} more clean windows were held out to calibrate the empirical-quantile normalisation), alert band {e.ladder.sweep_band}. Click a bar to inspect it.</p>
            <LadderDefence e={e} />
          </div>
        </div>
      </Panel>
    </section>
  );
}

/* ------------------------------------------------------------------ bootstrap */
function Forest({ rows }: { rows: { label: string; mean: number; lo: number; hi: number; tone: string; note?: string }[] }) {
  const lo = Math.min(0, ...rows.map((r) => r.lo)), hi = Math.max(0, ...rows.map((r) => r.hi));
  const min = Math.floor((lo - 0.01) * 20) / 20, max = Math.ceil((hi + 0.01) * 20) / 20;
  const ticks = Array.from({ length: Math.round((max - min) / 0.05) + 1 }, (_, i) => +(min + i * 0.05).toFixed(2));
  const x = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(10rem,14rem)_1fr_9rem] items-center gap-3 py-2">
          <div className="text-sm">{r.label}{r.note && <div className="text-2xs text-faint">{r.note}</div>}</div>
          <div className="relative h-6">
            <div className="absolute inset-y-0 w-px bg-[#E3E9F2]/40" style={{ left: x(0) }} />
            <div className="absolute top-1/2 h-0.5 -translate-y-1/2" style={{ left: x(r.lo), width: `calc(${x(r.hi)} - ${x(r.lo)})`, background: r.tone }} />
            {[r.lo, r.hi].map((v, i) => <div key={i} className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2" style={{ left: x(v), background: r.tone }} />)}
            <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: x(r.mean), background: r.tone }} />
          </div>
          <div className="text-xs num text-muted">{signed(r.mean)} [{fx(r.lo)}, {fx(r.hi)}]</div>
        </div>))}
      <div className="grid grid-cols-[minmax(10rem,14rem)_1fr_9rem] gap-3 text-2xs text-faint">
        <div /><div className="relative h-4">{ticks.map((v) => <span key={v} className="absolute -translate-x-1/2 num" style={{ left: x(v) }}>{v}</span>)}</div><div />
      </div>
    </div>);
}

function Bootstrap({ e }: { e: any }) {
  const chk = e.bootstrap.integrity_check;
  const rows = e.bootstrap.comparisons.map((c: any) => ({
    label: `AHS − ${c.challenger === "independent_or_rule" ? "OR-rule (as recorded)" : humanize(c.challenger)}`,
    mean: c.delta_f1_mean, lo: c.ci95[0], hi: c.ci95[1], tone: CHART.slate,
    note: c.challenger === "independent_or_rule" && chk?.recorded_reproduced_with_a1_only_or ? "OR over A1 only — see note" : undefined,
  }));
  if (chk) rows.push({ label: "AHS − four-monitor OR-rule", mean: chk.corrected.delta_f1_mean, lo: chk.corrected.ci95[0], hi: chk.corrected.ci95[1], tone: CHART.teal, note: "recomputed here" });
  return (
    <section id="bootstrap" className="scroll-mt-28">
      <Panel title="2 · Bootstrap intervals for the F1 difference" source={e.bootstrap.source} aside={<EvidenceChip cls="INJECTED" small />}>
        <Forest rows={rows} />
        <p className="mt-3 text-sm leading-6 text-[#c5cfdf] max-w-[85ch]">{e.bootstrap.comparisons[0]?.n_resamples.toLocaleString()} resamples over windows, 95% percentile intervals. Every interval touches or crosses zero:
          the integration advantage is <strong>not statistically established</strong>. That is the answer to RQ1 on this substrate.</p>
        {chk && (
          <div className="mt-4"><Note tone="warn">
            <div className="font-medium text-text">Integrity note on the recorded OR-rule interval</div>
            <p className="mt-1">{chk.explanation}</p>
            <p className="mt-1 text-xs text-muted">Recorded: {signed(chk.recorded.delta_f1_mean)} [{fx(chk.recorded.ci95[0])}, {fx(chk.recorded.ci95[1])}] —
              reproduced exactly with A1-only OR decisions: {chk.recorded_reproduced_with_a1_only_or ? "yes" : "no"}. OR alerts: four-monitor {chk.or_alerts.four_monitor},
              A1-only {chk.or_alerts.a1_only}. Corrected: {signed(chk.corrected.delta_f1_mean)} [{fx(chk.corrected.ci95[0])}, {fx(chk.corrected.ci95[1])}]. {chk.method}</p>
          </Note></div>)}
        <Defence>A positive point estimate is not an advantage: the interval is about one window wide and includes zero. The recorded and corrected intervals
          lead to the same conclusion, and the discrepancy was found by recomputing the result from stored measurements rather than trusting the label.</Defence>
      </Panel>
    </section>);
}

/* ------------------------------------------------------------------ stability */
function Stability({ e }: { e: any }) {
  const st = e.stability;
  const rows = [...st.rows].sort((a: any, b: any) => a.window_rows - b.window_rows);
  return (
    <section id="stability" className="scroll-mt-28">
      <Panel title="3 · AHS stability versus window size" source={st.source} aside={<EvidenceChip cls="OBSERVED" small />}>
        <p className="mb-4 text-sm leading-6 text-[#c5cfdf] max-w-[85ch]">Thirty random partitions of the <em>unchanged</em> deployment domain at each window size. A well-behaved score
          would sit still; each dot is one window’s AHS against the governance bands.</p>
        <div className="space-y-5">
          {rows.map((r: any) => {
            const span = r.p05_p95[1] - r.p05_p95[0];
            return (
              <div key={r.window_count} className="grid gap-3 md:grid-cols-[11rem_1fr]">
                <div className="text-sm"><div className="font-medium num">≈{int(r.window_rows)} rows</div>
                  <div className="text-xs text-muted num">mean {fx(r.mean)}, sd {fx(r.sd)}</div>
                  <div className="text-xs num" style={{ color: span / st.governance_band_width > 0.5 ? "#E2686A" : "#4E9E8C" }}>
                    5–95% span {fx(span)} = {pct(span / st.governance_band_width)} of band</div></div>
                <BandStrip review={e.bands.review} suspension={e.bands.suspension} height={40} jitter
                  points={r.scores.map((s: number, i: number) => ({ id: `p${i}`, ahs: s, color: "#5BC6E4cc" }))} />
              </div>);
          })}
        </div>
        <Collapsible title="Clean-window null band (EXP004, source validation resamples)">
          <table className="tbl"><thead><tr><th>Window rows</th><th>Mean AHS</th><th>sd</th><th>5–95%</th><th>Range</th></tr></thead>
            <tbody>{e.null_band.rows.map((r: any) => <tr key={r.window_rows}><td className="num">{int(r.window_rows)}</td><td className="num">{fx(r.mean)}</td><td className="num">{fx(r.sd)}</td>
              <td className="num">{fx(r.p05_p95[0])}–{fx(r.p05_p95[1])}</td><td className="num">{fx(r.range[0])}–{fx(r.range[1])}</td></tr>)}</tbody></table>
        </Collapsible>
        <Defence>At ≈{int(rows[0].window_rows)} rows the score’s own noise on unchanged data covers {pct((rows[0].p05_p95[1] - rows[0].p05_p95[0]) / st.governance_band_width)} of
          the {fx(st.governance_band_width, 2)}-wide governance band; at ≈{int(rows[rows.length - 1].window_rows)} rows, {pct((rows[rows.length - 1].p05_p95[1] - rows[rows.length - 1].p05_p95[0]) / st.governance_band_width)}.
          Mean AHS also moves with window size ({fx(rows[0].mean)} vs {fx(rows[rows.length - 1].mean)}), so scores from different window sizes are different quantities and cannot share
          a threshold. The final report derives its window-size rule from this measurement.</Defence>
      </Panel>
    </section>);
}

/* ------------------------------------------------------------------ OOD */
const DET_LABEL: Record<string, string> = { mahalanobis: "Mahalanobis", knn: "kNN distance", isolation_forest: "Isolation forest", predictive_entropy: "Predictive entropy", max_softmax: "Max softmax", energy: "Energy (LR)" };

function Ood({ e }: { e: any }) {
  const o = e.ood;
  const [group, setGroup] = useState<string>(o.groups[0]?.group ?? "");
  const g = o.groups.find((x: any) => x.group === group) ?? o.groups[0];
  const rows = g.detectors.map((d: any) => ({ ...d, name: DET_LABEL[d.detector], lo: d.ci95?.[0], hi: d.ci95?.[1],
    err: d.ci95 ? [d.auroc - d.ci95[0], d.ci95[1] - d.auroc] : [0, 0] }));
  const means = Object.entries(o.mean_auroc).map(([d, v]) => ({ name: DET_LABEL[d], v, fam: ["predictive_entropy", "max_softmax", "energy"].includes(d) }));
  return (
    <section id="ood" className="scroll-mt-28">
      <Panel title="4 · OOD detector comparison on tabular EHR" source={o.source} aside={<EvidenceChip cls="OBSERVED" small />}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Tabs value={group} onChange={setGroup} options={o.groups.map((x: any) => ({ id: x.group, label: humanize(x.group) }))} />
          <span className="text-xs text-muted">n in group {int(g.n_in_group)} · {g.rationale}</span>
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
          <div>
            <div className="h-72"><ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="name" stroke={CHART.axis} tick={{ fontSize: 10 }} interval={0} />
                <YAxis domain={[0, 1]} stroke={CHART.axis} width={36} />
                <ReferenceLine y={0.5} stroke={CHART.text} strokeDasharray="4 3" label={{ value: "chance", fill: CHART.axis, fontSize: 10, position: "insideTopLeft" }} />
                <Tooltip content={<ChartTip fmt={(v: number, p: any) => `${fx(v)}${p.payload.ci95 ? `  95% CI [${fx(p.payload.lo)}, ${fx(p.payload.hi)}]` : ""}`} />} cursor={{ fill: "#ffffff08" }} />
                <Bar dataKey="auroc" name="AUROC">{rows.map((r: any) => <Cell key={r.detector} fill={r.family === "uncertainty" ? CHART.violet : CHART.teal} />)}
                  <ErrorBar dataKey="err" width={6} stroke={CHART.text} strokeWidth={1.5} /></Bar>
              </BarChart></ResponsiveContainer></div>
            <div className="flex flex-wrap gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: CHART.teal }} />Distance / density</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: CHART.violet }} />Uncertainty family</span>
              {g.bootstrap_available && <span>Intervals: EXP011, {g.bootstrap?.n_resamples?.toLocaleString()} resamples ({g.bootstrap?.resampling_unit}-level, detector fit held fixed) <SourceChip source={o.ci_source} /></span>}
            </div>
          </div>
          <div>
            <h3>Mean AUROC across groups</h3>
            <div className="mt-2 space-y-1.5">{means.sort((a: any, b: any) => b.v - a.v).map((m: any) => (
              <div key={m.name} className="grid grid-cols-[8.5rem_1fr_3rem] items-center gap-2 text-sm">
                <span className="text-muted">{m.name}</span>
                <div className="relative h-2 rounded bg-hair"><div className="absolute inset-y-0 left-0 rounded" style={{ width: `${m.v * 100}%`, background: m.fam ? CHART.violet : CHART.teal }} />
                  <div className="absolute inset-y-[-3px] w-px bg-text/60" style={{ left: "50%" }} /></div>
                <span className="num text-right">{fx(m.v)}</span></div>))}</div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Stat label="Uncertainty family" value={fx(o.uncertainty_family_mean)} tone={CHART.violet} sub="chance is 0.500" />
              <Stat label="Distance / density" value={fx(o.distance_density_family_mean)} tone={CHART.teal} />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">Energy is {o.energy_note}. Predictive entropy and max softmax are monotone transforms of the same binary probability, so their AUROCs coincide.</p>
          </div>
        </div>
        <ScoreDistributions group={group} />
        <Defence>On paediatric and adolescent patients predictive entropy is <em>inverted</em> (AUROC well below 0.5): the model is most confident about the patients least
          represented in training. This replicates the published negative result for uncertainty methods on tabular EHR. The groups were fixed by clinical criteria before scoring.</Defence>
      </Panel>
    </section>);
}

function ScoreDistributions({ group }: { group: string }) {
  const { data, error, loading } = useApi<any>("/api/evidence/ood-distributions");
  const [det, setDet] = useState("predictive_entropy");
  if (loading) return <Loading label="Loading score distributions" />;
  if (error) return <Note>{error.message}</Note>;
  const g = data.data.groups[group];
  if (!g) return null;
  const d = g.detectors[det];
  const rows = d.group_density.map((v: number, i: number) => ({ x: (d.edges[i] + d.edges[i + 1]) / 2, group: v, rest: d.remainder_density[i] }));
  return (
    <div className="mt-6 border-t border-hair pt-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3>Score distributions: {humanize(group)} vs everyone else</h3>
        <select className="field ml-auto" value={det} onChange={(ev) => setDet(ev.target.value)} aria-label="Detector">
          {Object.keys(g.detectors).map((k) => <option key={k} value={k}>{DET_LABEL[k]}</option>)}
        </select>
      </div>
      <div className="h-56"><ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} />
          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} stroke={CHART.axis} tickFormatter={(v) => v.toPrecision(3)} />
          <YAxis stroke={CHART.axis} width={44} tickFormatter={(v) => v.toPrecision(2)} />
          <Tooltip content={<ChartTip fmt={(v: number) => v.toPrecision(3)} />} labelFormatter={(v: number) => `score ${v.toPrecision(3)}`} />
          <Legend verticalAlign="top" height={22} />
          <Area dataKey="rest" name={`Remainder (n ${int(g.n_remainder)})`} stroke={CHART.slate} fill={CHART.slate} fillOpacity={0.25} type="step" isAnimationActive={false} />
          <Area dataKey="group" name={`${humanize(group)} (n ${int(g.n_group)})`} stroke={CHART.amber} fill={CHART.amber} fillOpacity={0.3} type="step" isAnimationActive={false} />
        </AreaChart></ResponsiveContainer></div>
      <p className="text-xs text-muted">Binned densities computed server-side from the EXP011 export, clipped to the 0.5–99.5th percentile. Higher score means “more out-of-distribution”; no record-level values leave the server.</p>
    </div>);
}

/* ------------------------------------------------------------------ thresholds */
function Thresholds({ e }: { e: any }) {
  const rows = e.thresholds.rows;
  const [band, setBand] = useState(0.75);
  const cur = rows.find((r: any) => r.band === band) ?? rows[0];
  return (
    <section id="thresholds" className="scroll-mt-28">
      <Panel title="5 · Threshold sensitivity and false alarms" source={e.thresholds.source} aside={<EvidenceChip cls="INJECTED" small />}>
        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <div className="h-72"><ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={CHART.grid} />
              <XAxis dataKey="band" type="number" domain={[0.5, 0.95]} ticks={rows.map((r: any) => r.band)} stroke={CHART.axis} />
              <YAxis domain={[0, 1]} stroke={CHART.axis} width={36} />
              <ReferenceLine x={band} stroke={CHART.text} strokeOpacity={0.5} />
              <Tooltip content={<ChartTip />} labelFormatter={(v: number) => `AHS review band ${v}`} />
              <Legend verticalAlign="top" height={24} />
              <Line dataKey="precision" name="Precision" stroke={CHART.cyan} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="recall" name="Recall" stroke={CHART.teal} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="f1" name="F1" stroke={CHART.text} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="false_alarm_rate" name="False-alarm rate" stroke={CHART.rose} strokeWidth={2} isAnimationActive={false} />
            </LineChart></ResponsiveContainer></div>
          <div>
            <label className="label" htmlFor="band">Review band: alert when AHS &lt; {band}</label>
            <input id="band" type="range" min={0} max={rows.length - 1} step={1} value={rows.findIndex((r: any) => r.band === band)}
              onChange={(ev) => setBand(rows[+ev.target.value].band)} className="mt-2 w-full accent-[#2FB5A3]" />
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Stat label="Precision" value={fx(cur.precision)} /><Stat label="Recall" value={fx(cur.recall)} />
              <Stat label="F1" value={fx(cur.f1)} /><Stat label="False-alarm rate" value={fx(cur.false_alarm_rate)} tone={cur.false_alarm_rate > 0 ? "#E2686A" : undefined} />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">{cur.tp} true alerts, {cur.fp} false alarms, {cur.fn} misses across {cur.tp + cur.fp + cur.fn + cur.tn} windows; alert rate {pct(cur.alert_rate)}.</p>
          </div>
        </div>
        <ThresholdDefence rows={rows} band={e.bands.review} />
      </Panel>
    </section>);
}

/* ------------------------------------------------------------------ playground */
function Playground() {
  const def = useApi<any>("/api/evidence/policy/defaults");
  const [w, setW] = useState<Record<string, number> | null>(null);
  const [band, setBand] = useState(0.75);
  const [norm, setNorm] = useState("threshold_relative");
  const [ablate, setAblate] = useState<string[]>([]);
  const [boot, setBoot] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (def.data && !w) { setW(def.data.data.weights); setBand(def.data.data.band); } }, [def.data, w]);
  const body = useMemo(() => w && ({ weights: w, band, normalisation: norm, ablate, bootstrap: boot ? 2000 : 0 }), [w, band, norm, ablate, boot]);
  useEffect(() => {
    if (!body) return;
    const t = setTimeout(() => {
      setBusy(true);
      post<any>("/api/evidence/policy", body).then((r) => { setRes(r.data); setErr(null); }).catch((x) => setErr(x.message)).finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(t);
  }, [body]);

  if (def.loading || !w) return <Loading />;
  if (def.error) return <ErrorState error={def.error} />;
  const d = def.data.data;
  const isDefault = norm === "threshold_relative" && band === d.band && !ablate.length && d.monitors.every((m: string) => Math.abs(w[m] - d.weights[m]) < 1e-9);

  return (
    <section id="playground" className="scroll-mt-28">
      <Panel title="6 · Policy playground: recompute the detection result" aside={<span className="flex items-center gap-2">{busy && <Loader2 size={14} className="animate-spin text-muted" />}<EvidenceChip cls="INJECTED" small /></span>}>
        <p className="mb-4 text-sm leading-6 text-[#c5cfdf] max-w-[90ch]">Change the AHS policy and the server re-scores the 35 stored evaluation windows with the project’s own <code className="font-mono text-xs">havm.sweep.rescore</code>.
          No monitor is re-run, so every policy is compared on identical measurements. The default policy reproduces the recorded F1 exactly.</p>
        <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
          <div className="space-y-4">
            {d.monitors.map((m: string) => (
              <div key={m}>
                <div className="flex items-center justify-between text-sm">
                  <label htmlFor={`w-${m}`} className={ablate.includes(m) ? "text-faint line-through" : ""}>{mname(m)}</label>
                  <span className="num text-muted">{fx(w[m], 2)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input id={`w-${m}`} type="range" min={0} max={1} step={0.01} value={w[m]} disabled={ablate.includes(m)}
                    onChange={(ev) => setW({ ...w, [m]: +ev.target.value })} className="w-full accent-[#2FB5A3]" />
                  <label className="flex items-center gap-1 text-2xs text-muted"><input type="checkbox" checked={ablate.includes(m)}
                    onChange={(ev) => setAblate(ev.target.checked ? [...ablate, m] : ablate.filter((x) => x !== m))} />drop</label>
                </div>
              </div>))}
            <div>
              <div className="flex justify-between text-sm"><label htmlFor="pb">Review band</label><span className="num text-muted">{band.toFixed(2)}</span></div>
              <input id="pb" type="range" min={0.05} max={0.95} step={0.05} value={band} onChange={(ev) => setBand(+(+ev.target.value).toFixed(2))} className="w-full accent-[#2FB5A3]" />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="norm" className="text-muted">Normalisation</label>
              <select id="norm" className="field flex-1" value={norm} onChange={(ev) => setNorm(ev.target.value)}>
                {d.normalisations.map((n: string) => <option key={n} value={n}>{humanize(n)}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={boot} onChange={(ev) => setBoot(ev.target.checked)} />Bootstrap AHS − OR-rule (2,000 resamples)</label>
            <button className="btn btn-quiet" onClick={() => { setW(d.weights); setBand(d.band); setNorm("threshold_relative"); setAblate([]); }}>Reset to recorded policy</button>
          </div>
          <div>
            {err && <Note tone="warn">{err}</Note>}
            {res && (<>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="AHS F1" value={fx(res.ahs.f1)} tone={CHART.teal} sub={`P ${fx(res.ahs.precision, 2)} · R ${fx(res.ahs.recall, 2)}`} />
                <Stat label="OR-rule F1" value={fx(res.or_rule.f1)} tone={CHART.amber} sub={`P ${fx(res.or_rule.precision, 2)} · R ${fx(res.or_rule.recall, 2)}`} />
                <Stat label="AHS false alarms" value={res.ahs.fp} sub={`of ${res.n_eval_clean} clean windows`} />
                <Stat label="Difference" value={signed((res.ahs.f1 ?? 0) - (res.or_rule.f1 ?? 0))}
                  sub={res.bootstrap_ahs_minus_or ? `95% CI [${fx(res.bootstrap_ahs_minus_or.ci95[0])}, ${fx(res.bootstrap_ahs_minus_or.ci95[1])}]` : "enable bootstrap for CI"} />
              </div>
              <div className="mt-2 text-xs text-muted">{isDefault ? "Recorded policy: these values equal results/metrics/EXP004-006_sensitivity.json." : "Counterfactual policy: recomputed, not a recorded result."}</div>
              <div className="mt-5 h-56"><ResponsiveContainer>
                <ComposedChart data={res.windows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="window_id" stroke={CHART.axis} tick={{ fontSize: 9 }} interval={1} />
                  <YAxis domain={[0, 1]} stroke={CHART.axis} width={36} />
                  <ReferenceArea y1={0} y2={band} fill={CHART.rose} fillOpacity={0.06} />
                  <ReferenceLine y={band} stroke={CHART.rose} strokeDasharray="4 3" />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="ahs" name="AHS">{res.windows.map((x: any) => <Cell key={x.window_id} fill={x.degraded ? CHART.amber : CHART.teal} opacity={x.alert_ahs === !!x.degraded ? 1 : 0.35} />)}</Bar>
                </ComposedChart></ResponsiveContainer></div>
              <p className="text-xs leading-5 text-muted">Bars: teal clean, amber perturbed. Faded bars are AHS errors (a false alarm or a miss) at this band.</p>
            </>)}
          </div>
        </div>
      </Panel>
    </section>);
}

/* ------------------------------------------------------------------ weights & normalisation */
function Weights({ e }: { e: any }) {
  const rd = e.weights.random_dirichlet;
  const rows = e.weights.named.map((r: any) => ({ ...r, name: humanize(r.config) }));
  return (
    <section id="weights" className="scroll-mt-28">
      <Panel title="7 · Weight and normalisation sensitivity" source={e.weights.source} aside={<EvidenceChip cls="INJECTED" small />}>
        <div className="grid gap-6 xl:grid-cols-2">
          <div>
            <h3>Named weightings, band {e.ladder.sweep_band}</h3>
            <div className="mt-2 h-52"><ResponsiveContainer>
              <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 30 }}>
                <CartesianGrid horizontal={false} stroke={CHART.grid} />
                <XAxis type="number" domain={[0, 1]} stroke={CHART.axis} />
                <YAxis type="category" dataKey="name" width={130} stroke={CHART.axis} tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTip />} cursor={{ fill: "#ffffff08" }} />
                <Bar dataKey="f1" name="F1" fill={CHART.cyan} label={{ position: "right", fill: CHART.text, fontSize: 11, formatter: (v: number) => v.toFixed(3) }} />
              </BarChart></ResponsiveContainer></div>
            {rd && (<>
              <h3 className="mt-4">{rd.n} random Dirichlet weightings</h3>
              <div className="relative mt-3 h-6 rounded bg-hair">
                <div className="absolute inset-y-0 rounded bg-[#A08EF055]" style={{ left: `${rd.f1_range[0] * 100}%`, width: `${(rd.f1_range[1] - rd.f1_range[0]) * 100}%` }} />
                <div className="absolute inset-y-0 w-0.5 bg-text" style={{ left: `${rd.f1_mean * 100}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted num"><span>F1 {fx(rd.f1_range[0])}</span><span>mean {fx(rd.f1_mean)} ± {fx(rd.f1_sd)}</span><span>{fx(rd.f1_range[1])}</span></div>
            </>)}
          </div>
          <div>
            <h3>Normalisation functions, best band each</h3>
            <table className="tbl mt-2"><thead><tr><th>Function</th><th>Best band</th><th>F1</th><th>Precision</th><th>Recall</th></tr></thead>
              <tbody>{e.normalisation.rows.map((r: any) => <tr key={r.method}><td>{humanize(r.method)}</td><td className="num">{fx(r.best_band, 2)}</td><td className="num">{fx(r.f1)}</td><td className="num">{fx(r.precision)}</td><td className="num">{fx(r.recall)}</td></tr>)}</tbody></table>
            <p className="mt-3 text-sm leading-6 text-[#c5cfdf]">All three reach the same best F1. They are monotone in the raw metric, so below saturation they rank windows identically and only move where the band
              must sit. Normalisation matters for severity resolution instead (section 9).</p>
          </div>
        </div>
        <Defence>Sensible named weightings stay in a narrow range, but random weightings span almost the whole F1 axis. Nothing in the framework constrains the choice, so a
          weighting nobody would notice was bad can make the composite nearly useless.</Defence>
      </Panel>
    </section>);
}

function Ablation({ e }: { e: any }) {
  const full = e.ladder.rows.find((r: any) => r.id === "full_havm_ahs");
  const ab = e.ladder.rows.filter((r: any) => r.kind === "ablate").map((r: any) => r.f1 ?? 0);
  const axisMin = Math.max(0, Math.floor((Math.min(full.f1, ...ab) - 0.04) * 20) / 20);
  const step: number | null = e.ladder.bank.one_window_f1_step;
  const maxDrop = Math.max(...e.ladder.rows.filter((r: any) => r.kind === "ablate").map((r: any) => Math.abs(full.f1 - (r.f1 ?? full.f1))));
  const rows = [{ name: "Nothing removed", f1: full.f1, kind: "full" },
    ...e.ladder.rows.filter((r: any) => r.kind === "ablate").map((r: any) => ({ name: `Without ${mname(r.label)}`, f1: r.f1, kind: "ablate" }))];
  return (
    <section id="ablation" className="scroll-mt-28">
      <Panel title="8 · Ablation" source={e.ladder.source} aside={<EvidenceChip cls="INJECTED" small />}>
        <div className="h-56"><ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 30 }}>
            <CartesianGrid horizontal={false} stroke={CHART.grid} />
            <XAxis type="number" domain={[axisMin, Math.min(1, Math.ceil((full.f1 + 0.02) * 20) / 20)]} stroke={CHART.axis} />
            <YAxis type="category" dataKey="name" width={240} stroke={CHART.axis} tick={{ fontSize: 11 }} />
            {step && <ReferenceArea x1={full.f1 - step} x2={full.f1} fill={CHART.text} fillOpacity={0.05} />}
            <Tooltip content={<ChartTip />} cursor={{ fill: "#ffffff08" }} />
            <Bar dataKey="f1" name="F1" label={{ position: "right", fill: CHART.text, fontSize: 11, formatter: (v: number) => v.toFixed(3) }}>
              {rows.map((r) => <Cell key={r.name} fill={r.kind === "full" ? CHART.teal : CHART.violet} />)}</Bar>
          </BarChart></ResponsiveContainer></div>
        <p className="text-xs text-muted">Axis starts at {fx(axisMin, 2)}. The shaded strip is {fx(step)}, the F1 change from one additional detected window (computed from the full-AHS confusion counts).</p>
        <Defence>The largest ablation change is {fx(maxDrop)}{step ? ` (${(maxDrop / step).toFixed(1)}× the one-window step of ${fx(step)})` : ""}. On {e.ladder.n_eval_windows} windows,
          with no interval on these differences, that is not evidence that any component earns its place. A3 alone has recall {fx(e.ladder.rows.find((r: any) => r.id === "single::a3_structural")?.recall, 2)}, which is correct: the perturbation changes case mix, not schema.</Defence>
      </Panel>
    </section>);
}

function Severity({ e }: { e: any }) {
  const r = e.severity_ramp;
  const bands = e.bands;
  return (
    <section id="severity" className="scroll-mt-28">
      <Panel title="9 · Severity ramp: does the score track severity?" source={r.source} aside={<EvidenceChip cls="INJECTED" small />}>
        <div className="h-64"><ResponsiveContainer>
          <ComposedChart data={r.windows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} />
            <XAxis dataKey="window_id" stroke={CHART.axis} />
            <YAxis domain={[0, 1]} stroke={CHART.axis} width={36} />
            <ReferenceLine y={bands.review} stroke={CHART.amber} strokeDasharray="4 3" />
            <ReferenceLine y={bands.suspension} stroke={CHART.rose} strokeDasharray="4 3" />
            <Tooltip content={<ChartTip />} />
            <Legend verticalAlign="top" height={24} />
            <Bar dataKey="severity" name="Injected severity" fill={CHART.amber} fillOpacity={0.35} />
            <Line dataKey="ahs" name="AHS" stroke={CHART.cyan} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart></ResponsiveContainer></div>
        <p className="text-sm leading-6 text-[#c5cfdf]">Monotone decreasing on the ramp: <strong>{r.monotone_decreasing_on_ramp ? "yes" : "no"}</strong> (as recorded). AHS reaches its floor of {fx(r.floor.min_ahs)} at
          severit{r.floor.severities_at_floor.length > 1 ? "ies" : "y"} {r.floor.severities_at_floor.join(" and ")}, with saturated components unable to fall further; the maximum-severity window does not score lower
          ({fx(r.windows.find((w: any) => w.severity === Math.max(...r.windows.map((x: any) => x.severity)))?.ahs)}). Clean windows ({r.floor.clean_window_ids.join(", ")}) range from {fx(r.floor.clean_ahs_range?.[0])} to {fx(r.floor.clean_ahs_range?.[1])} at
          identical severity — the window noise from section 3.</p>
      </Panel>
    </section>);
}

function Missing({ m, bands }: { m: any; bands: any }) {
  const pts = [{ id: "Renormalised (4 monitors)", ahs: m.four_renormalised, color: CHART.cyan }, { id: "All seven measured", ahs: m.seven_measured, color: CHART.text },
    { id: "Missing as zero (4 monitors)", ahs: m.four_missing_as_zero, color: CHART.amber }];
  return (
    <section id="missing" className="scroll-mt-28">
      <Panel title="10 · Missing monitors bias the score in both directions" source={m.source} aside={<EvidenceChip cls="OBSERVED" small />}>
        <BandStrip review={bands.review} suspension={bands.suspension} points={pts} height={38} />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">{pts.map((p) => <Stat key={p.id} label={p.id} value={fx(p.ahs)} tone={p.color} />)}</div>
        <p className="mt-3 text-sm leading-6 text-[#c5cfdf]">Same deployment domain. Treating absent monitors as zero overstates health by {signed(m.four_missing_as_zero - m.seven_measured)}; renormalising understates it by {signed(m.four_renormalised - m.seven_measured)} (governance band width {fx(bands.width, 2)}). Recomputed with
          <code className="mx-1 font-mono text-xs">compute_ahs</code>from the stored EXP008 results; matches the recorded values: {m.matches_recorded ? "yes" : "no"}.</p>
      </Panel>
    </section>);
}

function Scalability({ s }: { s: any }) {
  return (
    <section id="scalability" className="scroll-mt-28">
      <Panel title="11 · Scalability" source={s.source} aside={<EvidenceChip cls="OBSERVED" small />}>
        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <div className="h-64"><ResponsiveContainer>
            <ComposedChart data={s.by_window_size} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} />
              <XAxis dataKey="n" stroke={CHART.axis} tickFormatter={(v) => int(v)} />
              <YAxis yAxisId="s" stroke={CHART.axis} width={36} />
              <YAxis yAxisId="r" orientation="right" stroke={CHART.axis} width={52} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip content={<ChartTip />} labelFormatter={(v: number) => `${int(v)} rows`} />
              <Legend verticalAlign="top" height={24} />
              <Bar yAxisId="s" dataKey="seconds" name="Seconds per window" fill={CHART.slate} />
              <Line yAxisId="r" dataKey="rows_per_second" name="Rows per second" stroke={CHART.teal} strokeWidth={2} isAnimationActive={false} />
            </ComposedChart></ResponsiveContainer></div>
          <div className="space-y-3 text-sm">
            <Stat label="Full pipeline" value={`${fx(s.pipeline_seconds, 2)} s`} />
            <Stat label="Four vs seven monitors, n = 5,000" value={`${fx(s.four_monitor_seconds_n5000, 2)} s / ${fx(s.seven_monitor_seconds_n5000, 2)} s`} />
            <p className="text-xs leading-5 text-muted">Single process, {s.hardware?.cpu_count} CPU, {s.hardware?.processor}. {scaleText(s)}</p>
          </div>
        </div>
      </Panel>
    </section>);
}

function Figures() {
  const { data } = useApi<any>("/api/figures");
  const [open, setOpen] = useState<string | null>(null);
  const figs = data?.data ?? [];
  return (
    <section id="figures" className="scroll-mt-28">
      <Panel title="12 · Recorded research figures" aside={<span className="text-xs text-muted">results/figures, generated by scripts/make_figures*.py</span>}>
        {figs.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {figs.map((f: any) => (
              <button key={f.name} onClick={() => setOpen(f.url)} className="rounded-md border border-hair bg-white/95 p-1 text-left">
                <img src={f.url} alt={humanize(f.name.replace(".png", ""))} loading="lazy" className="h-36 w-full object-contain" />
                <div className="bg-surface px-2 py-1 text-2xs text-muted">{f.name}</div>
              </button>))}
          </div>) : <Empty title="No figures found">Run python scripts/make_figures.py to regenerate them.</Empty>}
        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setOpen(null)} role="dialog" aria-modal>
            <img src={open} alt="Research figure" className="max-h-full max-w-full rounded bg-white" />
          </div>)}
      </Panel>
    </section>);
}
