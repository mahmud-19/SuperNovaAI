import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { CaseDetail } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { AppLayout } from '../components/Layout';
import { SkeletonTable } from '../components/Skeleton';
import { formatKSTDate } from '../utils/time';

type SortKey = 'patient_name' | 'created_at' | 'status' | 'confidence';
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 10;

function statusLabel(s: string) { return s === 'approved' ? 'Approved' : s === 'in_review' ? 'In Review' : 'Pending'; }
function statusClass(s: string) { return s === 'approved' ? 'approved' : s === 'in_review' ? 'in-review' : 'pending'; }

function SortIcon({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) {
  if (col !== sortKey) return <span className="sort-icon" />;
  return <span className="sort-icon" style={{ opacity: 1 }}>{dir === 'asc' ? ' ▲' : ' ▼'}</span>;
}

export function Dashboard() {
  const [cases, setCases] = useState<CaseDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<CaseDetail[]>('/cases/mine')
      .then(r => setCases(r.data))
      .catch(err => setError(err.response?.data?.detail || 'Unable to load cases.'))
      .finally(() => setLoading(false));
  }, []);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return cases
      .filter(c => {
        const matchSearch = !q || c.patient_id?.toLowerCase().includes(q) || c.patient_name?.toLowerCase().includes(q);
        const matchStatus = statusFilter === 'all' || c.status === statusFilter;
        return matchSearch && matchStatus;
      })
      .sort((a, b) => {
        let av: any, bv: any;
        if (sortKey === 'patient_name') { av = a.patient_name ?? ''; bv = b.patient_name ?? ''; }
        else if (sortKey === 'created_at') { av = a.created_at; bv = b.created_at; }
        else if (sortKey === 'status') { av = a.status; bv = b.status; }
        else { av = a.current_result?.confidence_score ?? 0; bv = b.current_result?.confidence_score ?? 0; }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp;
        return b.id - a.id;
      });
  }, [cases, search, statusFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const total = cases.length;
  const pending = cases.filter(c => c.status === 'pending').length;
  const inReview = cases.filter(c => c.status === 'in_review').length;
  const approved = cases.filter(c => c.status === 'approved').length;
  const aiCases = cases.filter(c => c.current_result && c.current_result.source !== 'expert');
  const avgConf = aiCases.length > 0
    ? Math.round((aiCases.reduce((s, c) => s + (c.current_result?.confidence_score ?? 0), 0) / aiCases.length) * 100)
    : 0;

  function thClass(key: SortKey) { return `sortable${sortKey === key ? ' sorted sort-' + sortDir : ''}`; }

  return (
    <AppLayout title="My Cases">
      {/* Stat cards */}
      <div className="stat-grid">
        {[
          { label: 'Total Cases', value: total, cls: '' },
          { label: 'Pending', value: pending, cls: 'pending-val' },
          { label: 'In Review', value: inReview, cls: 'in-review-val' },
          { label: 'Approved', value: approved, cls: 'approved-val' },
          { label: 'Avg Confidence', value: `${avgConf}%`, cls: '' },
        ].map(s => (
          <div className="stat-card" key={s.label}>
            <span className="stat-label">{s.label}</span>
            <strong className={`stat-value ${s.cls}`}>{s.value}</strong>
          </div>
        ))}
      </div>

      <div className="card">
        {/* Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="table-toolbar" style={{ flex: 1, margin: 0 }}>
            <div className="search-input">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input
                placeholder="Search by Patient ID or Name…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                aria-label="Search cases"
              />
            </div>
            <select className="filter-select" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} aria-label="Filter by status">
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="in_review">In Review</option>
              <option value="approved">Approved</option>
            </select>
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 12 }} onClick={() => navigate('/upload')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Upload
          </button>
        </div>

        {/* Table */}
        {loading ? (
          <SkeletonTable rows={6} cols={5} />
        ) : error ? (
          <div className="inline-error">{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="🩻"
            title={search || statusFilter !== 'all' ? 'No matching cases' : 'No cases yet'}
            subtitle={search || statusFilter !== 'all' ? 'Try adjusting your search or filter.' : 'Upload your first scan to get started.'}
            action={!search && statusFilter === 'all' ? <button className="btn btn-primary" onClick={() => navigate('/upload')}>+ New Upload</button> : undefined}
          />
        ) : (
          <>
            <table className="data-table" aria-label="Cases list">
              <thead>
                <tr>
                  <th>Patient ID</th>
                  <th className={thClass('patient_name')} onClick={() => toggleSort('patient_name')} tabIndex={0} onKeyDown={e => e.key==='Enter'&&toggleSort('patient_name')}>
                    Patient Name<SortIcon col="patient_name" sortKey={sortKey} dir={sortDir} />
                  </th>
                  <th className={thClass('confidence')} onClick={() => toggleSort('confidence')} tabIndex={0} onKeyDown={e => e.key==='Enter'&&toggleSort('confidence')}>
                    Confidence<SortIcon col="confidence" sortKey={sortKey} dir={sortDir} />
                  </th>
                  <th className={thClass('status')} onClick={() => toggleSort('status')} tabIndex={0} onKeyDown={e => e.key==='Enter'&&toggleSort('status')}>
                    Status<SortIcon col="status" sortKey={sortKey} dir={sortDir} />
                  </th>
                  <th className={thClass('created_at')} onClick={() => toggleSort('created_at')} tabIndex={0} onKeyDown={e => e.key==='Enter'&&toggleSort('created_at')}>
                    Date<SortIcon col="created_at" sortKey={sortKey} dir={sortDir} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(c => (
                  <tr key={c.id} className="clickable" onClick={() => navigate(`/cases/${c.id}/segmentation`)} title="View segmentation">
                    <td><span style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{c.patient_id || '—'}</span></td>
                    <td><span style={{ fontWeight: 600 }}>{c.patient_name || '—'}</span></td>
                    <td>
                      {c.current_result ? (
                        c.current_result.source === 'expert' ? (
                          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--approved)' }}>Expert Verified</span>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="confidence-bar-wrap" style={{ width: 60 }}>
                              <div className="confidence-bar" style={{ width: `${Math.round(c.current_result.confidence_score * 100)}%` }} />
                            </div>
                            <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{Math.round(c.current_result.confidence_score * 100)}%</span>
                          </div>
                        )
                      ) : '—'}
                    </td>
                    <td><span className={`status-badge ${statusClass(c.status)}`}>{statusLabel(c.status)}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                      {formatKSTDate(c.created_at)}
                      <span style={{ fontSize: '0.7rem', display: 'block', color: 'var(--text-faint)' }}>KST</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="pagination">
                <span className="pagination-info">{filtered.length} cases · Page {page} of {totalPages}</span>
                <button className="pagination-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page">‹</button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                  return p <= totalPages ? (
                    <button key={p} className={`pagination-btn ${page === p ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
                  ) : null;
                })}
                <button className="pagination-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)} aria-label="Next page">›</button>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
