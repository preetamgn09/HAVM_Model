import { useState } from "react";
import { Lock, ShieldCheck, ShieldAlert } from "lucide-react";
import { useApi } from "../lib/useApi";
import { fx, humanize, int, mname, when } from "../lib/format";
import { Collapsible, Empty, ErrorState, EvidenceChip, JsonBlock, KV, Loading, Note, PageHeader, Panel, SourceChip, Tabs } from "../components/ui";

export default function Registry() {
  const { data, error, loading, reload } = useApi<any>("/api/registry");
  const [view, setView] = useState<string>("EXP003");
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const { snapshots, current } = data.data;

  return (
    <>
      <PageHeader title="Assumption Registry"
        lead="The registry is the single source of truth for thresholds, weights, features and provenance; every monitor reads it. Saved snapshots are historical records of what each experiment ran against. The loaded configuration is what the code would use now.">
        <div className="mt-3 flex items-center gap-2 text-xs text-muted"><Lock size={13} />Read-only. Research configurations and snapshots are never edited from this interface; change them in configs/ and re-run the experiments so results and configuration stay paired.</div>
      </PageHeader>

      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {snapshots.map((s: any) => (
          <button key={s.id} onClick={() => setView(s.id)} disabled={!s.available}
            className={`panel px-4 py-3 text-left ${view === s.id ? "border-teal/60 bg-raised" : "hover:bg-raised/50"}`}>
            <div className="flex items-center justify-between"><span className="font-mono text-sm">{s.id}</span><span className="text-xs text-muted">v{s.registry_version}</span></div>
            {s.available ? (<>
              <div className="mt-1 text-xs text-muted">{when(s.effective_date)}</div>
              <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: s.integrity.g3_core_verified ? "#2FB5A3" : "#E2686A" }}>
                {s.integrity.g3_core_verified ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
                {s.integrity.g3_core_verified ? "Stored hash verifies Gate 3 core" : "Hash does not verify"}</div>
              <div className="mt-1 text-2xs text-faint">{s.validation_events} validation event{s.validation_events === 1 ? "" : "s"}</div>
            </>) : <div className="mt-1 text-xs text-faint">Snapshot file missing</div>}
          </button>))}
      </div>

      <div className="mb-5"><Tabs value={view} onChange={setView} options={[...snapshots.filter((s: any) => s.available).map((s: any) => ({ id: s.id, label: `Snapshot ${s.id}` })),
        { id: "current", label: "Loaded configuration" }, { id: "diff", label: "Compare snapshots" }]} /></div>

      {view === "current" ? <Current c={current} /> : view === "diff" ? <Diff ids={snapshots.filter((s: any) => s.available).map((s: any) => s.id)} /> : <Snapshot id={view} />}
    </>
  );
}

