import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { useApi } from "../lib/useApi";
import { CHART, fx, humanize, int, pct, signed } from "../lib/format";
import { ChartTip, ErrorState, EvidenceChip, KV, Loading, Note, PageHeader, Panel, SourceChip, Stat, Tabs } from "../components/ui";

export function ReliabilityChart({ series }: { series: { name: string; bins: any[]; color: string }[] }) {
  const max = Math.max(0.4, ...series.flatMap((s) => s.bins.map((b) => Math.max(b.mean_predicted, b.observed_rate)))) ;
  const lim = Math.min(1, Math.ceil(max * 10) / 10);
  return (
    <div className="h-72"><ResponsiveContainer>
      <LineChart margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
        <CartesianGrid stroke={CHART.grid} />
        <XAxis type="number" dataKey="mean_predicted" domain={[0, lim]} stroke={CHART.axis}
          label={{ value: "Mean predicted probability", position: "insideBottom", offset: -8, fill: CHART.axis, fontSize: 11 }} />
        <YAxis type="number" domain={[0, lim]} stroke={CHART.axis} width={44}
          label={{ value: "Observed rate", angle: -90, position: "insideLeft", fill: CHART.axis, fontSize: 11 }} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: lim, y: lim }]} stroke={CHART.axis} strokeDasharray="4 4" />
        <Tooltip content={<ChartTip fmt={(v: number, p: any) => `observed ${fx(v)} · predicted ${fx(p.payload.mean_predicted)} · n ${int(p.payload.n)}`} />} />
        <Legend verticalAlign="top" height={24} />
        {series.map((s) => (
          <Line key={s.name} data={s.bins} dataKey="observed_rate" name={s.name} stroke={s.color} strokeWidth={2}
            dot={{ r: 3, fill: s.color }} isAnimationActive={false} />
        ))}
      </LineChart></ResponsiveContainer></div>
  );
}

