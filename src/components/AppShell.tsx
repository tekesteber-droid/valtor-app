import { Link, useRouter } from "@tanstack/react-router";
import {
  LayoutGrid,
  FileSearch,
  History,
  LogOut,
  Rss,
  Bell,
  Settings,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { ReactNode } from "react";

// Standard import
import logo from "../assets/logo.png";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { to: "/audit", label: "Bid Audit", icon: FileSearch },
  { to: "/tender-feed", label: "Live Tenders", icon: Rss },
  { to: "/history", label: "History Log", icon: History },
] as const;

export function AppShell({ children, userEmail }: { children: ReactNode; userEmail?: string | null }) {
  const router = useRouter();

  const signOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen flex bg-[#fcfcfc]">
      {/* SIDEBAR - INDUSTRIAL SPEC */}
      <aside
        className="w-[280px] bg-white border-r border-slate-200 fixed inset-y-0 z-40 hidden md:flex flex-col"
      >
        {/* MASSIVE BRAND AREA */}
        <div style={{ padding: "3.5rem 2rem" }} className="border-b border-slate-100 bg-[#FCFCFD]">
          <Link to="/" style={{ display: "block", textDecoration: "none" }}>
            <img 
              src={logo} 
              alt="BidSwift AI" 
              style={{ 
                width: "100%", 
                height: "auto", 
                maxWidth: "220px", // Scaled to fill sidebar width
                display: "block",
                filter: "contrast(1.1) brightness(1.02)", // Match login page clarity
                margin: "0 auto"
              }} 
            />
          </Link>
        </div>

        {/* NAVIGATION */}
        <nav className="flex-1 p-6 space-y-2">
          <div className="text-[10px] font-black text-slate-300 uppercase tracking-[0.25em] mb-6 px-4">
            System Core
          </div>
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeProps={{ className: "bg-slate-900 text-white shadow-xl translate-x-1" }}
              inactiveProps={{ className: "text-slate-500 hover:bg-slate-50" }}
              className="flex items-center gap-4 px-5 py-4 rounded-lg text-[11px] font-black uppercase tracking-[0.15em] no-underline transition-all duration-200"
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>

        {/* SIDEBAR FOOTER */}
        <div className="p-8 border-t border-slate-100 bg-slate-50/50">
          <div className="px-4 mb-6">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">
              Active Operator
            </p>
            <p className="text-[11px] font-bold text-slate-900 truncate">
              {userEmail}
            </p>
          </div>
          <button 
            onClick={signOut} 
            className="flex items-center gap-3 w-full px-4 py-3 text-[11px] font-black uppercase text-red-500 hover:text-red-700 transition-colors bg-transparent border-none cursor-pointer"
          >
            <LogOut size={16} /> Terminate
          </button>
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <div className="flex-1 md:ml-[280px] flex flex-col min-h-screen">
        {/* CLEAN ENGINEERING HEADER */}
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-12 sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
              System Status: <span className="text-emerald-600">Operational</span>
            </div>
          </div>
          
          <div className="flex items-center gap-8">
            <div className="flex gap-4">
              <button className="text-slate-300 hover:text-slate-900 transition-colors"><Bell size={18}/></button>
              <button className="text-slate-300 hover:text-slate-900 transition-colors"><Settings size={18}/></button>
            </div>
            <div className="h-10 w-[1px] bg-slate-200"></div>
            <div className="flex items-center gap-4">
               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest hidden lg:block">Command Center</span>
               <div className="w-10 h-10 bg-slate-900 rounded-full flex items-center justify-center text-[11px] font-black text-white uppercase shadow-lg border-2 border-white">
                {userEmail?.charAt(0) || 'U'}
              </div>
            </div>
          </div>
        </header>

        {/* CONTENT */}
        <main className="p-12 w-full max-w-[1600px] mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}