function Snapshot({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<any>(`/api/registry/${id}`, [id]);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const r = data.data;
  const src = { file: r.file };
  const cols = Object.entries(r.feature_expectations?.columns ?? {});
  const mc = r.monitor_config;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={`Snapshot ${r.id}, registry v${r.registry_version}`} source={src}>
          <KV mono={["Stored hash", "Full-content hash"]} rows={[
            ["Effective date", when(r.effective_date)], ["Gate (as built)", r.gate], ["Owner", r.owner],
            ["Stored hash", r.integrity.stored_hash], ["Full-content hash", r.integrity.recomputed_full_content_hash],
            ["Sections added later", r.integrity.sections_added_after_g3.join(", ") || "none"],
          ]} />
          <div className="mt-3"><Note tone={r.integrity.g3_core_verified ? "info" : "warn"}>{r.integrity.note}</Note></div>
        </Panel>
        <Panel title="Model metadata">
          <KV mono={["Artefact SHA-256", "Model id"]} rows={[["Model id", r.model.model_id], ["Version", r.model.model_version], ["Algorithm", humanize(r.model.algorithm)],
            ["Frozen", r.model.frozen ? "Yes" : "No"], ["Artefact SHA-256", r.model.artifact_sha256],
            ["Training / deployment", `${r.model.training_domain} / ${r.model.deployment_domain}`], ["Label", `${r.label_definition.name} = ${r.label_definition.source_column} in ${r.label_definition.positive_values.join(", ")}`]]} />
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Dataset provenance">
          <KV mono={["SHA-256 (actual)"]} rows={[["Dataset", `${r.dataset.id}, ${r.dataset.version}`], ["Licence", r.dataset.licence], ["Citation", r.dataset.citation],
            ["SHA-256 (actual)", r.dataset.provenance?.raw?.sha256_actual], ["Checksum match", r.dataset.provenance?.raw?.checksum_match ? "Yes" : "No"],
            ["Status recorded", r.dataset.provenance?.raw?.provenance_status],
            ["Sealed deployment set", r.sealed_deployment_set ? `${int(r.sealed_deployment_set.n_encounters)} encounters, labels inspected at G3: ${r.sealed_deployment_set.labels_inspected_at_gate3 ? "yes" : "no"}` : "—"]]} />
        </Panel>
        <Panel title="Monitored assumptions" aside={<span className="text-xs text-muted">as recorded</span>}>
          <table className="tbl"><thead><tr><th>Assumption</th><th>Status in snapshot</th><th>Gate</th></tr></thead>
            <tbody>{Object.entries(r.monitored_assumptions ?? {}).map(([k, v]: any) => (
              <tr key={k}><td>{humanize(k)}</td><td className="text-xs">{humanize(v.status)} {v.evidence_class && <EvidenceChip cls={v.evidence_class} small />}</td><td>{v.gate}</td></tr>))}</tbody></table>
          <p className="mt-2 text-xs leading-5 text-muted">{r.monitored_assumptions_note}</p>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Thresholds and weights" aside={<EvidenceChip cls="POLICY" small />}>
          {mc ? (<>
            <table className="tbl"><thead><tr><th>Monitor</th><th>Weight</th><th>Entry</th><th>Key thresholds</th></tr></thead>
              <tbody>{Object.entries(mc.ahs.weights).map(([m, w]: any) => {
                const p = mc.monitors[m] ?? {};
                const th = Object.entries(p).filter(([k, v]) => /threshold|alpha/.test(k) && typeof v === "number").map(([k, v]) => `${humanize(k)} ${v}`).join("; ");
                return <tr key={m}><td>{mname(m)}</td><td className="num">{fx(w, 2)}</td><td className="text-xs">{humanize(mc.ahs.entry_mode?.[m] ?? "absolute")}</td><td className="text-xs text-muted">{th || "—"}</td></tr>;
              })}</tbody></table>
            <div className="mt-3 text-xs text-muted">Normalisation: {humanize(mc.normalisation.method)}. Missing monitors: {mc.ahs.missing_monitor_policy}. Governance bands: review {mc.governance.bands.review}, suspension {mc.governance.bands.suspension}; persistence {mc.governance.persistence_windows}.</div>
          </>) : (<>
            <KV rows={Object.entries(r.thresholds ?? {}).map(([k, v]: any) => [humanize(k), String(v)])} />
            <div className="mt-3"><KV rows={Object.entries(r.ahs_weights ?? {}).map(([k, v]: any) => [`Weight ${k}`, String(v)])} /></div>
            <p className="mt-2 text-xs text-muted">This Gate 3 snapshot carries placeholder thresholds only; monitor configuration was attached from Gate 4.</p>
          </>)}
        </Panel>
        <Panel title="Freeze baselines and validation history">
          {r.freeze_baselines ? (
            <KV rows={Object.entries(r.freeze_baselines).map(([k, v]: any) => [mname(k), `${v.metric_key} = ${fx(v.value, 4)} (in-distribution validation)`])} />
          ) : <p className="text-sm text-muted">No freeze baselines in this snapshot.</p>}
          <h3 className="mb-2 mt-4">Validation history</h3>
          {r.validation_history.length ? r.validation_history.map((h: any, i: number) => (
            <div key={i} className="rounded-md border border-hair p-3 text-sm">
              <div className="flex justify-between"><span className="font-medium">{humanize(h.event)}</span><span className="text-xs text-muted">{when(h.timestamp)}</span></div>
              <div className="mt-1 text-xs text-muted">{h.experiment_id}: {h.reason}. Seal hash verified: {String(h.seal_hash_verified)}.</div>
            </div>)) : <p className="text-sm text-muted">No events recorded in this snapshot.</p>}
        </Panel>
      </div>

      <Panel title={`Feature expectations: schema contract (${cols.length} columns, fitted on ${int(r.feature_expectations?.n_rows_fitted_on)} training rows)`} pad={false}>
        <div className="max-h-[420px] overflow-auto"><table className="tbl">
          <thead className="sticky top-0 bg-surface"><tr><th>Column</th><th>Kind</th><th>Expected values</th><th>Missing rate</th></tr></thead>
          <tbody>{cols.map(([k, v]: any) => (
            <tr key={k}><td className="font-mono text-xs">{k}</td><td>{v.kind}</td>
              <td className="text-xs text-muted">{v.kind === "numeric" ? `${v.min} – ${v.max}, mean ${fx(v.mean, 2)}` : `${v.cardinality} categories: ${v.categories.slice(0, 8).join(", ")}${v.categories.length > 8 ? ", …" : ""}`}</td>
              <td className="num">{fx(v.missing_rate, 3)}</td></tr>))}</tbody></table></div>
      </Panel>
      <Collapsible title="Full snapshot JSON"><JsonBlock value={r} max={500} /></Collapsible>
    </div>);
}

