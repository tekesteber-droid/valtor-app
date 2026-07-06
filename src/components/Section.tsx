// src/components/Section.tsx
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

type Props = {
  title: string;
  icon: React.ReactNode;
  accent: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export function Section({ title, icon, accent, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`panel shadow-sm border-l-4 ${accent}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-transparent border-none cursor-pointer text-left"
        style={{ padding: "1.125rem 1.25rem" }}
      >
        <h4 className="section-label flex items-center gap-2 m-0">{icon} {title}</h4>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>
      {open && <div style={{ padding: "0 1.25rem 1.25rem" }}>{children}</div>}
    </div>
  );
}