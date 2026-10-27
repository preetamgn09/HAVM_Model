import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Search, X } from "lucide-react";
import { useApi } from "../lib/useApi";
import { STATE_LABEL, STATES, fx, humanize, mname, when } from "../lib/format";
import { Empty, ErrorState, EvidenceChip, HarmBadge, JsonBlock, KV, Loading, Note, PageHeader, Panel, StateBadge } from "../components/ui";

const PAGE = 25;

export default function Audit() {
  const [params, setParams] = useSearchParams();
  const runs = useApi<any>("/api/replay");
  const [source, setSource] = useState(params.get("source") ?? "EXP003");
  const [q, setQ] = useState("");
  const [qDebounced, setQD] = useState("");
  const [state, setState] = useState("");
  const [event, setEvent] = useState("");
  const [harm, setHarm] = useState("");
  const [evidence, setEvidence] = useState("");
  const [offset, setOffset] = useState(0);
  const openParam = params.get("open");
  const [open, setOpen] = useState<number | null>(openParam !== null ? +openParam : null);

  useEffect(() => { const t = setTimeout(() => setQD(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => setOffset(0), [source, qDebounced, state, event, harm, evidence]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ source });
    if (qDebounced) p.set("q", qDebounced);
    if (state) p.set("state", state);
    if (event) p.set("event", event);
    if (harm) p.set("harm", harm);
    if (evidence) p.set("evidence", evidence);
    return p;
  }, [source, qDebounced, state, event, harm, evidence]);
  const page = useApi<any>(`/api/audit?${query}&offset=${offset}&limit=${PAGE}`, [query.toString(), offset]);
  const exportUrl = (fmt: string) => `/api/audit/export?${query}&format=${fmt}`;
  const runList = (runs.data?.data ?? []).filter((r: any) => r.state === "completed" || r.kind === "historical");

  function inspect(i: number | null) {
    setOpen(i);
    const p = new URLSearchParams(params);
    if (i === null) p.delete("open"); else p.set("open", String(i));
    setParams(p, { replace: true });
  }

  return (
    <>
      <PageHeader title="Audit Trail"
        lead="Append-only records written by havm.governance.AuditTrail, one per monitoring window. Each record is self-contained: an alert can be reconstructed from it without re-running anything. Records hold window-level aggregates only, never patient rows."
        actions={<>
          <a className="btn btn-quiet" href={exportUrl("csv")} download><Download size={14} />CSV</a>
          <a className="btn btn-quiet" href={exportUrl("json")} download><Download size={14} />JSON</a>
        </>} />

      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-hair px-4 py-3">
          <select className="field" value={source} onChange={(e) => { setSource(e.target.value); inspect(null); }} aria-label="Audit source">
            {runList.length ? runList.map((r: any) => <option key={r.run_id} value={r.run_id}>{r.run_id === "EXP003" ? "EXP003 (historical)" : `${r.run_id} (web replay)`}</option>)
              : <option value="EXP003">EXP003 (historical)</option>}
          </select>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-2 text-faint" />
            <input className="field w-56 pl-8" placeholder="Search reasons, monitors…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          <select className="field" value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Event">
            <option value="">All events</option>{["escalation", "de_escalation", "held", "steady"].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}
          </select>
          <select className="field" value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
            <option value="">All states</option>{STATES.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
          </select>
          <select className="field" value={harm} onChange={(e) => setHarm(e.target.value)} aria-label="Harm level">
            <option value="">All harm levels</option>{["NONE", "POTENTIAL", "MEASURED"].map((h) => <option key={h}>{h}</option>)}
          </select>
          <select className="field" value={evidence} onChange={(e) => setEvidence(e.target.value)} aria-label="Window evidence">
            <option value="">Observed and injected</option><option value="OBSERVED">Observed windows</option><option value="INJECTED">Injected windows</option>
          </select>
          {(q || state || event || harm || evidence) && <button className="btn btn-quiet h-8" onClick={() => { setQ(""); setState(""); setEvent(""); setHarm(""); setEvidence(""); }}>Clear filters</button>}
        </div>

        {page.loading && !page.data ? <Loading /> : page.error ? <div className="p-4"><ErrorState error={page.error} retry={page.reload} /></div> : (() => {
          const d = page.data;
          return (<>
            <div className="px-4 py-2 text-xs text-muted">{d.historical ? "Historical audit data from EXP003. Timestamps record when the experiment script ran, not clinical events." : "Audit data from a web replay of the pipeline on retrospective data."}</div>
            {d.rows.length === 0 ? <div className="p-4"><Empty title="No records match these filters">Clear a filter or search for a different term.</Empty></div> : (
              <div className="overflow-x-auto"><table className="tbl">
                <thead><tr><th>#</th><th>Window</th><th>Recorded</th><th>Evidence</th><th>AHS</th><th>Harm</th><th>Event</th><th>Separated: proposed → applied</th><th>Collapsed</th><th>Top monitor</th></tr></thead>
                <tbody>{d.rows.map((r: any) => (
                  <tr key={r.index} className={`cursor-pointer ${open === r.index ? "sel" : ""}`} onClick={() => inspect(r.index)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && inspect(r.index)}>
                    <td className="num text-muted">{r.index}</td><td className="font-mono text-xs">{r.window_id}</td>
                    <td className="whitespace-nowrap text-xs text-muted">{when(r.recorded_at)}</td>
                    <td><EvidenceChip cls={r.window_evidence_class} small /></td><td className="num">{fx(r.ahs)}</td>
                    <td><HarmBadge level={r.harm_level} /></td><td className="text-xs">{humanize(r.event)}</td>
                    <td><div className="flex flex-wrap items-center gap-1"><StateBadge state={r.proposed_state} size="xs" /><span className="text-faint">→</span><StateBadge state={r.to_state} size="xs" /></div></td>
                    <td><StateBadge state={r.collapsed_to_state} size="xs" /></td><td className="text-xs">{mname(r.top_monitor)}</td></tr>))}</tbody></table></div>)}
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-muted">{d.total ? `${d.offset + 1}–${Math.min(d.offset + d.limit, d.total)} of ${d.total}` : "0 records"}</span>
              <div className="flex gap-2">
                <button className="btn btn-quiet" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
                <button className="btn btn-quiet" disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
              </div>
            </div>
          </>);
        })()}
      </Panel>

      {open !== null && <Inspector source={source} index={open} onClose={() => inspect(null)} />}
    </>
  );
}

function Inspector({ source, index, onClose }: { source: string; index: number; onClose: () => void }) {
  const { data, error, loading } = useApi<any>(`/api/audit/${source}/${index}`, [source, index]);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal aria-label="Audit record">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-line bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2>Audit record #{index}</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-text"><X size={18} /></button>
        </div>
        {loading ? <Loading /> : error ? <ErrorState error={error} /> : (() => {
          const r = data.data;
          const sep = r.governance.separated;
          return (<div className="space-y-5">
            <KV mono={["Registry hash", "Config hash", "Model artefact"]} rows={[["Window", `${r.window_id} (${r.window.strategy}, n = ${r.window.n})`], ["Recorded", when(r.timestamp)],
              ["Model", `${r.model_id} ${r.model_version}`], ["Registry", `v${r.registry_version}`], ["Registry hash", r.registry_hash], ["Config hash", r.monitor_config_hash],
              ["Human decision", r.human_decision ?? "None — no human has reviewed alerts in this project"]]} />
            {r.window.caveat && <Note>{r.window.caveat}</Note>}
            <Panel title="Governance decision">
              <div className="flex flex-wrap items-center gap-2"><StateBadge state={sep.from_state} /><span className="text-faint">→</span><StateBadge state={sep.to_state} />
                <span className="text-xs text-muted">(proposed {STATE_LABEL[sep.proposed_state]})</span></div>
              <p className="mt-2 text-sm">{sep.reason}</p>
              <p className="mt-2 text-xs text-muted">Collapsed variant: {STATE_LABEL[r.governance.collapsed.to_state]} — {r.governance.collapsed.reason}</p>
            </Panel>
            <Panel title="Harm assessment"><p className="text-sm leading-6"><HarmBadge level={r.harm_assessment.harm_level} /> — {r.harm_assessment.rationale}</p>
              {r.harm_assessment.discounted_as_noise?.length > 0 && <p className="mt-1 text-xs text-muted">Discounted as noise: {r.harm_assessment.discounted_as_noise.join(", ")}</p>}</Panel>
            <Panel title={`Monitors (AHS ${fx(r.ahs)})`} pad={false}>
              <table className="tbl"><thead><tr><th>Monitor</th><th>Evidence</th><th>Violation</th><th>AHS share</th><th>Bound</th></tr></thead>
                <tbody>{r.monitors.map((m: any) => (
                  <tr key={m.monitor}><td>{mname(m.monitor)}</td><td><EvidenceChip cls={m.evidence_class} small /></td><td className="num">{fx(m.violation)}</td>
                    <td className="num">{fx(r.ahs_components?.[m.monitor])}</td><td className="text-xs" style={{ color: m.triggered ? "#E2686A" : "#4E9E8C" }}>{m.triggered ? "beyond" : "within"}</td></tr>))}</tbody></table>
            </Panel>
            <Panel title="Alert packet">
              <KV rows={[["What happened", r.alert_packet.what_happened], ["Largest contributor", mname(r.alert_packet.metric_that_triggered)],
                ["Investigation", r.alert_packet.recommended_investigation], ["Affected population", r.alert_packet.affected_population ?? "—"]]} />
              <p className="mt-2 text-xs text-muted">Investigation text is generated from the harm level by havm.triage. It concerns the model, never patient treatment.</p>
            </Panel>
            <div>
              <div className="label mb-2">Original record</div>
              <JsonBlock value={r} max={360} />
            </div>
          </div>);
        })()}
      </aside>
    </div>
  );
}
