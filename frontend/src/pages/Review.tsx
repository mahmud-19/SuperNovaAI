import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { CaseDetail } from '../api/types';
import { CaseCanvas } from '../components/CaseCanvas';
import { ConfidenceLegend } from '../components/Legend';
import { AppLayout, Breadcrumb } from '../components/Layout';
import { useObjectUrl } from './hooks';
import { Timeline } from '../components/Timeline';
import { formatKSTDate } from '../utils/time';

function statusLabel(s: string) { return s === 'approved' ? 'Approved' : s === 'in_review' ? 'In Review' : 'Pending'; }
function statusClass(s: string) { return s === 'approved' ? 'approved' : s === 'in_review' ? 'in-review' : 'pending'; }

export function Review() {
  const { id } = useParams();
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [error, setError] = useState('');
  const imageUrl = useObjectUrl(id ? `/cases/${id}/image` : undefined);
  const heatmapUrl = useObjectUrl(id ? `/cases/${id}/heatmap` : undefined);
  const maskUrl = useObjectUrl(id ? `/cases/${id}/mask` : undefined);

  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showMask, setShowMask] = useState(true);
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.38);
  const [maskOpacity, setMaskOpacity] = useState(0.42);

  useEffect(() => {
    api.get<CaseDetail>(`/cases/${id}`)
      .then(r => setCaseData(r.data))
      .catch(err => setError(err.response?.data?.detail || 'Unable to load review.'));
  }, [id]);

  return (
    <AppLayout title="Expert Review">
      <Breadcrumb items={['Review Dashboard', 'Expert Review']} />
      {error && <div className="inline-error" style={{ marginBottom: 16 }}>{error}</div>}

      {caseData && (
        <div className="triage-grid" style={{ gap: 20 }}>
          {/* Canvas */}
          <div>
            <CaseCanvas
              imageUrl={imageUrl}
              heatmapUrl={heatmapUrl}
              maskUrl={maskUrl}
              contours={caseData.current_result?.contour_json}
              showHeatmap={showHeatmap}
              showMask={showMask}
              heatmapOpacity={heatmapOpacity}
              maskOpacity={maskOpacity}
              enableZoom
            />

            {/* Overlays Control Panel */}
            <div style={{ marginTop: 12, background: 'var(--card-bg, #fff)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '14px 18px', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${showHeatmap ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setShowHeatmap(p => !p)}
                  style={{ background: showHeatmap ? 'var(--primary)' : undefined, color: showHeatmap ? '#fff' : undefined }}
                >
                  Heatmap: {showHeatmap ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${showMask ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setShowMask(p => !p)}
                  style={{ background: showMask ? 'var(--primary)' : undefined, color: showMask ? '#fff' : undefined }}
                >
                  Binary Mask: {showMask ? 'ON' : 'OFF'}
                </button>
                <span className="text-xs text-muted" style={{ marginLeft: 'auto' }}>Independent view toggles</span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="brush-slider-row" style={{ padding: '4px 0' }}>
                  <div className="brush-slider-label" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Heatmap Opacity</span>
                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{Math.round(heatmapOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    className="brush-slider"
                    min={0}
                    max={100}
                    value={Math.round(heatmapOpacity * 100)}
                    onChange={e => setHeatmapOpacity(Number(e.target.value) / 100)}
                    disabled={!showHeatmap}
                    style={{ width: '100%' }}
                  />
                </div>

                <div className="brush-slider-row" style={{ padding: '4px 0', borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                  <div className="brush-slider-label" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Binary Mask Opacity</span>
                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{Math.round(maskOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    className="brush-slider"
                    min={0}
                    max={100}
                    value={Math.round(maskOpacity * 100)}
                    onChange={e => setMaskOpacity(Number(e.target.value) / 100)}
                    disabled={!showMask}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ marginTop: 8 }}><ConfidenceLegend /></div>
          </div>

          {/* Right panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Status */}
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ marginBottom: 8 }}>Status</h3>
              <span className={`status-badge ${statusClass(caseData.status)}`}>{statusLabel(caseData.status)}</span>
            </div>

            {/* Patient details */}
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ marginBottom: 10 }}>Patient Details</h3>
              <table className="patient-details-table">
                <tbody>
                  <tr><td>Patient ID</td><td>{caseData.patient_id || '—'}</td></tr>
                  <tr><td>Name</td><td>{caseData.patient_name || '—'}</td></tr>
                  <tr><td>Age</td><td>{caseData.age ?? '—'}</td></tr>
                  <tr><td>Gender</td><td>{caseData.gender ? caseData.gender.charAt(0).toUpperCase() + caseData.gender.slice(1) : '—'}</td></tr>
                  <tr>
                    <td>Date</td>
                    <td>
                      {formatKSTDate(caseData.exam_date || caseData.created_at)}
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginLeft: 4 }}>KST</span>
                    </td>
                  </tr>
                </tbody>
              </table>

              {caseData.sonologist_note && (
                <div className="note-block" style={{ marginTop: 12 }}>
                  <div className="note-block-label">Sonologist Note</div>
                  <p>{caseData.sonologist_note}</p>
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 16 }}>
              <Timeline caseId={caseData.id} />
            </div>

            {/* Actions */}
            <div className="card" style={{ padding: 16 }}>
              {caseData.status === 'approved' ? (
                <div className="approved-readonly-notice">
                  <strong>✓ Case Approved</strong>
                  <p>This case is finalized and read-only. No further annotation is possible.</p>
                </div>
              ) : (
                <>
                  <div className="warning" style={{ marginBottom: 12 }}>Once finalized, no further edits can be made.</div>
                  <div className="action-stack">
                    <Link className="action-card action-link" to={`/cases/${caseData.id}/outcome`} style={{ display: 'block' }}>
                      <strong>Final Approval</strong>
                      <span>Open the Final Outcome page.</span>
                    </Link>
                    <Link
                      className={`action-card action-link ${caseData.is_finalized ? 'disabled' : ''}`}
                      to={`/cases/${caseData.id}/reannotate`}
                      style={{ display: 'block' }}
                    >
                      <strong>Reannotate</strong>
                      <span>Correct the lesion boundary.</span>
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
