import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { CaseDetail } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { CaseCanvas } from '../components/CaseCanvas';
import { ConfidenceLegend } from '../components/Legend';
import { AppLayout, Breadcrumb } from '../components/Layout';
import { Modal } from '../components/Modal';
import { useToast } from '../components/ToastContext';
import { useObjectUrl } from './hooks';
import { Timeline } from '../components/Timeline';
import { saveBlob } from '../utils/saveFile';

function statusLabel(s: string) { return s === 'approved' ? 'Approved' : s === 'in_review' ? 'In Review' : 'Pending'; }
function statusClass(s: string) { return s === 'approved' ? 'approved' : s === 'in_review' ? 'in-review' : 'pending'; }

export function Segmentation() {
  const { id } = useParams();
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [error, setError] = useState('');
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.42);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showMask, setShowMask] = useState(true);
  const [submitModal, setSubmitModal] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const imageUrl = useObjectUrl(id ? `/cases/${id}/image` : undefined);
  const heatmapUrl = useObjectUrl(id ? `/cases/${id}/heatmap` : undefined);
  const maskUrl = useObjectUrl(id ? `/cases/${id}/mask` : undefined);

  useEffect(() => {
    api.get<CaseDetail>(`/cases/${id}`)
      .then(r => setCaseData(r.data))
      .catch(err => setError(err.response?.data?.detail || 'Unable to load case.'));
  }, [id]);

  async function extractReport() {
    if (!caseData) return;
    setReporting(true);
    try {
      const r = await api.get(`/cases/${caseData.id}/report?report_type=sonologist`, { responseType: 'blob' });
      const filename = `SuperNova_Sonologist_Report_${caseData.patient_name ? caseData.patient_name.replace(/\s+/g, '_') : caseData.id}.pdf`;
      const success = await saveBlob(r.data, filename);
      if (success) {
        toast('success', 'Report downloaded.');
      }
    } catch (err: any) {
      toast('error', err.response?.data?.detail || 'Report export failed.');
    } finally {
      setReporting(false);
    }
  }

  async function submitForReview() {
    if (!caseData) return;
    setSubmitModal(false);
    setSubmitting(true);
    try {
      await api.post(`/cases/${caseData.id}/submit`);
      toast('success', 'Case submitted for Expert Review.');
      setTimeout(() => navigate('/dashboard', { replace: true }), 800);
    } catch (err: any) {
      toast('error', err.response?.data?.detail || 'Submit failed.');
    } finally {
      setSubmitting(false);
    }
  }

  const conf = caseData?.current_result ? Math.round(caseData.current_result.confidence_score * 100) : null;

  return (
    <AppLayout title="Segmentation View">
      <Breadcrumb items={['Dashboard', 'Segmentation']} />
      {error && <div className="inline-error" style={{ marginBottom: 16 }}>{error}</div>}

      {caseData && (
        <div className="segmentation-grid" style={{ gap: 18 }}>
          {/* Left panel: AI Output + Controls + Details */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            
            {/* AI Output Card */}
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ marginBottom: 12 }}>AI Output</h3>
              <p className="text-sm" style={{ marginBottom: 8 }}>Rapid segmentation with pixel-level uncertainty map.</p>
              {conf !== null && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: caseData.current_result?.source === 'expert' ? 0 : 4 }}>
                    <span className="text-sm text-muted">Confidence</span>
                    {caseData.current_result?.source === 'expert' ? (
                      <span className="text-sm fw-600" style={{ color: 'var(--approved)' }}>Expert Verified</span>
                    ) : (
                      <span className="text-sm fw-600">{conf}%</span>
                    )}
                  </div>
                  {caseData.current_result?.source !== 'expert' && (
                    <div className="confidence-bar-wrap">
                      <div className="confidence-bar" style={{ width: `${conf}%`, background: conf >= 75 ? 'var(--approved)' : conf >= 50 ? 'var(--primary)' : 'var(--pending)' }} />
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  ['Lesions', caseData.current_result?.total_lesions ?? '—'],
                  ['Total pixels', caseData.current_result?.total_pixels ?? '—'],
                  ['Format', `${caseData.file_format} · ${caseData.width}×${caseData.height}`],
                  ['Bit depth', `${caseData.bit_depth}-bit`],
                ].map(([k, v]) => (
                  <div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                    <span style={{ fontWeight: 600 }}>{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Heatmap & Binary Mask View Controls Card */}
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ marginBottom: 12 }}>View Controls</h3>
              <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
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
                  <span className="text-xs text-muted">Independent view toggles</span>
                </div>
                
                {showHeatmap && (
                  <div className="heatmap-slider-row" style={{ marginBottom: 10 }}>
                    <label>Opacity: <strong>{Math.round(heatmapOpacity * 100)}%</strong></label>
                    <input type="range" min={0} max={100} value={Math.round(heatmapOpacity * 100)}
                      onChange={e => setHeatmapOpacity(Number(e.target.value) / 100)} style={{ flex: 1 }} />
                  </div>
                )}
                
                <ConfidenceLegend />
              </div>
            </div>

            {/* Status Card */}
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ marginBottom: 8 }}>Status</h3>
              <span className={`status-badge ${statusClass(caseData.status)}`}>{statusLabel(caseData.status)}</span>
              {caseData.patient_name && (
                <div style={{ marginTop: 10, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>{caseData.patient_name}</div>
                  <div>{caseData.patient_id}</div>
                </div>
              )}
            </div>

            {/* Action Stack */}
            <div className="action-stack">
              <button
                className="action-card action-button"
                disabled={submitting || caseData.submitted}
                onClick={() => !caseData.submitted && setSubmitModal(true)}
                id="btn-submit-for-review"
                style={{ background: caseData.submitted ? undefined : 'var(--primary-faint)', borderColor: caseData.submitted ? undefined : 'var(--primary)' }}
              >
                <strong style={{ color: 'var(--primary)' }}>
                  {caseData.submitted ? '✓ Already Submitted' : 'Submit for Expert Review'}
                </strong>
                <span>{caseData.submitted ? 'Case is in review.' : 'Mark as pending and send to reviewer.'}</span>
              </button>
              <button className="action-card action-button" onClick={extractReport} disabled={reporting}>
                <strong>Extract PDF Report</strong>
                <span>{reporting ? 'Preparing…' : 'Download a PDF report of this case.'}</span>
              </button>

              <button className="action-card action-button" onClick={() => navigate('/upload')}>
                <strong>Upload Another</strong>
                <span>Return to the upload form.</span>
              </button>
            </div>

            {/* Timeline */}
            <div className="card" style={{ padding: 16 }}>
              <Timeline caseId={caseData.id} />
            </div>
          </div>

          {/* Right panel: Ultrasound Scan Image Canvas */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ marginBottom: 12 }}>Ultrasound Scan</h3>
              <CaseCanvas
                imageUrl={imageUrl}
                heatmapUrl={heatmapUrl}
                maskUrl={maskUrl}
                contours={caseData.current_result?.contour_json}
                showHeatmap={showHeatmap}
                showMask={showMask}
                heatmapOpacity={heatmapOpacity}
                enableZoom
              />
            </div>
          </div>
        </div>
      )}

      <Modal
        open={submitModal}
        title="Submit for Expert Review?"
        message="Once submitted, the case will be locked for editing by the sonologist and sent to the Expert Reviewer."
        confirmLabel="Submit"
        onConfirm={submitForReview}
        onCancel={() => setSubmitModal(false)}
      />
    </AppLayout>
  );
}
