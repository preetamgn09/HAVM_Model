import { ReactNode, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Info, Loader2, RefreshCw } from "lucide-react";
import { EVIDENCE_COLOR, HARM_COLOR, STATE_COLOR, STATE_LABEL, fx } from "../lib/format";

export type Source = { file: string; field?: string; evidence_class?: string; note?: string } | null | undefined;

/* ----------------------------------------------------------------- page scaffolding */
export function PageHeader({ title, lead, actions, children }: {
  title: string; lead?: ReactNode; actions?: ReactNode; children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl">
        <h1>{title}</h1>
        {lead && <p className="mt-1.5 text-sm leading-6 text-muted">{lead}</p>}
        {children}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, aside, children, className = "", pad = true, source }: {
  title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; pad?: boolean; source?: Source;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || aside || source) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hair px-5 py-3">
          {title && <h2>{title}</h2>}
          <div className="flex items-center gap-2">{aside}{source && <SourceChip source={source} />}</div>
        </div>
      )}
      <div className={pad ? "panel-pad" : ""}>{children}</div>
    </section>
  );
}

/* ----------------------------------------------------------------- status & provenance */
export function EvidenceChip({ cls, small }: { cls?: string | null; small?: boolean }) {
  if (!cls) return null;
  const c = EVIDENCE_COLOR[cls] ?? "#7D95C0";
  const label = cls.charAt(0) + cls.slice(1).toLowerCase();
  return (
    <span title={EVIDENCE_HELP[cls] ?? cls}
      className={`inline-flex items-center gap-1.5 rounded-full border ${small ? "px-1.5 text-2xs" : "px-2 py-0.5 text-xs"}`}
      style={{ borderColor: `${c}66`, color: c }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />{label}
    </span>
  );
}

export const EVIDENCE_HELP: Record<string, string> = {
  OBSERVED: "Measured on the retrospective dataset as recorded.",
  INJECTED: "Measured on data deliberately perturbed by a declared procedure. Not clinical harm.",
  SIMULATED: "Generated, not observed: A4 telemetry and every governance decision.",
  POLICY: "A configuration choice of this project, not a validated value.",
};

export function SourceChip({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  if (!source) return null;
  const name = source.file.split("/").pop();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-2xs text-muted hover:text-text">
        <FileText size={11} /> {name}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-md border border-line bg-raised p-3 text-xs shadow-xl">
          <div className="text-muted">Source file</div>
          <div className="font-mono break-all">{source.file}</div>
          {source.field && <><div className="mt-2 text-muted">Field</div><div className="font-mono break-all">{source.field}</div></>}
          {source.evidence_class && <div className="mt-2"><EvidenceChip cls={source.evidence_class} small /></div>}
          {source.note && <p className="mt-2 leading-5 text-muted">{source.note}</p>}
        </div>
      )}
    </div>
  );
}

