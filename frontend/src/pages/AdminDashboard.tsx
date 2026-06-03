import { useEffect, useState, useMemo } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/ToastContext';
import { Modal } from '../components/Modal';
import { AppLayout } from '../components/Layout';
import { SkeletonTable } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';

type NonAdminUser = {
  id: number;
  full_name: string;
  username: string;
  email: string;
  role: 'sonologist' | 'expert_reviewer';
  created_at: string;
};

type SortKey = 'full_name' | 'username' | 'email' | 'role' | 'created_at';
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 10;

function SortIcon({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) {
  if (col !== sortKey) return <span className="sort-icon" />;
  return <span className="sort-icon" style={{ opacity: 1 }}>{dir === 'asc' ? ' ▲' : ' ▼'}</span>;
}

export function AdminDashboard() {
  const { toast } = useToast();
  const [users, setUsers] = useState<NonAdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'sonologist' | 'expert_reviewer'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);

  // Add / Edit Modal state
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<NonAdminUser | null>(null);
  const [modalFullName, setModalFullName] = useState('');
  const [modalUsername, setModalUsername] = useState('');
  const [modalEmail, setModalEmail] = useState('');
  const [modalPassword, setModalPassword] = useState('');
  const [modalRole, setModalRole] = useState<'sonologist' | 'expert_reviewer'>('sonologist');
  const [modalErrors, setModalErrors] = useState<Record<string, string>>({});
  const [modalSubmitting, setModalSubmitting] = useState(false);

  // Delete Modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<NonAdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Retraining state
  const [confirmRetrainOpen, setConfirmRetrainOpen] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const [retrainingStatus, setRetrainingStatus] = useState<{
    count: number;
    latest_log: {
      id: string;
      status: 'running' | 'completed' | 'failed';
      model_version_after: string | null;
      dice_after: number | null;
      created_at: string | null;
      completed_at: string | null;
    } | null;
  }>({ count: 0, latest_log: null });

  useEffect(() => {
    fetchUsers();
    fetchRetrainingStatus();
    const interval = setInterval(fetchRetrainingStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleTriggerRetraining() {
    setConfirmRetrainOpen(false);
    setTriggering(true);
    try {
      await api.post('/admin/retrain/trigger');
      toast('success', 'Manual retraining triggered successfully in the background.');
      fetchRetrainingStatus();
    } catch (err: any) {
      toast('error', err.response?.data?.detail || 'Failed to trigger retraining.');
    } finally {
      setTriggering(false);
    }
  }

  function fetchRetrainingStatus() {
    api.get('/admin/retraining/status')
      .then(r => setRetrainingStatus(r.data))
      .catch(() => {});
  }

  function fetchUsers() {
    setLoading(true);
    api.get<NonAdminUser[]>('/admin/users')
      .then(r => setUsers(r.data))
      .catch(err => {
        const msg = err.response?.data?.detail || 'Unable to retrieve users.';
        setError(msg);
        toast('error', msg);
      })
      .finally(() => setLoading(false));
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  }

  const filteredUsers = useMemo(() => {
    return users
      .filter(u => {
        const q = search.toLowerCase();
        const matchesSearch = !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
        const matchesRole = roleFilter === 'all' || u.role === roleFilter;
        return matchesSearch && matchesRole;
      })
      .sort((a, b) => {
        let av: any = a[sortKey] ?? '';
        let bv: any = b[sortKey] ?? '';
        
        if (sortKey === 'role') {
          av = a.role === 'sonologist' ? 'Sonologist' : 'Reviewer';
          bv = b.role === 'sonologist' ? 'Sonologist' : 'Reviewer';
        }
        
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp;
        return b.id - a.id;
      });
  }, [users, search, roleFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const paginatedUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Statistics
  const totalSonologists = users.filter(u => u.role === 'sonologist').length;
  const totalReviewers = users.filter(u => u.role === 'expert_reviewer').length;

  const isFormValid = useMemo(() => {
    if (!modalFullName.trim()) return false;
    if (!modalUsername.trim()) return false;
    if (!modalEmail.trim()) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(modalEmail)) return false;
    if (!editingUser && !modalPassword) return false;
    if (modalPassword && modalPassword.length < 6) return false;
    return true;
  }, [editingUser, modalFullName, modalUsername, modalEmail, modalPassword]);

  function openCreateModal() {
    setEditingUser(null);
    setModalFullName('');
    setModalUsername('');
    setModalEmail('');
    setModalPassword('');
    setModalRole('sonologist');
    setModalErrors({});
    setUserModalOpen(true);
  }

  function openEditModal(u: NonAdminUser) {
    setEditingUser(u);
    setModalFullName(u.full_name);
    setModalUsername(u.username);
    setModalEmail(u.email);
    setModalPassword('');
    setModalRole(u.role);
    setModalErrors({});
    setUserModalOpen(true);
  }

  function openDeleteModal(u: NonAdminUser) {
    setUserToDelete(u);
    setDeleteModalOpen(true);
  }

  async function handleSaveUser(e: React.FormEvent) {
    e.preventDefault();
    setModalErrors({});

    // Validate
    const errs: Record<string, string> = {};
    if (!modalFullName.trim()) errs.full_name = 'Name is required.';
    if (!modalUsername.trim()) errs.username = 'Username is required.';
    if (!modalEmail.trim()) errs.email = 'Email is required.';
    if (!editingUser && !modalPassword) errs.password = 'Password is required.';
    if (modalPassword && modalPassword.length < 6) errs.password = 'Password must be at least 6 characters.';

    if (Object.keys(errs).length > 0) {
      setModalErrors(errs);
      return;
    }

    setModalSubmitting(true);
    try {
      if (editingUser) {
        // Edit User
        const payload = {
          full_name: modalFullName,
          username: modalUsername,
          email: modalEmail,
          role: modalRole,
          ...(modalPassword ? { password: modalPassword } : {})
        };
        await api.put(`/admin/users/${editingUser.id}`, payload);
        toast('success', 'Clinical user account updated successfully.');
      } else {
        // Create User
        const payload = {
          full_name: modalFullName,
          username: modalUsername,
          email: modalEmail,
          password: modalPassword,
          role: modalRole
        };
        await api.post('/admin/users', payload);
        toast('success', 'New clinical user account registered successfully.');
      }
      setUserModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Failed to save user.';
      
      // Inline check for specific unique constraint errors
      const errPayload: Record<string, string> = {};
      if (msg.toLowerCase().includes('email')) {
        errPayload.email = 'Email already exists';
      } else if (msg.toLowerCase().includes('username')) {
        errPayload.username = 'Username already exists';
      } else {
        errPayload.api = msg;
      }
      setModalErrors(errPayload);
      toast('error', msg);
    } finally {
      setModalSubmitting(false);
    }
  }

  async function handleDeleteUser() {
    if (!userToDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/users/${userToDelete.id}`);
      toast('success', 'User account permanently deleted.');
      setDeleteModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast('error', err.response?.data?.detail || 'Failed to delete user.');
    } finally {
      setDeleting(false);
      setUserToDelete(null);
    }
  }

  function thClass(key: SortKey) {
    return `sortable${sortKey === key ? ' sorted sort-' + sortDir : ''}`;
  }

  return (
    <AppLayout title="User Management">
      {/* Stat Cards */}
      <div className="stat-grid">
        {[
          { label: 'Total Sonologists', value: totalSonologists, icon: '🩺', cls: 'pending-val' },
          { label: 'Total Reviewers', value: totalReviewers, icon: '🔬', cls: 'in-review-val' },
          { label: 'Total Accounts', value: users.length, icon: '👤', cls: 'approved-val' }
        ].map(s => (
          <div className="stat-card" key={s.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="stat-label">{s.label}</span>
              <span style={{ fontSize: '1.25rem' }}>{s.icon}</span>
            </div>
            <strong className={`stat-value ${s.cls}`} style={{ marginTop: 8 }}>{s.value}</strong>
          </div>
        ))}
      </div>

      {/* Retraining Progress Widget */}
      <div className="card" style={{ marginBottom: 20, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, color: 'var(--text-muted)' }}>
              Retraining Progress
            </span>
            {retrainingStatus.latest_log?.status === 'running' ? (
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--pending)' }}>
                Retraining in progress…
              </span>
            ) : (
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                {100 - retrainingStatus.count} more needed
              </span>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ fontSize: '1.25rem', color: 'var(--text)' }}>
              {retrainingStatus.count} / 100 corrections
            </strong>
            {retrainingStatus.latest_log?.status === 'completed' && retrainingStatus.latest_log.completed_at && (
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Last Success: {new Date(retrainingStatus.latest_log.completed_at).toLocaleString()} | Avg Dice: {retrainingStatus.latest_log.dice_after}
              </span>
            )}
            {retrainingStatus.latest_log?.status === 'failed' && retrainingStatus.latest_log.completed_at && (
              <span style={{ fontSize: '0.8125rem', color: 'var(--danger)' }}>
                Last Run Failed at {new Date(retrainingStatus.latest_log.completed_at).toLocaleString()}
              </span>
            )}
          </div>
          <div style={{ width: '100%', height: 8, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.min(100, (retrainingStatus.count / 100) * 100)}%`,
                height: '100%',
                backgroundColor: retrainingStatus.latest_log?.status === 'running' ? 'var(--in-review)' : 'var(--pending)',
                borderRadius: 4,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ whiteSpace: 'nowrap' }}
            disabled={retrainingStatus.latest_log?.status === 'running' || triggering}
            onClick={() => setConfirmRetrainOpen(true)}
          >
            {retrainingStatus.latest_log?.status === 'running' ? '⚙️ Retraining Live' : '🚀 Trigger Retraining Now'}
          </button>
        </div>
      </div>

      <div className="card">
        {/* Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div className="table-toolbar" style={{ flex: 1, margin: 0 }}>
            <div className="search-input">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                placeholder="Search by Name, Email, or Username…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                aria-label="Search users"
              />
            </div>
            <select
              className="filter-select"
              value={roleFilter}
              onChange={e => { setRoleFilter(e.target.value as any); setPage(1); }}
              aria-label="Filter by role"
            >
              <option value="all">All Roles</option>
              <option value="sonologist">Sonologists</option>
              <option value="expert_reviewer">Expert Reviewers</option>
            </select>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openCreateModal}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Clinical User
          </button>
        </div>

        {/* Content Table */}
        {loading ? (
          <SkeletonTable rows={PAGE_SIZE} cols={5} />
        ) : error ? (
          <div className="inline-error">{error}</div>
        ) : filteredUsers.length === 0 ? (
          <EmptyState
            icon="👥"
            title={search || roleFilter !== 'all' ? 'No matching accounts' : 'No clinical accounts yet'}
            subtitle={search || roleFilter !== 'all' ? 'Adjust your search query or filters.' : 'Register clinical accounts to grant access.'}
            action={!search && roleFilter === 'all' ? <button className="btn btn-primary" onClick={openCreateModal}>+ Add Clinical User</button> : undefined}
          />
        ) : (
          <>
            <div className="table-responsive" style={{ overflowX: 'auto' }}>
              <table className="data-table" aria-label="Clinical users account list">
                <thead>
                  <tr>
                    <th className={thClass('full_name')} onClick={() => toggleSort('full_name')} tabIndex={0} onKeyDown={e => e.key === 'Enter' && toggleSort('full_name')}>
                      Full Name<SortIcon col="full_name" sortKey={sortKey} dir={sortDir} />
                    </th>
                    <th className={thClass('username')} onClick={() => toggleSort('username')} tabIndex={0} onKeyDown={e => e.key === 'Enter' && toggleSort('username')}>
                      Username<SortIcon col="username" sortKey={sortKey} dir={sortDir} />
                    </th>
                    <th className={thClass('email')} onClick={() => toggleSort('email')} tabIndex={0} onKeyDown={e => e.key === 'Enter' && toggleSort('email')}>
                      Email Address<SortIcon col="email" sortKey={sortKey} dir={sortDir} />
                    </th>
                    <th className={thClass('role')} onClick={() => toggleSort('role')} tabIndex={0} onKeyDown={e => e.key === 'Enter' && toggleSort('role')}>
                      Role<SortIcon col="role" sortKey={sortKey} dir={sortDir} />
                    </th>
                    <th className={thClass('created_at')} onClick={() => toggleSort('created_at')} tabIndex={0} onKeyDown={e => e.key === 'Enter' && toggleSort('created_at')}>
                      Created Date<SortIcon col="created_at" sortKey={sortKey} dir={sortDir} />
                    </th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedUsers.map(u => (
                    <tr key={u.id} className="case-row-fade">
                      <td style={{ fontWeight: 600 }}>{u.full_name}</td>
                      <td>{u.username}</td>
                      <td>{u.email}</td>
                      <td>
                        {u.role === 'sonologist' ? (
                          <span className="status-badge pending" style={{ display: 'inline-flex', padding: '2px 8px', fontWeight: 600 }}>Sonologist</span>
                        ) : (
                          <span className="status-badge in-review" style={{ display: 'inline-flex', padding: '2px 8px', fontWeight: 600 }}>Expert Reviewer</span>
                        )}
                      </td>
                      <td>
                        {new Date(u.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 8 }}>
                          <button
                            className="btn btn-ghost"
                            onClick={() => openEditModal(u)}
                            style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-ghost"
                            onClick={() => openDeleteModal(u)}
                            style={{ padding: '4px 8px', fontSize: '0.8125rem', color: 'var(--danger)', borderColor: 'var(--danger-bdr)' }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="pagination">
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={page === 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  ◀ Previous
                </button>
                <span className="page-info">
                  Page <strong>{page}</strong> of {totalPages}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={page === totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  Next ▶
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Save Modal */}
      {userModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setUserModalOpen(false); }}>
          <div className="modal-card">
            <h2 className="modal-title">
              {editingUser ? 'Edit User Credentials' : 'Add New Clinical User'}
            </h2>
            <p className="modal-message" style={{ fontSize: '0.8125rem' }}>
              {editingUser ? `Updating account details for @${editingUser.username}.` : 'Register a new clinical account to grant clinical portal access.'}
            </p>

            <form className="form-stack" onSubmit={handleSaveUser} autoComplete="off" noValidate>
              <div>
                <label htmlFor="admin-user-fullname">Full Name</label>
                <input
                  id="admin-user-fullname"
                  name="newUserFullName"
                  type="text"
                  value={modalFullName}
                  onChange={e => {
                    const val = e.target.value;
                    setModalFullName(val);
                    if (!val.trim()) {
                      setModalErrors(p => ({ ...p, full_name: 'Name is required.' }));
                    } else {
                      setModalErrors(p => ({ ...p, full_name: '' }));
                    }
                  }}
                  placeholder="Dr. Alexander Light"
                  className={modalErrors.full_name ? 'field-error' : ''}
                  autoComplete="off"
                />
                {modalErrors.full_name && <span className="field-error-msg">{modalErrors.full_name}</span>}
              </div>

              <div>
                <label htmlFor="admin-user-username">Username</label>
                <input
                  id="admin-user-username"
                  name="newUserLogin"
                  type="text"
                  value={modalUsername}
                  onChange={e => {
                    const val = e.target.value;
                    setModalUsername(val);
                    if (!val.trim()) {
                      setModalErrors(p => ({ ...p, username: 'Username is required.' }));
                    } else {
                      setModalErrors(p => ({ ...p, username: '' }));
                    }
                  }}
                  placeholder="alexlight"
                  className={modalErrors.username ? 'field-error' : ''}
                  autoComplete="off"
                />
                {modalErrors.username && <span className="field-error-msg">{modalErrors.username}</span>}
              </div>

              <div>
                <label htmlFor="admin-user-email">Email Address</label>
                <input
                  id="admin-user-email"
                  name="newUserEmail"
                  type="email"
                  value={modalEmail}
                  onChange={e => {
                    const val = e.target.value;
                    setModalEmail(val);
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!val.trim()) {
                      setModalErrors(p => ({ ...p, email: 'Email is required.' }));
                    } else if (!emailRegex.test(val)) {
                      setModalErrors(p => ({ ...p, email: 'Invalid email address.' }));
                    } else {
                      setModalErrors(p => ({ ...p, email: '' }));
                    }
                  }}
                  placeholder="alex.light@supernova.com"
                  className={modalErrors.email ? 'field-error' : ''}
                  autoComplete="off"
                />
                {modalErrors.email && <span className="field-error-msg">{modalErrors.email}</span>}
              </div>

              <div>
                <label htmlFor="admin-user-password">
                  Password {editingUser && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(Optional - leave blank to keep unchanged)</span>}
                </label>
                <input
                  id="admin-user-password"
                  name="newUserPass"
                  type="password"
                  value={modalPassword}
                  onChange={e => {
                    const val = e.target.value;
                    setModalPassword(val);
                    if (!editingUser && !val) {
                      setModalErrors(p => ({ ...p, password: 'Password is required.' }));
                    } else if (val && val.length < 6) {
                      setModalErrors(p => ({ ...p, password: 'Password must be at least 6 characters.' }));
                    } else {
                      setModalErrors(p => ({ ...p, password: '' }));
                    }
                  }}
                  placeholder={editingUser ? '••••••••' : 'Password (min 6 chars)'}
                  className={modalErrors.password ? 'field-error' : ''}
                  autoComplete="new-password"
                />
                {modalErrors.password && <span className="field-error-msg">{modalErrors.password}</span>}
              </div>

              <div>
                <label htmlFor="admin-user-role">Account Role</label>
                <select
                  id="admin-user-role"
                  className="filter-select"
                  value={modalRole}
                  onChange={e => setModalRole(e.target.value as any)}
                  style={{ width: '100%', padding: '10px 12px' }}
                >
                  <option value="sonologist">Sonologist (Upload & Triage)</option>
                  <option value="expert_reviewer">Expert Reviewer (Reannotate & Finalize)</option>
                </select>
              </div>

              {modalErrors.api && <div className="inline-error" style={{ marginTop: 14 }}>{modalErrors.api}</div>}

              <div className="modal-actions" style={{ marginTop: 20 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setUserModalOpen(false)}>Cancel</button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={modalSubmitting || !isFormValid}
                >
                  {modalSubmitting ? 'Saving…' : (editingUser ? 'Save User Account' : 'Create User')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        title="Delete User Account?"
        message={userToDelete ? `Are you sure you want to delete the clinical account for ${userToDelete.full_name}? This account will be permanently and hard-deleted from the database, but all historical cases and uploader records associated with this user will preserve their original name for audits.` : ''}
        confirmLabel={deleting ? 'Deleting…' : 'Delete Account'}
        danger
        onConfirm={handleDeleteUser}
        onCancel={() => setDeleteModalOpen(false)}
      />

      {/* Retraining Confirmation Modal */}
      <Modal
        open={confirmRetrainOpen}
        title="Trigger Manual Retraining?"
        message="This will force-trigger a manual fine-tuning run of all 5 ensemble models using all currently available expert corrections. The application will stay live while retraining executes in the background. Are you sure you want to trigger retraining now?"
        confirmLabel={triggering ? 'Triggering…' : 'Trigger Retraining'}
        onConfirm={handleTriggerRetraining}
        onCancel={() => setConfirmRetrainOpen(false)}
      />
    </AppLayout>
  );
}
