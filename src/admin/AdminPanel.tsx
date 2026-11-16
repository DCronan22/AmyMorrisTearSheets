import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import type { Firm, Profile, SubscriptionStatus, Tier } from "../types";
import {
  createFirm,
  deleteFirm,
  deleteUser,
  fetchFirms,
  fetchProfiles,
  setProfileFirm,
  setProfileRole,
  updateFirm,
} from "../data/admin";
import { checkoutUrl, portalUrl } from "../data/billing";
import {
  approveFirmRequest,
  declineFirmRequest,
  fetchPendingRequests,
} from "../data/requests";
import type { FirmRequest } from "../data/requests";
import {
  TIERS,
  TIER_LABEL,
  isTier,
  tierDescription,
  tierFit,
  tierForSeats,
} from "../lib/tiers";

const STATUSES: SubscriptionStatus[] = [
  "active",
  "trial",
  "suspended",
  "canceled",
];

interface Props {
  onClose?: () => void; // present when the admin also belongs to a firm
  onSignOut: () => void;
  adminEmail: string;
}

/** Platform owner's control panel: manage firms, access, and users. */
export default function AdminPanel({ onClose, onSignOut, adminEmail }: Props) {
  const confirm = useConfirm();
  const [firms, setFirms] = useState<Firm[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newFirmName, setNewFirmName] = useState("");
  const [addingFirm, setAddingFirm] = useState(false);
  const [addHint, setAddHint] = useState<string | null>(null);
  const firmNameInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requests, setRequests] = useState<FirmRequest[]>([]);
  // Tier chosen per pending request (defaults to the size its emails suggest).
  const [requestTier, setRequestTier] = useState<Record<string, Tier>>({});

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [f, p, r] = await Promise.all([
        fetchFirms(),
        fetchProfiles(),
        fetchPendingRequests(),
      ]);
      setFirms(f);
      setProfiles(p);
      setRequests(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admin data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial data fetch on mount; reload() sets state after async load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  function memberCount(firmId: string) {
    return profiles.filter((p) => p.firm_id === firmId).length;
  }

  /** Runs an admin action, refreshes the tables, and surfaces any failure. */
  async function guard(fn: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      // Also log it: the on-screen message is for the admin, this is for us.
      console.error("Admin action failed:", e);
      setError(e instanceof Error ? e.message : "Action failed.");
      return false;
    }
  }

  /** Make a Checkout link for a firm and put it on the clipboard to send. */
  async function copyPayLink(f: Firm) {
    setError(null);
    setNotice(null);
    if (!f.billing_email) {
      setError(`Add a billing email for ${f.name} first — Stripe sends receipts there.`);
      return;
    }
    if (!isTier(f.tier)) {
      setError(`Pick a plan size for ${f.name} first — it sets the price.`);
      return;
    }
    // An active manual firm is already paid for outside Stripe (e.g. prepaid).
    // New firms start as manual + trial, so they don't get this prompt.
    if (
      f.billing_mode === "manual" &&
      f.subscription_status === "active" &&
      !(await confirm({
        title: "Move to card billing?",
        message: `${f.name} is on manual billing and already active. If this link is paid, ${f.name} moves to monthly Stripe billing and is charged the one-time setup fee. Create the link anyway?`,
        confirmLabel: "Create link",
      }))
    )
      return;
    try {
      const url = await checkoutUrl(f.id);
      await navigator.clipboard.writeText(url);
      setNotice(
        `${TIER_LABEL[f.tier]}-tier payment link for ${f.name} copied — paste it into an email. It expires in 24 hours.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a payment link.");
    }
  }

  async function openPortal(f: Firm) {
    setError(null);
    setNotice(null);
    try {
      window.open(await portalUrl(f.id), "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open billing.");
    }
  }

  return (
    <div className="admin">
      <header className="admin-head">
        <div>
          <h1>Platform admin</h1>
          <p className="muted small">Signed in as {adminEmail}</p>
        </div>
        <div className="admin-head-actions">
          {onClose && (
            <button className="btn ghost" onClick={onClose}>
              ← Back to app
            </button>
          )}
          <button className="btn ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {error && <p className="status-err">{error}</p>}
      {notice && <p className="status-ok">{notice}</p>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {requests.length > 0 && (
            <section className="admin-section">
              <h2>Firm requests ({requests.length})</h2>
              <div className="admin-requests">
                {requests.map((r) => {
                  const tier = requestTier[r.id] ?? tierForSeats(r.member_emails.length);
                  return (
                    <div className="admin-request" key={r.id}>
                      <div className="admin-request-head">
                        <strong>{r.firm_name}</strong>
                        <span className="muted small">
                          from {r.requester_email} ·{" "}
                          {new Date(r.created_at).toLocaleDateString()} ·{" "}
                          {r.member_emails.length}{" "}
                          {r.member_emails.length === 1 ? "account" : "accounts"}
                        </span>
                      </div>
                      <div className="admin-request-emails">
                        {r.member_emails.join(", ")}
                      </div>
                      {r.message && <p className="small">“{r.message}”</p>}
                      <div className="admin-request-actions">
                        <select
                          className="admin-inline"
                          aria-label={`Plan size for ${r.firm_name}`}
                          value={tier}
                          onChange={(e) =>
                            setRequestTier((m) => ({ ...m, [r.id]: e.target.value as Tier }))
                          }
                        >
                          {TIERS.map((t) => (
                            <option key={t} value={t}>
                              {tierDescription(t)}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn primary small"
                          onClick={() => guard(() => approveFirmRequest(r.id, tier))}
                        >
                          Approve
                        </button>
                        <button
                          className="btn ghost small danger"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: "Decline request?",
                                message: `Decline ${r.firm_name}'s request? ${r.requester_email} will see that it wasn't approved.`,
                                confirmLabel: "Decline",
                                danger: true,
                              })
                            )
                              guard(() => declineFirmRequest(r.id));
                          }}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="admin-section">
            <div className="admin-section-head">
              <h2>Firms ({firms.length})</h2>
              <form
                className="admin-add"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (addingFirm) return;
                  const name = newFirmName.trim();
                  // Never fail silently: an empty box used to make this button
                  // look broken, because the handler just returned.
                  if (!name) {
                    setAddHint("Type a firm name here first, then + Add firm.");
                    firmNameInput.current?.focus();
                    return;
                  }
                  setAddHint(null);
                  setAddingFirm(true);
                  try {
                    // Only clear the box on success, so a failed add doesn't
                    // throw away what was typed.
                    if (await guard(() => createFirm(name))) setNewFirmName("");
                  } finally {
                    setAddingFirm(false);
                  }
                }}
              >
                <input
                  ref={firmNameInput}
                  placeholder="New firm name…"
                  value={newFirmName}
                  disabled={addingFirm}
                  onChange={(e) => {
                    setNewFirmName(e.target.value);
                    if (addHint) setAddHint(null);
                  }}
                />
                <button className="btn primary small" disabled={addingFirm}>
                  {addingFirm ? "Adding…" : "+ Add firm"}
                </button>
                {addHint && (
                  <p className="status-err admin-add-hint">{addHint}</p>
                )}
              </form>
            </div>

            {firms.length === 0 ? (
              <p className="muted">No firms yet. Add your first one above.</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Firm</th>
                    <th>Access</th>
                    <th>Renewal date</th>
                    <th>Billing</th>
                    <th>Members</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {firms.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <input
                          className="admin-inline"
                          defaultValue={f.name}
                          onBlur={(e) => {
                            const name = e.target.value.trim();
                            if (name && name !== f.name)
                              guard(() => updateFirm(f.id, { name }));
                          }}
                        />
                      </td>
                      <td>
                        <span
                          className={`badge badge-${f.subscription_status}`}
                        >
                          {f.subscription_status}
                        </span>
                        <select
                          className="admin-inline"
                          value={f.subscription_status}
                          onChange={async (e) => {
                            const next = e.target.value as SubscriptionStatus;
                            if (
                              f.billing_mode === "stripe" &&
                              !(await confirm({
                                title: "Override Stripe?",
                                message: `${f.name} is billed through Stripe, which sets access automatically. A manual change only lasts until Stripe's next update — to stop billing, cancel the subscription in Stripe instead.`,
                                confirmLabel: "Change anyway",
                              }))
                            )
                              return;
                            guard(() =>
                              updateFirm(f.id, { subscription_status: next })
                            );
                          }}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="date"
                          className="admin-inline"
                          defaultValue={f.renewal_date ?? ""}
                          onBlur={(e) =>
                            guard(() =>
                              updateFirm(f.id, {
                                renewal_date: e.target.value || null,
                              })
                            )
                          }
                        />
                      </td>
                      <td className="admin-billing">
                        <div>
                          {f.billing_mode === "stripe" ? (
                            <span className="badge badge-active">
                              Stripe · {f.stripe_status ?? "pending"}
                            </span>
                          ) : (
                            <span className="badge">Manual</span>
                          )}
                          {f.cancel_at_period_end && (
                            <span className="muted small"> cancels at renewal</span>
                          )}
                        </div>
                        <div className="admin-tier">
                          <select
                            className="admin-inline"
                            aria-label={`Plan size for ${f.name}`}
                            value={f.tier ?? ""}
                            onChange={async (e) => {
                              const tier = (e.target.value || null) as Tier | null;
                              if (
                                f.billing_mode === "stripe" &&
                                f.stripe_subscription_id &&
                                !(await confirm({
                                  title: "Change plan size?",
                                  message: `${f.name} already pays through Stripe. Changing the size here doesn't change what Stripe charges — it only sets the price for their next checkout.`,
                                  confirmLabel: "Change size",
                                }))
                              )
                                return;
                              guard(() => updateFirm(f.id, { tier }));
                            }}
                          >
                            <option value="">— plan size —</option>
                            {TIERS.map((t) => (
                              <option key={t} value={t}>
                                {tierDescription(t)}
                              </option>
                            ))}
                          </select>
                          {isTier(f.tier) &&
                            tierFit(f.tier, memberCount(f.id)) === "over" && (
                              <span className="small tier-warn">
                                {memberCount(f.id)} members — over this size
                              </span>
                            )}
                        </div>
                        <input
                          type="email"
                          className="admin-inline"
                          placeholder="Billing email…"
                          defaultValue={f.billing_email}
                          onBlur={(e) => {
                            const billing_email = e.target.value.trim();
                            if (billing_email !== f.billing_email)
                              guard(() => updateFirm(f.id, { billing_email }));
                          }}
                        />
                        <div className="admin-billing-actions">
                          {f.billing_mode === "stripe" && f.stripe_customer_id ? (
                            <button
                              className="btn ghost small"
                              onClick={() => openPortal(f)}
                            >
                              Billing portal ↗
                            </button>
                          ) : (
                            <button
                              className="btn ghost small"
                              onClick={() => copyPayLink(f)}
                            >
                              Copy payment link
                            </button>
                          )}
                        </div>
                      </td>
                      <td>{memberCount(f.id)}</td>
                      <td>
                        <button
                          className="btn ghost small danger"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: "Delete firm?",
                                message: `Delete "${f.name}" and ALL its projects? This cannot be undone.`,
                                confirmLabel: "Delete firm",
                                danger: true,
                              })
                            )
                              guard(() => deleteFirm(f.id));
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="admin-section">
            <h2>Users ({profiles.length})</h2>
            {profiles.length === 0 ? (
              <p className="muted">No users have signed up yet.</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Firm</th>
                    <th>Role</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div>{p.full_name || "—"}</div>
                        <div className="muted small">{p.email}</div>
                      </td>
                      <td>
                        <select
                          className="admin-inline"
                          value={p.firm_id ?? ""}
                          onChange={(e) =>
                            guard(() =>
                              setProfileFirm(p, e.target.value || null)
                            )
                          }
                        >
                          <option value="">— unassigned —</option>
                          {firms.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="admin-inline"
                          value={p.role}
                          onChange={(e) =>
                            guard(() =>
                              setProfileRole(
                                p.id,
                                e.target.value as Profile["role"]
                              )
                            )
                          }
                        >
                          <option value="member">member</option>
                          <option value="platform_admin">platform_admin</option>
                        </select>
                      </td>
                      <td>
                        {p.email.toLowerCase() !== adminEmail.toLowerCase() && (
                          <button
                            className="btn ghost small danger"
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: "Remove user?",
                                  message: `Remove ${p.email || p.full_name}? They will lose all access and be detached from their firm.`,
                                  confirmLabel: "Remove user",
                                  danger: true,
                                })
                              )
                                guard(() => deleteUser(p.id));
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
