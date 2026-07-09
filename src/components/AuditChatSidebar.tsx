import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bot, Loader2, MessageSquareText, SendHorizonal, User, X } from "lucide-react";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  ts: string;
};

export function AuditChatSidebar({ auditId, open, onToggle }: {
  auditId: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Restore persisted history from the audits row (JSONB chat_history column)
  useEffect(() => {
    if (!auditId) return;
    supabase
      .from("audits")
      .select("chat_history")
      .eq("id", auditId)
      .single()
      .then(({ data }) => {
        if (Array.isArray(data?.chat_history)) setMessages(data.chat_history as ChatMessage[]);
      });
  }, [auditId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!auditId) {
      setError("This audit was not saved, so chat is unavailable. Re-run the audit while signed in.");
      return;
    }
    setInput("");
    setError(null);
    setMessages(prev => [...prev, { role: "user", content: text, ts: new Date().toISOString() }]);
    setSending(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Session expired. Please sign in again.");

      const res = await fetch("/api/audit-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ auditId, message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `API Error ${res.status}`);

      // Server returns the full persisted history (source of truth)
      setMessages(Array.isArray(data.chat_history) ? data.chat_history : []);
    } catch (e: any) {
      setError(e.message || "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Floating launcher — only visible while the panel is closed */}
      {!open && (
        <button
          onClick={onToggle}
          className="btn-primary fixed bottom-6 right-6 z-40 shadow-xl"
          style={{ borderRadius: 999, padding: "0.75rem 1.25rem" }}
        >
          <MessageSquareText size={15} /> Ask the Estimator
        </button>
      )}

      {/* Slide-out panel */}
      <aside
        className={`fixed top-0 right-0 h-screen w-[380px] max-w-full z-50 bg-white border-l border-slate-200 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <Bot size={16} className="text-blue-400" />
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest">Estimator Chat</p>
              <p className="text-[9px] text-slate-400 uppercase tracking-widest">Answers from this audit only</p>
            </div>
          </div>
          <button onClick={onToggle} className="text-slate-400 hover:text-white transition-colors bg-transparent border-none cursor-pointer p-1">
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#FAFBFC]">
          {messages.length === 0 && !sending && (
            <div className="empty-state" style={{ padding: "2.5rem 1rem" }}>
              <MessageSquareText size={22} style={{ margin: "0 auto 0.5rem", opacity: 0.25 }} />
              <p className="text-[12px]">
                Ask anything about this audited tender, e.g. "What are the liquidated damages clauses?" or "Which BoQ items have the largest quantities?"
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && (
                <div className="w-6 h-6 rounded-full bg-slate-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot size={12} className="text-blue-400" />
                </div>
              )}
              <div
                className={`max-w-[80%] px-3.5 py-2.5 text-[12px] leading-relaxed rounded-lg whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-slate-900 text-white rounded-br-sm"
                    : "bg-white border border-slate-200 text-slate-700 rounded-bl-sm shadow-sm"
                }`}
              >
                {m.content}
              </div>
              {m.role === "user" && (
                <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <User size={12} className="text-slate-500" />
                </div>
              )}
            </div>
          ))}

          {/* Loading state while the model executes */}
          {sending && (
            <div className="flex gap-2 justify-start">
              <div className="w-6 h-6 rounded-full bg-slate-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot size={12} className="text-blue-400" />
              </div>
              <div className="bg-white border border-slate-200 rounded-lg rounded-bl-sm px-3.5 py-2.5 shadow-sm flex items-center gap-2">
                <Loader2 size={13} className="animate-spin text-slate-400" />
                <span className="text-[11px] text-slate-400">Consulting audit data…</span>
              </div>
            </div>
          )}

          {error && (
            <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-2.5">{error}</div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-200 p-3 bg-white">
          <div className="flex items-end gap-2">
            <textarea
              className="field-input"
              style={{ resize: "none", minHeight: "44px", maxHeight: "120px" }}
              rows={1}
              placeholder="Ask about clauses, risks, or BoQ items…"
              value={input}
              disabled={sending}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="btn-primary"
              style={{ padding: "0.65rem 0.75rem" }}
              title="Send"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <SendHorizonal size={15} />}
            </button>
          </div>
          <p className="text-[9px] text-slate-300 mt-1.5 uppercase tracking-widest font-black">
            Grounded in this audit only · history saved to your workspace
          </p>
        </div>
      </aside>
    </>
  );
}