function Current({ c }: { c: any }) {
  return (
    <div className="space-y-5">
      <Note>{c.note}</Note>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="configs/monitors.yaml" source={{ file: "configs/monitors.yaml", evidence_class: "POLICY" }}>
          <KV mono={["Config hash"]} rows={[["Config hash", c.monitor_config_hash], ["Weights sum", fx(c.weights_sum, 6)]]} />
          <div className="mt-3"><JsonBlock value={c.monitors_yaml} /></div>
        </Panel>
        <Panel title="configs/d2_diabetes.yaml" source={{ file: "configs/d2_diabetes.yaml" }}>
          <KV mono={["Config hash"]} rows={[["Config hash", c.dataset_config_hash]]} />
          <div className="mt-3"><JsonBlock value={c.dataset_yaml} /></div>
        </Panel>
      </div>
    </div>);
}

function Diff({ ids }: { ids: string[] }) {
  const [a, setA] = useState(ids[0]);
  const [b, setB] = useState(ids[ids.length - 1]);
  const { data, error, loading } = useApi<any>(a && b ? `/api/registry/diff?a=${a}&b=${b}` : null, [a, b]);
  return (
    <Panel title="Compare snapshots" aside={<div className="flex items-center gap-2 text-sm">
      <select className="field" value={a} onChange={(e) => setA(e.target.value)} aria-label="From">{ids.map((i) => <option key={i}>{i}</option>)}</select>
      <span className="text-muted">to</span>
      <select className="field" value={b} onChange={(e) => setB(e.target.value)} aria-label="To">{ids.map((i) => <option key={i}>{i}</option>)}</select></div>}>
      {loading ? <Loading /> : error ? <ErrorState error={error} /> : data.data.n_changes === 0 ? <Empty title="No differences" /> : (<>
        <p className="mb-3 text-sm text-muted">{data.data.n_changes} differing fields (schema contract excluded — it is identical across snapshots).</p>
        <div className="max-h-[520px] overflow-auto"><table className="tbl">
          <thead className="sticky top-0 bg-surface"><tr><th>Field</th><th>Change</th><th>{a}</th><th>{b}</th></tr></thead>
          <tbody>{data.data.changes.map((c: any) => (
            <tr key={c.path}><td className="font-mono text-xs break-all">{c.path}</td><td className="text-xs">{c.kind}</td>
              <td className="max-w-[18rem] break-all font-mono text-2xs text-muted">{JSON.stringify(c.from)}</td>
              <td className="max-w-[18rem] break-all font-mono text-2xs">{JSON.stringify(c.to)}</td></tr>))}</tbody></table></div>
        <div className="mt-2"><SourceChip source={{ file: `results/registry/${a}_registry.json` }} /></div>
      </>)}
    </Panel>);
}
