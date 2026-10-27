import { ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Activity, BookOpenCheck, ClipboardList, FlaskConical, Gauge, Landmark, LineChart, Menu, PlayCircle, Scale, X } from "lucide-react";
import { useApi } from "../lib/useApi";
import { when } from "../lib/format";

const NAV: { group: string; items: { to: string; label: string; icon: any }[] }[] = [
  { group: "Observe", items: [
    { to: "/", label: "Command Center", icon: Gauge },
    { to: "/monitors", label: "Monitor Explorer", icon: Activity },
    { to: "/performance", label: "Model Performance", icon: LineChart },
  ]},
  { group: "Research", items: [
    { to: "/evidence", label: "Evidence Lab", icon: FlaskConical },
    { to: "/replay", label: "Replay Lab", icon: PlayCircle },
  ]},
  { group: "Govern", items: [
    { to: "/governance", label: "Governance", icon: Scale },
    { to: "/registry", label: "Assumption Registry", icon: BookOpenCheck },
    { to: "/audit", label: "Audit Trail", icon: ClipboardList },
  ]},
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden><rect width="32" height="32" rx="7" fill="#182840" />
        <path d="M5 20h5l3-9 4 13 3-8h7" fill="none" stroke="#2FB5A3" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">HAVM</div>
        <div className="text-2xs text-muted">Clinical AI Observability</div>
      </div>
    </div>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-5 px-2 pb-4" aria-label="Main">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="px-2 pb-1.5 text-2xs text-faint">{g.group}</div>
          {g.items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} onClick={onNavigate}
              className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${isActive
                ? "bg-raised text-text shadow-[inset_2px_0_0_#2FB5A3]" : "text-muted hover:bg-raised/60 hover:text-text"}`}>
              <Icon size={16} strokeWidth={1.75} />{label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { data } = useApi<any>("/api/experiments");
  const stamps: string[] = (data?.data ?? []).map((e: any) => e.generated_at).filter(Boolean).sort();
  const latest = stamps[stamps.length - 1];
  const loc = useLocation();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_1fr]">
      <aside className="hidden border-r border-hair bg-[#0E182A] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <Brand />
        <Nav />
        <div className="border-t border-hair px-4 py-3 text-2xs leading-4 text-faint">
          Research prototype on retrospective public data. Not clinically validated.
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal>
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-hair bg-[#0E182A]">
            <div className="flex items-center justify-between pr-3"><Brand />
              <button aria-label="Close menu" onClick={() => setOpen(false)} className="text-muted"><X size={18} /></button></div>
            <Nav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-hair bg-ink/90 px-4 backdrop-blur lg:px-8">
          <button className="text-muted lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={20} /></button>
          <div className="flex items-center gap-2 text-sm">
            <Landmark size={15} className="text-teal" />
            <span className="font-medium">{loc.pathname.startsWith("/replay") ? "Replay and demo" : "Historical results"}</span>
            <span className="hidden text-muted sm:inline">
              {loc.pathname.startsWith("/replay") ? "pipeline replays on retrospective data" : `results generated up to ${when(latest, false)}`}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden rounded-full border border-[#E2A54355] px-2.5 py-0.5 text-xs text-[#E2A543] md:inline"
              title="Retrospective public EHR data, injected perturbations and a simulated governance policy. No live patient data and no clinical actions.">
              Research prototype, no live patient data
            </span>
            <a href="/api/docs" className="btn btn-quiet h-7 text-xs" target="_blank" rel="noreferrer">API docs</a>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