export default function Performance() {
  const { data, error, loading, reload } = useApi<any>("/api/performance");
  const [attr, setAttr] = useState<"race" | "gender" | "age">("age");
  const [cal, setCal] = useState<"validation" | "both">("validation");
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const p = data.data;
  const sel = p.candidates.find((c: any) => c.selected);
  const cm = sel.confusion;
  const op = sel.operating_point;
  const dep = p.deployment;
  const colors: Record<string, string> = { prevalence: CHART.slate, logistic_regression: CHART.cyan, gradient_boosting: CHART.teal };

  return (
    <>
      <PageHeader title="Model Performance"
        lead={<>The monitored object: a gradient-boosted model predicting 30-day readmission (readmitted “&lt;30”) on the Diabetes
          130-US Hospitals extract. It was selected on source-domain validation by AUPRC, then frozen. This page reads its recorded
          metrics; no model is retrained or re-scored here.</>} />

      <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
        <Panel title="Task and split" source={p.sources.model_card}>
          <KV rows={[
            ["Task", `${p.task.name} (positive: ${p.task.label.positive_values.join(", ")})`],
            ["Training domain", `${humanize(p.task.training_domain)} admissions`],
            ["Deployment domain", `${humanize(p.task.deployment_domain)} admissions`],
            ["Train / validation", `${int(p.split.train_encounters)} / ${int(p.split.validation_encounters)} encounters`],
            ["Patients", `${int(p.split.train_patients)} / ${int(p.split.validation_patients)}, overlap ${p.split.patient_overlap_train_validation}`],
            ["Features", `${p.task.features.numeric.length} numeric, ${p.task.features.categorical.length} categorical`],
            ["Selection", p.task.selection],
            ["Frozen", `${p.model.model_version}, retraining: none`],
          ]} />
          <p className="mt-3 text-xs leading-5 text-muted">Splits are by patient, never by encounter. The deployment domain stayed sealed through model selection.</p>
        </Panel>

        <Panel title="Frozen model on source validation" source={p.sources.validation}>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="AUROC" value={fx(sel.auroc)} sub="discrimination" />
            <Stat label="AUPRC" value={fx(sel.auprc)} sub={`prevalence ${fx(sel.prevalence)}`} />
            <Stat label="Brier score" value={fx(sel.brier, 4)} sub="lower is better" />
            <Stat label="ECE" value={fx(sel.ece, 4)} sub="equal-width bins" />
          </div>
          <div className="mt-5 grid gap-5 border-t border-hair pt-5 sm:grid-cols-[auto_1fr]">
            {cm ? (
              <div>
                <div className="label mb-2">Confusion at the top-decile operating point</div>
                <div className="grid grid-cols-[auto_6rem_6rem] text-sm">
                  <div /><div className="px-2 pb-1 text-2xs text-muted">Flagged</div><div className="px-2 pb-1 text-2xs text-muted">Not flagged</div>
                  <div className="pr-3 text-2xs text-muted self-center">Readmitted</div>
                  <Cell2 v={cm.tp} l="TP" c="#2FB5A3" /><Cell2 v={cm.fn} l="FN" c="#E2686A" />
                  <div className="pr-3 text-2xs text-muted self-center">Not readmitted</div>
                  <Cell2 v={cm.fp} l="FP" c="#E2A543" /><Cell2 v={cm.tn} l="TN" c="#4E9E8C" />
                </div>
                <p className="mt-2 max-w-[28ch] text-2xs leading-4 text-faint">{cm.derivation}</p>
              </div>) : <Note>Counts could not be reconstructed exactly, so they are not shown.</Note>}
            <div>
              <div className="label mb-2">Threshold metrics</div>
              <KV rows={[["Threshold", fx(op.threshold, 4)], ["Sensitivity (TPR)", pct(op.tpr, 1)], ["False-positive rate", pct(op.fpr, 1)],
                ["Precision (PPV)", pct(op.precision, 1)], ["Flagged", `${int(op.n_flagged)} of ${int(sel.n)}`]]} />
              <p className="mt-2 text-xs leading-5 text-muted">The operating point flags the top 10% of risk, a workload anchor declared as POLICY.</p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Model comparison" className="mt-5" pad={false} source={p.sources.validation}>
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Candidate</th><th>AUROC</th><th>AUPRC</th><th>Brier</th><th>ECE</th><th>TPR @ op</th><th>Precision @ op</th><th /></tr></thead>
          <tbody>{p.candidates.map((c: any) => (
            <tr key={c.id} className={c.selected ? "sel" : ""}>
              <td className="font-medium">{c.label}</td><td className="num">{fx(c.auroc, 4)}</td><td className="num">{fx(c.auprc, 4)}</td>
              <td className="num">{fx(c.brier, 4)}</td><td className="num">{fx(c.ece, 4)}</td>
              <td className="num">{pct(c.operating_point?.tpr, 1)}</td><td className="num">{pct(c.operating_point?.precision, 1)}</td>
              <td>{c.selected && <span className="text-xs text-teal">Frozen</span>}</td></tr>))}</tbody>
        </table></div>
      </Panel>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Panel title="Calibration reliability" aside={<Tabs value={cal} onChange={setCal} options={[{ id: "validation", label: "Validation" }, { id: "both", label: "With deployment" }]} />}>
          <ReliabilityChart series={[
            ...p.candidates.filter((c: any) => c.id !== "prevalence").map((c: any) => ({ name: `${c.label} (validation)`, bins: c.calibration_bins, color: colors[c.id] })),
            ...(cal === "both" && dep ? [{ name: "Frozen model (deployment)", bins: dep.calibration_bins, color: CHART.amber }] : []),
          ]} />
          <p className="text-xs leading-5 text-muted">Points are populated bins only. Sparse upper bins carry few patients and should be read with care.</p>
        </Panel>

        <Panel title="Deployment domain, reported separately" source={dep?.source} aside={<EvidenceChip cls="OBSERVED" small />}>
          {dep ? (<>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <Stat label="AUROC" value={fx(dep.auroc)} sub={`${signed(-dep.auroc_delta)} vs frozen ${fx(dep.auroc_baseline)}`} />
              <Stat label="ECE" value={fx(dep.ece, 4)} sub={`vs ${fx(sel.ece, 4)} at freeze`} />
              <Stat label="Observed rate" value={pct(dep.observed_rate, 1)} sub={`predicted ${pct(dep.mean_predicted, 1)}`} />
            </div>
            <p className="mt-4 text-sm leading-6 text-[#c5cfdf]">Emergency admissions shift the inputs heavily (max PSI {fx(dep.max_psi, 2)} on {dep.worst_feature};
              {" "}{dep.n_features_above_psi} of {dep.n_features_tested} features past the effect-size bound), yet discrimination falls only {fx(dep.auroc_delta, 3)} and ECE moves from
              {" "}{fx(dep.ece_freeze_baseline, 4)} to {fx(dep.ece, 4)}. Drift is not harm — the reason HAVM separates detection from governance.</p>
            <div className="mt-3"><Note>{dep.caveat}</Note></div>
          </>) : <Note>EXP008 results are not available.</Note>}
        </Panel>
      </div>

      <Panel title="Subgroup performance on source validation" className="mt-5" pad={false}
        aside={<Tabs value={attr} onChange={setAttr} options={[{ id: "age", label: "Age" }, { id: "race", label: "Race" }, { id: "gender", label: "Gender" }]} />}>
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Group</th><th>n</th><th>Prevalence</th><th>AUROC</th><th>ECE</th><th>TPR</th><th>FPR</th><th>Precision</th></tr></thead>
          <tbody>{Object.entries(sel.subgroups[attr] ?? {}).map(([g, v]: any) => v.suppressed ? (
            <tr key={g}><td>{g}</td><td className="num">{int(v.n)}</td><td colSpan={6} className="text-xs text-faint">Suppressed: {v.reason.replace(/_/g, " ")} ({p.subgroup_policy.min_group_size})</td></tr>
          ) : (
            <tr key={g}><td>{g}</td><td className="num">{int(v.n)}</td><td className="num">{pct(v.prevalence, 1)}</td><td className="num">{fx(v.auroc)}</td>
              <td className="num">{fx(v.ece, 4)}</td><td className="num">{fx(v.tpr)}</td><td className="num">{fx(v.fpr)}</td><td className="num">{fx(v.precision)}</td></tr>))}</tbody>
        </table></div>
        <div className="flex items-center gap-2 px-5 py-2 text-2xs text-faint">Groups below {p.subgroup_policy.min_group_size} rows are suppressed rather than estimated. <SourceChip source={p.sources.validation} /></div>
      </Panel>
    </>
  );
}

function Cell2({ v, l, c }: { v: number; l: string; c: string }) {
  return <div className="m-0.5 rounded px-2 py-2" style={{ background: `${c}1a` }}>
    <div className="text-2xs" style={{ color: c }}>{l}</div><div className="text-base num">{int(v)}</div></div>;
}
