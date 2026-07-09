import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Loader2, Lock, Mail } from "lucide-react";
import logo from "../assets/logo.png";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        alert("Check your email.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.navigate({ to: "/dashboard" });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#FFFFFF" }}>
      {/* MASSIVE BRAND PANEL */}
      <div className="hidden lg:flex flex-col justify-center items-center w-[600px] bg-[#0F2240] p-20 text-white">
        <div className="w-full space-y-16">
          <img 
            src={logo} 
            alt="BidSwift AI" 
            style={{ 
              width: "100%", 
              maxWidth: "400px", // MASSIVE SCALE
              height: "auto", 
              filter: "brightness(0) invert(1)" 
            }} 
          />
          <div className="space-y-6">
            <h1 className="text-5xl font-black tracking-tighter uppercase leading-[0.9]">PRECISION <br/>INTELLIGENCE.</h1>
            <div className="h-1 w-24 bg-blue-500"></div>
            <p className="text-slate-400 text-sm font-bold uppercase tracking-[0.2em] leading-relaxed max-w-sm">
              Standardizing Bid Risk for Infrastructure Assets.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center bg-[#fcfcfc] p-8">
        <div className="w-full max-w-[360px] space-y-12">
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">System Login</h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Operator Terminal Access</p>
          </div>

          <form onSubmit={submit} className="space-y-6">
            <div className="space-group space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <input type="email" className="field-input pl-12 py-4 border-slate-200" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
            </div>
            <div className="space-group space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Security Key</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <input type="password" className="field-input pl-12 py-4 border-slate-200" value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
            </div>

            {error && <div className="p-4 bg-red-50 text-red-700 text-[10px] font-black uppercase border border-red-100">{error}</div>}

            <button disabled={loading} className="w-full bg-slate-900 text-white py-5 font-black text-xs uppercase tracking-[0.3em] hover:bg-black transition-all flex items-center justify-center gap-3">
              {loading ? <Loader2 className="animate-spin" size={16} /> : <>Initiate Session <ArrowRight size={16}/></>}
            </button>
          </form>
          
          <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="w-full text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-blue-600 transition-colors">
            {mode === "signin" ? "Request Terminal Access" : "Return to Login"}
          </button>
        </div>
      </div>
    </div>
  );
}