import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, API_BASE_URL } from '../api/client';
import { CaseDetail } from '../api/types';
import { CaseCanvas } from '../components/CaseCanvas';
import { ConfidenceLegend } from '../components/Legend';
import { AppLayout, Breadcrumb } from '../components/Layout';
import { Modal } from '../components/Modal';
import { useToast } from '../components/ToastContext';
import { useObjectUrl } from './hooks';

export function Outcome() {
  const { id } = useParams();
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [approveModal, setApproveModal] = useState(false);
  const [showMask, setShowMask] = useState(true);
  const [maskOpacity, setMaskOpacity] = useState(0.42);
  const navigate = useNavigate();
  const { toast } = useToast();
  const imageUrl = useObjectUrl(id ? `/cases/${id}/image` : undefined);
  const maskUrl = useObjectUrl(id ? `/cases/${id}/mask` : undefined);

  const [ts] = useState(Date.now());
  const token = sessionStorage.getItem('supernova_token') || '';
  const reannotatedImgSrc = id ? `${API_BASE_URL}/cases/${id}/reannotated.png?ts=${ts}&token=${encodeURIComponent(token)}` : '';

  useEffect(() => {
    api.get<CaseDetail>(`/cases/${id}`)
      .then(r => setCaseData(r.data))
      .catch(err => setError(err.response?.data?.detail || 'Unable to load outcome.'));
  }, [id]);

  async function finalize() {
    if (!caseData) return;
    setApproveModal(false);
    setBusy(true);
    setError('');
    try {
      await api.post(`/cases/${caseData.id}/finalize`);
      toast('success', 'Case approved successfully.');
      navigate(`/cases/${caseData.id}/export`);
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Final approval failed.';
      setError(msg);
      toast('error', msg);
    } finally {
      setBusy(false);
    }
  }

  const conf = caseData?.current_result ? Math.round((caseData.current_result.confidence_score ?? 0) * 100) : 0;

  return (
    <AppLayout title="Final Outcome">
      <Breadcrumb items={['Review Dashboard', 'Expert Review', 'Final Outcome']} />
      {error && <div className="inline-error" style={{ marginBottom: 16 }}>{error}</div>}
      {caseData && (
        <>
          {/* Result stat cards */}
          <div className="result-cards">
            {[
              { label: 'Lesions', value: caseData.current_result?.total_lesions ?? 0, sub: 'detected' },
              { label: 'Mask Pixels', value: (caseData.current_result?.total_pixels ?? 0).toLocaleString(), sub: 'segmented' },
              {
                label: caseData.current_result?.source === 'expert' ? 'Confidence' : 'AI Confidence',
                value: caseData.current_result?.source === 'expert' ? 'Expert Verified' : `${conf}%`,
                sub: caseData.current_result?.source === 'expert' ? 'Reviewer approved' : (conf >= 75 ? 'High' : conf >= 50 ? 'Moderate' : 'Low'),
                style: caseData.current_result?.source === 'expert' ? { fontSize: '1.15rem' } : undefined
              },
              { label: 'Resolution', value: `${caseData.width}×${caseData.height}`, sub: `${caseData.file_format} · ${caseData.bit_depth}-bit` },
            ].map(c => (
              <div className="result-card" key={c.label}>
                <div className="result-card-label">{c.label}</div>
                <div className="result-card-value" style={c.style}>{c.value}</div>
                <div className="result-card-sub">{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Confidence bar */}
          <div className="card card-sm" style={{ marginBottom: 20 }}>
            {caseData.current_result?.source === 'expert' ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Clinical Confidence</span>
                <span className="badge badge-approved" style={{ fontSize: '0.8125rem' }}>Expert Verified</span>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>AI Confidence</span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 700 }}>{conf}%</span>
                </div>
                <div className="confidence-bar-wrap">
                  <div className="confidence-bar" style={{
                    width: `${conf}%`,
                    background: conf >= 75 ? 'var(--approved)' : conf >= 50 ? 'var(--primary)' : 'var(--pending)',
                  }} />
                </div>
                <ConfidenceLegend />
              </>
            )}
          </div>

          {/* Interactive Case View */}
          <div className="card" style={{ padding: 16, marginBottom: 20 }}>
            <h3 style={{ marginBottom: 16 }}>Interactive Case View</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, marginBottom: 16 }}>
              {/* Left Side: Segmented Mask Image (Black and White Binary Mask of Expert Annotated Image) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                  ⚫ Segmented Mask (Binary)
                </h4>
                <div className="canvas-frame" style={{ 
                  aspectRatio: '1 / 1', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  background: '#000000', 
                  borderRadius: 'var(--r-md)', 
                  border: '1px solid var(--border)',
                  overflow: 'hidden',
                  maxWidth: '420px',
                  width: '100%',
                  margin: '0 auto'
                }}>
                  {maskUrl ? (
                    <img
                      src={maskUrl}
                      alt="Expert Segmented Mask"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <span style={{ color: 'var(--text-faint)', fontSize: '0.8125rem' }}>Loading mask…</span>
                  )}
                </div>
              </div>

              {/* Middle Side: Reannotated Image (Latest Expert / Current Review) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                  🩺 Expert Reannotated Image
                </h4>
                <div className="canvas-frame" style={{ 
                  aspectRatio: '1 / 1', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  background: '#000000', 
                  borderRadius: 'var(--r-md)', 
                  border: '1px solid var(--border)',
                  overflow: 'hidden',
                  maxWidth: '420px',
                  width: '100%',
                  margin: '0 auto'
                }}>
                  {reannotatedImgSrc ? (
                    <img
                      src={reannotatedImgSrc}
                      alt="Expert Reannotated Image"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <span style={{ color: 'var(--text-faint)', fontSize: '0.8125rem' }}>Loading reannotation…</span>
                  )}
                </div>
              </div>

              {/* Right Side: Binary Mask Overlay */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                  ⚫ Binary Mask Overlay
                </h4>
                <CaseCanvas
                  imageUrl={imageUrl}
                  maskUrl={maskUrl}
                  showMask={showMask}
                  maskOpacity={maskOpacity}
                  enableZoom
                />
              </div>
            </div>
            
            <div style={{ marginTop: 14, background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${showMask ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setShowMask(p => !p)}
                  style={{ background: showMask ? 'var(--primary)' : undefined, color: showMask ? '#fff' : undefined }}
                >
                  Mask: {showMask ? 'ON' : 'OFF'}
                </button>
                <span className="text-xs text-muted">Mask view controls</span>
              </div>
              
              {showMask && (
                <div className="heatmap-slider-row" style={{ marginBottom: 10 }}>
                  <label>Opacity: <strong>{Math.round(maskOpacity * 100)}%</strong></label>
                  <input type="range" min={0} max={100} value={Math.round(maskOpacity * 100)}
                    onChange={e => setMaskOpacity(Number(e.target.value) / 100)} style={{ flex: 1 }} />
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Link
              className={`btn btn-ghost ${caseData.is_finalized ? 'disabled' : ''}`}
              to={`/cases/${caseData.id}/reannotate`}
              style={{ pointerEvents: caseData.is_finalized ? 'none' : undefined, opacity: caseData.is_finalized ? 0.5 : 1 }}
            >
              ← Reannotate
            </Link>
            <button
              className="btn btn-primary"
              disabled={busy || caseData.is_finalized}
              onClick={() => setApproveModal(true)}
              id="btn-final-approval"
            >
              {busy ? 'Approving…' : caseData.is_finalized ? '✓ Already Approved' : 'Final Approval'}
            </button>
          </div>
        </>
      )}

      <Modal
        open={approveModal}
        title="Confirm Final Approval"
        message="Approving this case is irreversible. The case will be marked as approved and locked."
        confirmLabel="Approve Case"
        onConfirm={finalize}
        onCancel={() => setApproveModal(false)}
      />
    </AppLayout>
  );
}
