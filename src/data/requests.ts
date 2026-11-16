import { supabase } from "../lib/supabase";
import type { Tier } from "../types";

// Self-serve onboarding (migration 0012): a signed-in user with no firm asks
// for one; the platform admin approves (choosing the tier) or declines. All
// writes go through security-definer RPCs; RLS lets members read only their
// own requests.

export interface FirmRequest {
  id: string;
  requester_id: string;
  requester_email: string;
  firm_name: string;
  member_emails: string[];
  message: string;
  status: "pending" | "approved" | "declined";
  firm_id: string | null;
  decided_at: string | null;
  created_at: string;
}

const COLS =
  "id,requester_id,requester_email,firm_name,member_emails,message,status,firm_id,decided_at,created_at";

/** The caller's most recent request, if any. */
export async function fetchMyRequest(userId: string): Promise<FirmRequest | null> {
  const { data, error } = await supabase
    .from("firm_requests")
    .select(COLS)
    .eq("requester_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as FirmRequest | null) ?? null;
}

export async function submitFirmRequest(
  firmName: string,
  emails: string[],
  message: string
): Promise<void> {
  const { error } = await supabase.rpc("submit_firm_request", {
    p_firm_name: firmName,
    p_emails: emails,
    p_message: message,
  });
  if (error) throw new Error(error.message);
}

/** Withdraw the caller's own pending request. */
export async function withdrawFirmRequest(id: string): Promise<void> {
  const { error } = await supabase.from("firm_requests").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// --- Platform admin --------------------------------------------------------

export async function fetchPendingRequests(): Promise<FirmRequest[]> {
  const { data, error } = await supabase
    .from("firm_requests")
    .select(COLS)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FirmRequest[];
}

/** Approve a request for `emails` (a subset of its list; the requester is
 *  always included). Those people join the firm once their email is confirmed. */
export async function approveFirmRequest(
  id: string,
  tier: Tier,
  emails: string[],
  firmName?: string
): Promise<string> {
  const { data, error } = await supabase.rpc("admin_approve_firm_request", {
    p_request: id,
    p_tier: tier,
    p_firm_name: firmName ?? null,
    p_emails: emails,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function declineFirmRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc("admin_decline_firm_request", {
    p_request: id,
  });
  if (error) throw new Error(error.message);
}
