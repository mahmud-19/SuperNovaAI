import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { CaseDetail } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { AppLayout } from '../components/Layout';
import { SkeletonTable } from '../components/Skeleton';
import { useToast } from '../components/ToastContext';
import { formatKSTDate } from '../utils/time';
import { saveBlob } from '../utils/saveFile';

type SortKey = 'patient_name' | 'created_at' | 'status';
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 10;

function statusLabel(s: string) { return s === 'approved' ? 'Approved' : s === 'in_review' ? 'In Review' : 'Pending'; }
function statusClass(s: string) { return s === 'approved' ? 'approved' : s === 'in_review' ? 'in-review' : 'pending'; }

function SortIcon({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) {
  if (col !== sortKey) return <span className="sort-icon" />;
  return <span style={{ opacity: 1, marginLeft: 4, fontSize: '0.65rem' }}>{dir === 'asc' ? '▲' : '▼'}</span>;
}

export function ReviewList() {
  const [cases, setCases] = useState<CaseDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [downloadingIds, setDownloadingIds] = useState<Record<number, boolean>>({});

  useEffect(() => {
    api.get<CaseDetail[]>('/cases')
      .then(r => setCases(r.data))
      .catch(err => setError(err.response?.data?.detail || 'Unable to load cases.'))
      .finally(() => setLoading(false));
  }, []);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  }

  async function downloadReport(caseId: number, patientName?: string | null) {
    setDownloadingIds(prev => ({ ...prev, [caseId]: true }));
    try {
      const response = await api.get(`/cases/${caseId}/report?report_type=reviewer`, { responseType: 'blob' });
      const filename = `SuperNova_Reviewer_Report_${patientName ? patientName.replace(/\s+/g, '_') : caseId}.pdf`;
      const success = await saveBlob(response.data, filename);
      if (success) {
        toast('success', 'Report downloaded successfully.');
      }
    } catch (err: any) {
      toast('error', err.response?.data?.detail || 'Report download failed.');
    } finally {
      setDownloadingIds(prev => ({ ...prev, [caseId]: false }));
    }
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
        else { av = a.status; bv = b.status; }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp;
        return b.id - a.id;
      });
  }, [cases, search, statusFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const inReview = cases.filter(c => c.status === 'in_review').length;
  const approved = cases.filter(c => c.status === 'approved').length;

  function thClass(key: SortKey) { return `sortable${sortKey === key ? ' sorted sort-' + sortDir : ''}`; }

  return (
    <AppLayout title="Review Dashboard">
      {/* Stat cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        {[
          { label: 'Total Cases', value: cases.length, cls: '' },
          { label: 'Awaiting Review', value: inReview, cls: 'in-review-val' },
          { label: 'Approved', value: approved, cls: 'approved-val' },
        ].map(s => (
          <div className="stat-card" key={s.label}>
            <span className="stat-label">{s.label}</span>
            <strong className={`stat-value ${s.cls}`}>{s.value}</strong>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="table-toolbar">
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
            <option value="in_review">In Review</option>
            <option value="approved">Approved</option>
          </select>
        </div>

        {loading ? (
          <SkeletonTable rows={6} cols={5} />
        ) : error ? (
          <div className="inline-error">{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="📋"
            title={search || statusFilter !== 'all' ? 'No matching cases' : 'No cases to review'}
            subtitle={search || statusFilter !== 'all' ? 'Try adjusting your search or filter.' : 'Cases submitted by sonologists will appear here.'}
          />
        ) : (
          <>
            <table className="data-table" aria-label="Review cases list">
              <thead>
                <tr>
                  <th>Patient ID</th>
                  <th className={thClass('patient_name')} onClick={() => toggleSort('patient_name')} tabIndex={0} onKeyDown={e => e.key==='Enter'&&toggleSort('patient_name')}>
                    Patient Name<SortIcon col="patient_name" sortKey={sortKey} dir={sortDir} />
                  </th>
                  <th className={thClass('created_at')} onClick={() => toggleSort('created_at')} tabIndex={0} onKeyDown={e => e.key==='Enter'&&toggleSort('created_at')}>
                    Date<SortIcon col="created_at" sortKey={sortKey} dir={sortDir} />
                  </th>
                  <th className={thClass('status')} onClick={() => toggleSort('status')} tabIndex={0} onKeyDown={e => e.key==='Enter'&&toggleSort('status')}>
                    Status<SortIcon col="status" sortKey={sortKey} dir={sortDir} />
                  </th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(c => (
                  <tr key={c.id}>
                    <td><span style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{c.patient_id || '—'}</span></td>
                    <td><span style={{ fontWeight: 600 }}>{c.patient_name || '—'}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                      {formatKSTDate(c.created_at)}
                      <span style={{ fontSize: '0.7rem', display: 'block', color: 'var(--text-faint)' }}>KST</span>
                    </td>
                    <td><span className={`status-badge ${statusClass(c.status)}`}>{statusLabel(c.status)}</span></td>
                    <td>
                      {c.status === 'in_review' && (
                        <button className="btn btn-primary btn-sm" id={`btn-review-${c.id}`} onClick={() => navigate(`/cases/${c.id}/review`)}>
                          Review
                        </button>
                      )}
                      {c.status === 'approved' && (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-ghost btn-sm" id={`btn-view-${c.id}`} onClick={() => navigate(`/cases/${c.id}/review`)}>
                            View
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            id={`btn-dl-${c.id}`}
                            onClick={(e) => { e.stopPropagation(); downloadReport(c.id, c.patient_name); }}
                            disabled={downloadingIds[c.id]}
                          >
                            {downloadingIds[c.id] ? 'Downloading…' : 'Download Report'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="pagination">
                <span className="pagination-info">{filtered.length} cases · Page {page} of {totalPages}</span>
                <button className="pagination-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                  return p <= totalPages ? (
                    <button key={p} className={`pagination-btn ${page === p ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
                  ) : null;
                })}
                <button className="pagination-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
