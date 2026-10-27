import { AlertTriangle } from "lucide-react";
import { EvidenceChip, SourceChip } from "../components/ui";

export function FindingCard({ f }: { f: any }) {
  return (
    <article className="panel panel-pad">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xs text-faint">{f.question}</div>
          <h3 className="mt-0.5 text-[0.9375rem] font-semibold leading-6">{f.title}</h3>
        </div>
        <EvidenceChip cls={f.evidence_class} small />
      </div>
      <p className="mt-2 text-sm leading-6 text-[#c5cfdf]">{f.statement}</p>
      {f.integrity_note && (
        <div className="mt-3 flex gap-2 rounded-md border border-[#E2A54344] bg-[#E2A5430d] px-3 py-2 text-xs leading-5 text-[#d9c9a8]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[#E2A543]" />{f.integrity_note.text}
        </div>
      )}
      <div className="mt-3"><SourceChip source={f.source} /></div>
    </article>
  );
}