export function StateBadge({ state, size = "sm" }: { state?: string | null; size?: "sm" | "xs" }) {
  if (!state) return <span className="text-faint">—</span>;
  const c = STATE_COLOR[state] ?? "#7D95C0";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-1.5 ${size === "xs" ? "text-2xs" : "text-xs py-0.5"} whitespace-nowrap`}
      style={{ background: `${c}1f`, color: c }}>
      <span className="h-1.5 w-1.5 rounded-sm" style={{ background: c }} />{STATE_LABEL[state] ?? state}
    </span>
  );
}

export function HarmBadge({ level }: { level?: string | null }) {
  if (!level) return <span className="text-faint">—</span>;
  const c = HARM_COLOR[level] ?? "#7D95C0";
  return <span className="text-xs font-medium" style={{ color: c }}>{level.charAt(0) + level.slice(1).toLowerCase()}</span>;
}

export function MonitorStatus({ status }: { status?: string | null }) {
  const map: Record<string, [string, string]> = {
    triggered: ["Beyond bound", "#E2686A"], within_bound: ["Within bound", "#4E9E8C"],
    not_evaluated: ["Not evaluated", "#5F7190"], unavailable: ["Unavailable", "#5F7190"],
    measured: ["Measured", "#2FB5A3"], simulated: ["Simulated", "#A08EF0"],
  };
  const [label, c] = map[status ?? "unavailable"] ?? [status ?? "—", "#5F7190"];
  return <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: c }}>
    <span className="h-2 w-2 rounded-full" style={{ background: c }} />{label}</span>;
}

/* ----------------------------------------------------------------- numbers */
export function Stat({ label, value, sub, source, tone }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; source?: Source; tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="label">{label}</div>{source && <SourceChip source={source} />}
      </div>
      <div className="mt-1 text-2xl font-medium num" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function KV({ rows, mono = [] as string[] }: { rows: [string, ReactNode][]; mono?: string[] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className={`min-w-0 break-words ${mono.includes(k) ? "font-mono text-xs leading-5" : ""}`}>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/* AHS band strip: the platform's signature element. Scores plotted against the governance bands. */
export function BandStrip({ points, review, suspension, height = 44, highlight, jitter = false }: {
  points: { id: string; ahs: number; color?: string }[]; review: number; suspension: number;
  height?: number; highlight?: string; jitter?: boolean;
}) {
  return (
    <div>
      <div className="relative w-full overflow-hidden rounded" style={{ height }}>
        <div className="absolute inset-y-0 left-0" style={{ width: `${suspension * 100}%`, background: "#E2686A1c" }} />
        <div className="absolute inset-y-0" style={{ left: `${suspension * 100}%`, width: `${(review - suspension) * 100}%`, background: "#E2A5431a" }} />
        <div className="absolute inset-y-0 right-0" style={{ left: `${review * 100}%`, background: "#2FB5A314" }} />
        {[suspension, review].map((b) => (
          <div key={b} className="absolute inset-y-0 w-px bg-line" style={{ left: `${b * 100}%` }} />
        ))}
        {points.map((p, i) => (
          <div key={p.id} title={`${p.id}: AHS ${fx(p.ahs)}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${p.ahs * 100}%`, top: jitter ? `${22 + ((i * 37) % 57)}%` : "50%", width: highlight === p.id ? 12 : 8, height: highlight === p.id ? 12 : 8,
              background: p.color ?? "#E3E9F2", boxShadow: highlight === p.id ? "0 0 0 3px #0C1524, 0 0 0 4px #E3E9F2" : "0 0 0 2px #0C1524" }} />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-2xs text-faint num">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${suspension * 100}%` }}>Suspension band {suspension}</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${review * 100}%` }}>Review band {review}</span>
        <span className="absolute right-0">1.0</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- states */
export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
    <Loader2 size={16} className="animate-spin" />{label}…</div>;
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="panel panel-pad flex items-start gap-3 border-[#E2686A55]" role="alert">
      <AlertTriangle size={18} className="mt-0.5 text-st-abstain" />
      <div className="text-sm">
        <div className="font-medium">This view could not load.</div>
        <div className="mt-0.5 text-muted">{error.message}</div>
        {retry && <button className="btn btn-quiet mt-3" onClick={retry}><RefreshCw size={14} />Try again</button>}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line p-6 text-sm">
    <div className="font-medium">{title}</div>{children && <div className="mt-1 text-muted leading-6">{children}</div>}</div>;
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const c = tone === "warn" ? "#E2A543" : "#5BC6E4";
  return (
    <div className="flex gap-2.5 rounded-md border px-3 py-2.5 text-sm leading-6" style={{ borderColor: `${c}44`, background: `${c}0d` }}>
      {tone === "warn" ? <AlertTriangle size={16} className="mt-1 shrink-0" style={{ color: c }} />
        : <Info size={16} className="mt-1 shrink-0" style={{ color: c }} />}
      <div className="min-w-0 text-[#cdd6e4]">{children}</div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode }[];
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-hair bg-ink p-1" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id}
          className={`tab ${value === o.id ? "tab-on" : ""}`} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Collapsible({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-hair">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-raised" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{title}
      </button>
      {open && <div className="border-t border-hair p-3">{children}</div>}
    </div>
  );
}

export function JsonBlock({ value, max = 420 }: { value: unknown; max?: number }) {
  return (
    <pre className="overflow-auto rounded-md bg-ink p-3 font-mono text-[11.5px] leading-5 text-[#b9c6da]" style={{ maxHeight: max }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function ChartTip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2 text-xs shadow-xl">
      {label !== undefined && <div className="mb-1 font-medium">{label}</div>}
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2 num">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color ?? p.fill }} />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto pl-3">{fmt ? fmt(p.value, p) : typeof p.value === "number" ? fx(p.value) : String(p.value)}</span>
        </div>
      ))}
    </div>
  );
}
