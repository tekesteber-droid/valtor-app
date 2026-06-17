import { createFileRoute, useSearch, useRouter } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { insertAudit, dispatchAuditsUpdated } from "@/integrations/supabase/audits";
import { UploadCloud, Sparkles, Loader2, FileText, CheckCircle2, X, AlertCircle } from "lucide-react";

// FIX: Path is ../../ because we are inside _authenticated subfolder
import logo from "../../assets/logo.png";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
});

function AuditPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAudit = async () => {
    if (!projectName || !contractValue) return setError("Project Name and Value required.");
    setError(null);
    setLoading(true);

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `JSON risk audit for: ${projectName}, Value: ${contractValue} ETB.` }] }],
          generationConfig: { response_mime_type: "application/json" }
        })
      });

      const data = await res.json();
      const analysis = JSON.parse(data.candidates[0].content.parts[0].text);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Session expired.");

      await insertAudit({
        user_id: user.id,
        project_name: projectName,
        file_name: file?.name || "Manual Submission",
        contract_value: Number(contractValue),
        target_margin: 15,
        risk_score: analysis.risk_score || 50,
        status: "completed",
        analysis,
        created_at: new Date().toISOString(),
      });

      dispatchAuditsUpdated();
      router.navigate({ to: "/dashboard" });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row gap-12 items-start">
        {/* Left Form */}
        <div className="flex-1 w-full space-y-8">
          <div className="bg-white border border-slate-200 rounded p-8 space-y-8 shadow-sm">
            <div className="form-group">
              <label className="section-label">Operational Identifier</label>
              <input className="field-input" placeholder="Project Name" value={projectName} onChange={e => setProjectName(e.target.value)} />
            </div>

            <div className="form-group">
              <label className="section-label">Source Artifacts</label>
              <input type="file" ref={fileInputRef} onChange={(e) => e.target.files && setFile(e.target.files[0])} className="hidden" />
              <div 
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-all ${file ? 'border-blue-500 bg-blue-50/50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
              >
                {!file ? (
                  <div className="space-y-2">
                    <UploadCloud className="mx-auto text-slate-300" size={32} />
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Select BoQ or RFP Document</p>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="text-blue-600" size={20} />
                    <span className="text-sm font-bold text-slate-900">{file.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded"><X size={16}/></button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="form-group">
                <label className="section-label">Contract Value (ETB)</label>
                <input type="number" className="field-input font-mono" placeholder="0.00" value={contractValue} onChange={e => setContractValue(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="section-label">Target Margin</label>
                <div className="field-input bg-slate-50 text-slate-400 font-bold">15.0%</div>
              </div>
            </div>

            {error && <div className="p-4 bg-red-50 text-red-700 text-[10px] font-black uppercase border border-red-100 flex items-center gap-3"><AlertCircle size={14}/>{error}</div>}

            <button onClick={runAudit} disabled={loading} className="w-full bg-slate-900 text-white py-5 font-black text-xs uppercase tracking-[0.2em] hover:bg-black transition-all flex items-center justify-center gap-3">
              {loading ? <Loader2 className="animate-spin" size={16} /> : <><Sparkles size={16} className="text-blue-400" /> Execute AI Audit</>}
            </button>
          </div>
        </div>

        {/* Right Info Context */}
        <div className="w-full md:w-80 space-y-4">
           <div className="p-6 bg-slate-900 rounded-lg text-white space-y-6">
              <img src={logo} alt="Valtor" style={{ height: "30px", filter: "brightness(0) invert(1)" }} />
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Protocol 01</p>
                  <p className="text-xs font-bold uppercase">BoQ Calibration</p>
                  <p className="text-[10px] text-slate-400 leading-relaxed">Neural analysis of line items against regional market data.</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Protocol 02</p>
                  <p className="text-xs font-bold uppercase">Risk Indexing</p>
                  <p className="text-[10px] text-slate-400 leading-relaxed">Quantifying probability of contractual or logistical slippage.</p>
                </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}