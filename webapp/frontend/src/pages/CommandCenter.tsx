import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, CircleSlash, PlayCircle, ShieldCheck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "../lib/useApi";
import { post } from "../lib/api";
import { CHART, STATE_COLOR, STATE_LABEL, STATES, fx, humanize, int, mname, when } from "../lib/format";
import { BandStrip, ChartTip, ErrorState, EvidenceChip, HarmBadge, KV, Loading, MonitorStatus, Note, PageHeader, Panel, SourceChip, StateBadge, Stat } from "../components/ui";
import { FindingCard } from "./shared";

export default function CommandCenter() {
  const { data, error, loading, reload } = useApi<any>("/api/overview");
  const caps = useApi<any>("/api/replay/capabilities");
  const nav = useNavigate();
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);

  if (loading) return <Loading label="Loading recorded results" />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const o = data.data;
  const c = caps.data?.data;
  const bands = o.bands;
  const ahs = o.ahs;

  async function runDemo() {
    setStarting(true); setStartErr(null);
    try {
      const run = await post<any>("/api/replay", { scenario: "observed_partition", n_windows: 10, seed: 20260819, monitor_set: "four" });
      nav(`/replay/${run.run_id}`);
    } catch (e: any) { setStartErr(e.message); setStarting(false); }
  }

  return (
    <>
      <PageHeader title="Command Center"
        lead={<>Monitoring evidence for a frozen 30-day readmission model, read from the recorded HAVM experiments.
          Every value links to the file it came from. Nothing on this page is a real-time observation.</>}
        actions={<>
          <button className="btn btn-primary" onClick={runDemo} disabled={!c?.can_start || c?.busy || starting}
            title={c?.reason ?? (c?.busy ? "A replay is already running." : "Replays EXP003 on the retrospective dataset")}>
            <PlayCircle size={16} />{starting ? "Starting…" : "Run demo replay"}
          </button>
        </>}>
        {startErr && <div className="mt-3"><Note tone="warn">{startErr}</Note></div>}
      </PageHeader>

      {/* Modes */}
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {o.modes.map((m: any) => (
          <div key={m.id} className={`panel px-4 py-3 ${m.active ? "border-teal/50" : ""}`}>
            <div className="flex items-center gap-2 text-sm font-medium">
              {m.available ? <CheckCircle2 size={15} className={m.active ? "text-teal" : "text-muted"} />
                : <CircleSlash size={15} className="text-faint" />}
              {m.label}
              <span className="ml-auto text-2xs text-muted">{m.active ? "Showing now" : m.available ? "Available" : "Not configured"}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">{m.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        {/* AHS */}
        <Panel title="Assumption Health Score" source={ahs?.source}
          aside={<span className="text-xs text-muted">Recorded {when(ahs?.latest_run_at)}</span>}>
          {ahs ? (<>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Stat label="Mean AHS, observed windows" value={fx(ahs.observed_mean)} sub={`sd ${fx(ahs.observed_sd)}, ${ahs.observed_monitor_count} monitors`} />
              <Stat label="Range" value={<span className="text-xl">{fx(ahs.observed_range[0])}–{fx(ahs.observed_range[1])}</span>} sub={`across ${ahs.n_observed} partitions`} />
              <Stat label="Seven-monitor AHS" value={fx(ahs.seven_monitor_full_domain)} sub="whole deployment domain (EXP008)" />
              <Stat label="Windows evaluated" value={ahs.n_windows_evaluated}
                sub={<>{ahs.n_observed} observed, {ahs.n_injected} injected</>} />
            </div>
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <span>Observed windows W000–W009 against the governance bands</span>
                <EvidenceChip cls="OBSERVED" small />
              </div>
              <BandStrip review={bands.review} suspension={bands.suspension}
                points={ahs.observed_windows.map((w: any) => ({ id: w.window_id, ahs: w.ahs, color: STATE_COLOR[w.states.separated] }))} />
            </div>
            <p className="mt-4 text-xs leading-5 text-muted max-w-[72ch]">{o.ahs_explanation} Windows are a random partition of
              emergency admissions; D2 has no time axis, so their order is not a trajectory. Dot colour shows the separated
              policy’s state.</p>
          </>) : <Note>EXP003 results are not available.</Note>}
        </Panel>

        {/* Model */}
        <Panel title="Monitored model" source={o.model.source}>
          <div className="mb-4 flex items-center gap-2 text-sm">
            <ShieldCheck size={16} className={o.model.artifact_hash_verified ? "text-teal" : "text-st-abstain"} />
            {o.model.artifact_hash_verified ? "Frozen artefact matches its recorded SHA-256" : "Frozen artefact hash could not be verified"}
          </div>
          <KV mono={["Model id", "Artefact hash"]} rows={[
            ["Model id", o.model.model_id],
            ["Version", o.model.model_version],
            ["Algorithm", humanize(o.model.algorithm)],
            ["Frozen", `${o.model.frozen ? "Yes" : "No"}, ${when(o.model.frozen_at, false)}`],
            ["Selected by", o.model.selected_by],
            ["Retraining", o.model.retraining_policy],
            ["Artefact hash", `${o.model.artifact_sha256.slice(0, 20)}…`],
          ]} />
          <div className="mt-4 grid grid-cols-4 gap-3 border-t border-hair pt-4">
            {[["AUROC", "auroc"], ["AUPRC", "auprc"], ["Brier", "brier"], ["ECE", "ece"]].map(([l, k]) => (
              <div key={k}><div className="label">{l}</div><div className="text-lg num">{fx(o.model.validation_metrics[k])}</div></div>
            ))}
          </div>
          <div className="mt-1 text-2xs text-faint">Source-domain validation, n = {int(o.model.validation_metrics.n)}</div>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Monitoring signals" aside={<span className="text-xs text-muted">Full deployment domain, EXP008</span>}>
          <div className="divide-y divide-hair">
            {o.signals.map((s: any) => (
              <Link to={`/monitors/${s.id}`} key={s.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-2.5 hover:bg-raised/40 sm:grid-cols-[1.4fr_1fr_7rem_auto]">
                <div className="min-w-0">
                  <div className="truncate text-sm">{mname(s.id)}</div>
                  <div className="text-2xs text-faint">{s.family === "behaviour" ? "Observes model behaviour" : "Observes inputs"}</div>
                </div>
                <div className="hidden sm:block">
                  <div className="h-1.5 rounded bg-hair">
                    <div className="h-1.5 rounded" style={{ width: `${(s.violation ?? 0) * 100}%`, background: s.violation >= 1 ? "#E2686A" : "#5BC6E4" }} />
                  </div>
                  <div className="mt-1 text-2xs text-faint num">violation {fx(s.violation, 2)}</div>
                </div>
                <div className="hidden sm:block"><EvidenceChip cls={s.evidence_class} small /></div>
                <MonitorStatus status={s.status} />
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Governance state distribution" source={o.governance?.source}
          aside={<span className="text-xs text-muted">Simulated policy, observed windows</span>}>
          {o.governance ? <GovernanceBars g={o.governance.observed} /> : <Note>Not available.</Note>}
          <p className="mt-3 text-xs leading-5 text-muted">Same monitor output, two policies. Separated runs harm triage
            before governance; collapsed maps AHS bands directly to action. These are recommendations recorded for a human,
            not actions.</p>
        </Panel>
      </div>

      <h2 className="mb-3 mt-8">What the research found</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {o.findings.map((f: any) => <FindingCard key={f.id} f={f} />)}
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Recent governance events" aside={<Link to="/audit" className="text-xs text-cyan">Open audit trail</Link>} pad={false}>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Window</th><th>Event</th><th>AHS</th><th>Harm</th><th>Separated policy</th><th>Collapsed policy</th></tr></thead>
              <tbody>
                {o.recent_events.map((r: any) => (
                  <tr key={r.index}>
                    <td className="font-mono text-xs">{r.window_id}</td>
                    <td className="text-xs">{r.event.replace("_", "-")}</td>
                    <td className="num">{fx(r.ahs)}</td>
                    <td><HarmBadge level={r.harm_level} /></td>
                    <td><StateBadge state={r.to_state} size="xs" /></td>
                    <td><StateBadge state={r.collapsed_to_state} size="xs" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-2 text-2xs text-faint">Historical audit records from EXP003. Timestamps are when the experiment script ran.</div>
        </Panel>

        <Panel title="Dataset and evidence provenance" source={o.dataset.source}>
          <KV mono={["SHA-256"]} rows={[
            ["Dataset", "Diabetes 130-US Hospitals, 1999–2008 (UCI #296)"],
            ["Licence", o.dataset.licence],
            ["SHA-256", `${o.dataset.sha256.slice(0, 24)}…`],
            ["Provenance", <span key="p">{o.dataset.provenance_status_config} <span className="text-muted">(EXP001 recorded {o.dataset.provenance_status_at_exp001})</span></span>],
            ["Cohort", `${int(o.dataset.cohort?.rows_in)} → ${int(o.dataset.cohort?.rows_out)} encounters`],
            ["Training domain", `Non-emergency admissions, ${int(o.dataset.domain?.source_encounters)}`],
            ["Deployment domain", `Emergency admissions, ${int(o.dataset.domain?.target_encounters)} (sealed until Gate 5)`],
            ["Split", `By patient; overlap ${o.dataset.split?.patient_overlap_train_validation}`],
            ["Time axis", "None — windows are partitions, not a time series"],
          ]} />
          <p className="mt-3 text-xs leading-5 text-muted">{o.dataset.provenance_note}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">{["OBSERVED", "INJECTED", "SIMULATED", "POLICY"].map((e) => <EvidenceChip key={e} cls={e} small />)}</div>
        </Panel>
      </div>

      <Panel title="Experiments" className="mt-5" pad={false}>
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Experiment</th><th>Gate</th><th>Content</th><th>Generated</th><th>Files</th></tr></thead>
          <tbody>{o.experiments.map((e: any) => (
            <tr key={e.id}><td className="font-mono text-xs">{e.id}</td><td>{e.gate}</td><td>{e.title}</td>
              <td className="whitespace-nowrap text-muted">{when(e.generated_at)}</td>
              <td><div className="flex flex-wrap gap-1">{e.files.map((f: any) => <SourceChip key={f.file} source={{ file: f.file }} />)}</div></td></tr>))}</tbody>
        </table></div>
      </Panel>
    </>
  );
}

function GovernanceBars({ g }: { g: Record<string, Record<string, number>> }) {
  const rows = Object.entries(g).map(([variant, occ]) => ({ variant: variant === "separated" ? "Separated" : "Collapsed", ...occ }));
  return (
    <div>
      <div className="h-[170px]"><ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid horizontal={false} stroke={CHART.grid} />
          <XAxis type="number" domain={[0, 10]} allowDecimals={false} stroke={CHART.axis} />
          <YAxis type="category" dataKey="variant" width={80} stroke={CHART.axis} />
          <Tooltip content={<ChartTip fmt={(v: number) => `${v} windows`} />} cursor={{ fill: "#ffffff08" }} />
          {STATES.map((s) => <Bar key={s} dataKey={s} name={STATE_LABEL[s]} stackId="a" fill={STATE_COLOR[s]} />)}
        </BarChart>
      </ResponsiveContainer></div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted">
        {STATES.map((s) => <span key={s} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: STATE_COLOR[s] }} />{STATE_LABEL[s]}</span>)}
      </div>
    </div>
  );
}

