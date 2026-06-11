import { supabase } from "../lib/supabase";
import type { Firm, FirmStyle } from "../types";

/**
 * Persist the current user's firm style via the set_firm_style RPC. The RPC
 * enforces that the caller can only write their own firm's `style` column
 * (see migration 0003). Returns the updated firm row.
 */
export async function saveFirmStyle(style: FirmStyle): Promise<Firm> {
  const { data, error } = await supabase.rpc("set_firm_style", {
    new_style: style,
  });
  if (error) throw error;
  return data as Firm;
}
