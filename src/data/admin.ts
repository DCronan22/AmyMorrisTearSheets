import { supabase } from "../lib/supabase";
import type { Firm, Profile, SubscriptionStatus } from "../types";
import { withSafeStyle } from "../types";

// Platform-admin-only data operations. Every call here is also guarded by RLS
// (is_platform_admin()), so a non-admin calling them would simply get nothing /
// an error — these helpers are a convenience, not the security boundary.

export async function fetchFirms(): Promise<Firm[]> {
  const { data, error } = await supabase
    .from("firms")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  // Same boundary rule as AuthProvider: never hand out an unnormalized style.
  return (data as Firm[]).map((f) => withSafeStyle(f) as Firm);
}

export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as Profile[];
}

export async function createFirm(name: string): Promise<Firm> {
  const { data, error } = await supabase
    .from("firms")
    .insert({ name })
    .select("*")
    .single();
  if (error) throw error;
  return withSafeStyle(data as Firm) as Firm;
}

export interface FirmPatch {
  name?: string;
  subscription_status?: SubscriptionStatus;
  renewal_date?: string | null;
  notes?: string;
}

export async function updateFirm(id: string, patch: FirmPatch): Promise<Firm> {
  const { data, error } = await supabase
    .from("firms")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return withSafeStyle(data as Firm) as Firm;
}

export async function deleteFirm(id: string): Promise<void> {
  const { error } = await supabase.from("firms").delete().eq("id", id);
  if (error) throw error;
}

export async function setProfileFirm(
  profileId: string,
  firmId: string | null
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ firm_id: firmId })
    .eq("id", profileId);
  if (error) throw error;
}

export async function setProfileRole(
  profileId: string,
  role: Profile["role"]
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", profileId);
  if (error) throw error;
}

/** Permanently delete a user account (auth user + profile). Admin only. */
export async function deleteUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_user", { target: userId });
  if (error) throw error;
}
