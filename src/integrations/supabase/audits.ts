import { useCallback, useEffect, useState } from "react";
import { supabase } from "./client";

export type AuditRow = {
  id: string;
  user_id: string;
  project_name: string;
  file_name: string | null;
  contract_value: number;
  target_margin: number;
  risk_score: number | null;
  status: string;
  analysis: any;
  created_at: string;
  updated_at?: string;
};

export async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) {
    throw new Error("Authenticated user not found.");
  }
  return data.user.id;
}

export async function fetchAudits() {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("audits")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as AuditRow[]) ?? [];
}

export async function insertAudit(audit: Omit<AuditRow, "id" | "updated_at">) {
  const { data, error } = await supabase.from("audits").insert([audit]);
  if (error) throw error;
  return (data as AuditRow[])[0];
}

export async function deleteAudit(id: string) {
  const { data, error } = await supabase.from("audits").delete().eq("id", id);
  if (error) throw error;
  return (data as AuditRow[]) ?? [];
}

export function dispatchAuditsUpdated() {
  window.dispatchEvent(new Event("valtor:audits-updated"));
}

export function useAudits() {
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchAudits();
      setAudits(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const handler = () => void load();
    window.addEventListener("valtor:audits-updated", handler);
    return () => window.removeEventListener("valtor:audits-updated", handler);
  }, [load]);

  return { audits, loading, error, reload: load };
}
