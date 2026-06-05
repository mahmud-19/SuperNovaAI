import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { CaseDetail } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AppLayout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { useToast } from '../components/ToastContext';
import { formatKSTDate } from '../utils/time';
import { saveBlob } from '../utils/saveFile';

export function Export() {
  const { id } = useParams();
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [logoutModal, setLogoutModal] = useState(false);
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    api.get<CaseDetail>(`/cases/${id}`)
      .then(r => setCaseData(r.data))
      .catch(() => {});
  }, [id]);

  async function download() {
    setDownloading(true);
    try {
      const response = await api.get(`/cases/${id}/report?report_type=reviewer`, { responseType: 'blob' });
      const filename = `SuperNova_Reviewer_Report_${caseData?.patient_name ? caseData.patient_name.replace(/\s+/g, '_') : id}.pdf`;
      const success = await saveBlob(response.data, filename);
      if (success) {
        toast('success', 'Report downloaded successfully.');
      }
    } catch (err: any) {
      toast('error', err.response?.data?.detail || 'Report download failed.');
    } finally {
      setDownloading(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <AppLayout title="Export & Finish">
      <div className="inline-success" style={{ marginBottom: 20 }}>
        ✓ Case approved and finalized. You may now export the results or return to the review dashboard.
      </div>

      {caseData && (
        <div className="card card-sm" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[
              ['Patient', caseData.patient_name || '—'],
              ['Patient ID', caseData.patient_id || '—'],
              ['Exam Date', formatKSTDate(caseData.exam_date || caseData.updated_at) + ' KST'],
              ['Status', 'Approved'],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{k}</div>
                <div style={{ fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 6 }}>Download Final Report</h3>
          <p style={{ marginBottom: 14 }}>Download the comprehensive PDF report containing patient details, ultrasound scan, final mask, uncertainty heatmap, and outcome summary.</p>
          <button className="btn btn-primary" onClick={download} disabled={downloading}>
            {downloading ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                Preparing…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download Final Report
              </>
            )}
          </button>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 6 }}>Return to Dashboard</h3>
          <p style={{ marginBottom: 14 }}>Go back to the Review Dashboard to see other cases.</p>
          <button className="btn btn-secondary" onClick={() => navigate('/review')}>
            ← Review Dashboard
          </button>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 6 }}>Log Out</h3>
          <p style={{ marginBottom: 14 }}>End your session and return to the login screen.</p>
          <button className="btn btn-ghost" onClick={() => setLogoutModal(true)}>
            Log Out
          </button>
        </div>
      </div>

      <Modal
        open={logoutModal}
        title="Log out?"
        message="You will be returned to the login screen."
        confirmLabel="Log out"
        cancelLabel="Stay"
        onConfirm={handleLogout}
        onCancel={() => setLogoutModal(false)}
      />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AppLayout>
  );
}
