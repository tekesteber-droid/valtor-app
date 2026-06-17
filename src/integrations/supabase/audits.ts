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
};

export async function fetchAudits(): Promise<AuditRow[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("audits")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as AuditRow[]) || [];
}

export async function insertAudit(audit: Omit<AuditRow, "id" | "created_at">) {
  const { data, error } = await supabase
    .from("audits")
    .insert([audit])
    .select()
    .single();
    
  if (error) throw error;
  return data as AuditRow;
}

export async function deleteAudit(id: string) {
  const { error } = await supabase
    .from("audits")
    .delete()
    .eq("id", id);
    
  if (error) throw error;
  return true;
}

export function useAudits() {
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchAudits();
      setAudits(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();

    // Enable auto-refresh on any DB change
    const channel = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audits' }, () => {
        load();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  return { audits, loading, error, reload: load };
}

export function dispatchAuditsUpdated() {
  window.dispatchEvent(new Event("valtor:audits-updated"));
}