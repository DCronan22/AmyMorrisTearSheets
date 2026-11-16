import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import type { BillingInterval, Firm, Profile, SubscriptionStatus, Tier } from "../types";
import {
  createFirm,
  deleteFirm,
  deleteUser,
  fetchApprovedEmails,
  fetchFirms,
  fetchProfiles,
  setFirmEmails,
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
  MAX_LISTED_SEATS,
  TIERS,
  TIER_LABEL,
  isCustomSize,
  isTier,
  tierDescription,
  tierFit,
  tierForSeats,
} from "../lib/tiers";
import EmailRows from "../components/EmailRows";
import { cleanEmails, firstBadEmail } from "../lib/emails";

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
  // Emails the admin UNticked per pending request (everything else is approved).
  const [requestSkip, setRequestSkip] = useState<Record<string, string[]>>({});
  // Approved sign-up emails per firm (firm_approved_emails).
  const [approved, setApproved] = useState<Record<string, string[]>>({});
  // Firm whose email list is open, and the new rows being typed for it.
  const [emailsOpen, setEmailsOpen] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState<string[]>([""]);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [f, p, r, a] = await Promise.all([
        fetchFirms(),
        fetchProfiles(),
        fetchPendingRequests(),
        fetchApprovedEmails(),
      ]);
      setFirms(f);
      setProfiles(p);
      setRequests(r);
      setApproved(a);
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

  /** Accounts a firm is sized for: its members plus approved emails not joined yet. */
  function seatCount(firmId: string) {
    const emails = new Set(approved[firmId] ?? []);
    for (const p of profiles) if (p.firm_id === firmId) emails.add(p.email.trim().toLowerCase());
    return emails.size;
  }

  /** Where an approved email stands: joined, waiting on email confirmation, or not signed up. */
  function emailStatus(firmId: string, email: string): { label: string; cls: string } {
    const p = profiles.find((x) => x.email.trim().toLowerCase() === email);
    if (!p) return { label: "Not signed up yet", cls: "is-waiting" };
    if (p.firm_id === firmId) return { label: "Joined", cls: "is-joined" };
    if (p.firm_id) return { label: "In another firm", cls: "is-problem" };
    return { label: "Signed up, confirming email", cls: "is-waiting" };
  }

  function toggleEmails(firmId: string) {
    setEmailsOpen((cur) => (cur === firmId ? null : firmId));
    setEmailDraft([""]);
  }

  async function addFirmEmails(f: Firm) {
    setNotice(null);
    const bad = firstBadEmail(emailDraft);
    if (bad) {
      setError(`"${bad}" doesn't look like an email address.`);
      return;
    }
    const added = cleanEmails(emailDraft);
    if (!added.length) return;
    const list = [...new Set([...(approved[f.id] ?? []), ...added])];
    if (await guard(() => setFirmEmails(f.id, list))) {
      setEmailDraft([""]);
      setNotice(
        `Approved ${added.length} ${added.length === 1 ? "email" : "emails"} for ${f.name}. They'll join as soon as they sign up and confirm their address.`
      );
    }
  }

  async function removeFirmEmail(f: Firm, email: string) {
    setNotice(null);
    const joined = emailStatus(f.id, email).cls === "is-joined";
    if (
      !(await confirm({
        title: "Remove approved email?",
        message: joined
          ? `${email} is already in ${f.name}. Taking it off the list stops it re-joining later, but doesn't remove them now — do that in the Users table.`
          : `${email} won't be let into ${f.name} automatically any more.`,
        confirmLabel: "Remove",
        danger: true,
      }))
    )
      return;
    await guard(() => setFirmEmails(f.id, (approved[f.id] ?? []).filter((e) => e !== email)));
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
  async function copyPayLink(f: Firm, interval: BillingInterval) {
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
        message: `${f.name} is on manual billing and already active. If this link is paid, ${f.name} moves to ${interval === "year" ? "annual Stripe billing (no setup fee)" : "monthly Stripe billing and is charged the one-time setup fee"}. Create the link anyway?`,
        confirmLabel: "Create link",
      }))
    )
      return;
    try {
      const url = await checkoutUrl(f.id, interval);
      await navigator.clipboard.writeText(url);
      setNotice(
        `${TIER_LABEL[f.tier]}-tier ${interval === "year" ? "annual" : "monthly"} payment link for ${f.name} copied — paste it into an email. It expires in 24 hours, and any earlier link stops working.`
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
                  const skip = requestSkip[r.id] ?? [];
                  const picked = r.member_emails.filter(
                    (e) => e === r.requester_email || !skip.includes(e)
                  );
                  const tier = requestTier[r.id] ?? tierForSeats(picked.length);
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
                      <p className="muted small admin-request-hint">
                        Ticked emails are approved: those people join {r.firm_name}{" "}
                        automatically once they sign up and confirm their address.
                      </p>
                      <ul className="admin-request-emails">
                        {r.member_emails.map((e) => {
                          const isRequester = e === r.requester_email;
                          const on = isRequester || !skip.includes(e);
                          return (
                            <li key={e}>
                              <label className={on ? undefined : "is-off"}>
                                <input
                                  type="checkbox"
                                  checked={on}
                                  disabled={isRequester}
                                  onChange={() =>
                                    setRequestSkip((m) => {
                                      const cur = m[r.id] ?? [];
                                      return {
                                        ...m,
                                        [r.id]: cur.includes(e)
                                          ? cur.filter((x) => x !== e)
                                          : [...cur, e],
                                      };
                                    })
                                  }
                                />
                                <span>{e}</span>
                                {isRequester && (
                                  <span className="muted small">requester, billing contact</span>
                                )}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      {isCustomSize(picked.length) && (
                        <p className="small tier-warn">
                          {picked.length} accounts is over {MAX_LISTED_SEATS}: agree a custom price before approving.
                        </p>
                      )}
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
                          onClick={async () => {
                            setNotice(null);
                            if (await guard(() => approveFirmRequest(r.id, tier, picked))) {
                              setNotice(
                                `Approved ${r.firm_name} (${TIER_LABEL[tier]}) with ${picked.length} ${picked.length === 1 ? "account" : "accounts"}.`
                              );
                            }
                          }}
                        >
                          Approve {picked.length} {picked.length === 1 ? "account" : "accounts"}
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
                    <Fragment key={f.id}>
                    <tr>
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
                              {f.billing_interval && ` · ${f.billing_interval === "year" ? "annual" : "monthly"}`}
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
                            tierFit(f.tier, seatCount(f.id)) === "over" && (
                              <span className="small tier-warn">
                                {seatCount(f.id)} accounts —{" "}
                                {isCustomSize(seatCount(f.id)) ? `over ${MAX_LISTED_SEATS}, custom price` : "over this size"}
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
                            <>
                              <button
                                className="btn ghost small"
                                onClick={() => copyPayLink(f, "month")}
                              >
                                Copy monthly link
                              </button>
                              <button
                                className="btn ghost small"
                                onClick={() => copyPayLink(f, "year")}
                              >
                                Copy annual link
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <div>{memberCount(f.id)}</div>
                        <button
                          className="btn ghost small admin-emails-toggle"
                          aria-expanded={emailsOpen === f.id}
                          onClick={() => toggleEmails(f.id)}
                        >
                          {(approved[f.id] ?? []).length} approved{" "}
                          {(approved[f.id] ?? []).length === 1 ? "email" : "emails"}{" "}
                          {emailsOpen === f.id ? "▴" : "▾"}
                        </button>
                      </td>
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
                    {emailsOpen === f.id && (
                      <tr className="admin-emails-row">
                        <td colSpan={6}>
                          <div className="admin-emails">
                            <p className="muted small">
                              Anyone on this list joins <strong>{f.name}</strong>{" "}
                              automatically once they sign up and confirm their
                              email. No need to assign them one by one.
                            </p>
                            {(approved[f.id] ?? []).length > 0 ? (
                              <ul className="admin-email-list">
                                {(approved[f.id] ?? []).map((e) => {
                                  const st = emailStatus(f.id, e);
                                  return (
                                    <li key={e}>
                                      <span className="admin-email">{e}</span>
                                      <span className={`email-status ${st.cls}`}>{st.label}</span>
                                      <button
                                        className="email-row-remove"
                                        aria-label={`Remove ${e}`}
                                        title="Remove"
                                        onClick={() => removeFirmEmail(f, e)}
                                      >
                                        ×
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="muted small">No approved emails yet.</p>
                            )}
                            <form
                              className="admin-emails-add"
                              noValidate
                              onSubmit={(e) => {
                                e.preventDefault();
                                void addFirmEmails(f);
                              }}
                            >
                              <EmailRows
                                rows={emailDraft}
                                onChange={setEmailDraft}
                                addLabel="+ Add another email"
                              />
                              <button
                                className="btn primary small"
                                disabled={!cleanEmails(emailDraft).length}
                              >
                                Approve{" "}
                                {cleanEmails(emailDraft).length > 1
                                  ? `${cleanEmails(emailDraft).length} emails`
                                  : "email"}
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
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
