import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import type { Firm, Profile, SubscriptionStatus } from "../types";
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

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [f, p] = await Promise.all([fetchFirms(), fetchProfiles()]);
      setFirms(f);
      setProfiles(p);
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

  async function guard(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
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
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <section className="admin-section">
            <div className="admin-section-head">
              <h2>Firms ({firms.length})</h2>
              <form
                className="admin-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newFirmName.trim();
                  if (!name) return;
                  guard(() => createFirm(name));
                  setNewFirmName("");
                }}
              >
                <input
                  placeholder="New firm name…"
                  value={newFirmName}
                  onChange={(e) => setNewFirmName(e.target.value)}
                />
                <button className="btn primary small">+ Add firm</button>
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
                          onChange={(e) =>
                            guard(() =>
                              updateFirm(f.id, {
                                subscription_status: e.target
                                  .value as SubscriptionStatus,
                              })
                            )
                          }
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
                              setProfileFirm(p.id, e.target.value || null)
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
