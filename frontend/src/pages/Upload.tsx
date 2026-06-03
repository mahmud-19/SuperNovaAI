import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { CaseDetail } from '../api/types';
import { DropZone } from '../components/DropZone';
import { AppLayout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { useToast } from '../components/ToastContext';

export function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  function handleFile(selected: File) {
    if (!['image/png', 'image/jpeg'].includes(selected.type)) {
      toast('error', 'Only PNG or JPEG files are accepted.');
      return;
    }
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setErrors(e => ({ ...e, file: '' }));
  }

  function getValidationError(field: string, value: any) {
    if (field === 'file') return value ? '' : 'Ultrasound image is required.';
    if (field === 'patientId') return value.trim() ? '' : 'Patient ID is required.';
    if (field === 'patientName') return value.trim() ? '' : 'Patient name is required.';
    if (field === 'age') return value.trim() ? '' : 'Age is required.';
    if (field === 'gender') return value ? '' : 'Gender is required.';
    return '';
  }

  const isFormValid = !!file &&
    !!patientId.trim() &&
    !!patientName.trim() &&
    !!age.trim() &&
    !!gender &&
    !Object.values(errors).some(err => !!err);

  function validate() {
    const e: Record<string, string> = {};
    if (!file) e.file = 'Ultrasound image is required.';
    if (!patientId.trim()) e.patientId = 'Patient ID is required.';
    if (!patientName.trim()) e.patientName = 'Patient name is required.';
    if (!age.trim()) e.age = 'Age is required.';
    if (!gender) e.gender = 'Gender is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function runInference() {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file!);
      form.append('patient_id', `PT-${patientId}`);
      form.append('patient_name', patientName);
      if (age) form.append('age', age);
      if (gender) form.append('gender', gender);
      if (note) form.append('sonologist_note', note);

      const uploadResp = await api.post<CaseDetail>('/cases/upload', form);
      const uploaded = uploadResp.data;
      toast('info', 'Image uploaded. Running AI inference…');
      await api.post(`/cases/${uploaded.id}/infer`);
      toast('success', 'AI inference complete. Reviewing results.');
      navigate(`/cases/${uploaded.id}/segmentation`);
    } catch (err: any) {
      const errMsg = err.response?.data?.detail || 'Upload or inference failed.';
      if (errMsg.includes('Patient ID already exists')) {
        setErrors(prev => ({ ...prev, patientId: 'This Patient ID already exists.' }));
        toast('error', 'This Patient ID already exists.');
      } else {
        toast('error', errMsg);
      }
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setConfirmOpen(true);
  }

  return (
    <AppLayout title="New Upload">
      <div className="upload-grid">
        <div className="card">
          <form onSubmit={handleSubmit} noValidate>
            {/* Image section */}
            <div className="form-section">
              <p className="form-section-title">Ultrasound Image</p>
              <DropZone onFile={handleFile} uploading={busy} previewUrl={previewUrl ?? undefined} />
              {errors.file && <span className="field-error-msg">{errors.file}</span>}
            </div>

            {/* Patient info section */}
            <div className="form-section">
              <p className="form-section-title">Patient Information</p>
              <div className="form-stack">
                <div>
                  <label htmlFor="upload-patient-id">Patient ID</label>
                  <div className="input-group">
                    <span className="input-addon">PT-</span>
                    <input
                      id="upload-patient-id"
                      placeholder="00123"
                      value={patientId}
                      onChange={e => {
                        const val = e.target.value;
                        setPatientId(val);
                        setErrors(p => ({ ...p, patientId: getValidationError('patientId', val) }));
                      }}
                      className={errors.patientId ? 'field-error' : ''}
                      aria-describedby={errors.patientId ? 'pid-error' : undefined}
                    />
                  </div>
                  {errors.patientId && <span id="pid-error" className="field-error-msg">{errors.patientId}</span>}
                </div>

                <div>
                  <label htmlFor="upload-patient-name">Patient Name</label>
                  <input
                    id="upload-patient-name"
                    placeholder="Full name"
                    value={patientName}
                    onChange={e => {
                      const val = e.target.value;
                      setPatientName(val);
                      setErrors(p => ({ ...p, patientName: getValidationError('patientName', val) }));
                    }}
                    className={errors.patientName ? 'field-error' : ''}
                  />
                  {errors.patientName && <span className="field-error-msg">{errors.patientName}</span>}
                </div>

                <div className="form-row-2">
                  <div>
                    <label htmlFor="upload-age">Age</label>
                    <input
                      id="upload-age"
                      type="number"
                      min={0}
                      max={150}
                      placeholder="45"
                      value={age}
                      onChange={e => {
                        const val = e.target.value;
                        setAge(val);
                        setErrors(p => ({ ...p, age: getValidationError('age', val) }));
                      }}
                      className={errors.age ? 'field-error' : ''}
                    />
                    {errors.age && <span className="field-error-msg">{errors.age}</span>}
                  </div>
                  <div>
                    <label htmlFor="upload-gender">Gender</label>
                    <select
                      id="upload-gender"
                      value={gender}
                      onChange={e => {
                        const val = e.target.value;
                        setGender(val);
                        setErrors(p => ({ ...p, gender: getValidationError('gender', val) }));
                      }}
                      className={errors.gender ? 'field-error' : ''}
                    >
                      <option value="">— select —</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                    {errors.gender && <span className="field-error-msg">{errors.gender}</span>}
                  </div>
                </div>

              </div>
            </div>

            {/* Clinical note section */}
            <div className="form-section">
              <p className="form-section-title">Clinical Note <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span></p>
              <textarea
                id="upload-note"
                rows={3}
                placeholder="Clinical observations, referral context, relevant history…"
                value={note}
                onChange={e => setNote(e.target.value)}
                style={{ resize: 'vertical' }}
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !isFormValid}>
              {busy ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  Processing…
                </>
              ) : 'Run AI Inference'}
            </button>
          </form>
        </div>

        {/* Right info panel */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 12 }}>How it works</h3>
          <ol style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {['Upload a PNG or JPEG ultrasound image.', 'Fill in patient details (ID and Name are required).', 'Click Run AI Inference — the AI segments the lesion automatically.', 'Review the result on the Segmentation page.', 'Submit for Expert Review when ready.'].map((s, i) => (
              <li key={i} style={{ fontSize: '0.875rem', color: 'var(--text-muted)', paddingLeft: 4 }}>{s}</li>
            ))}
          </ol>
          <div className="warning" style={{ marginTop: 20 }}>
            Only PNG and JPEG images are accepted. DICOM files are not supported.
          </div>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        title="Run AI Inference?"
        message={`Upload and analyse the image for patient ${patientName} (PT-${patientId}). This cannot be undone.`}
        confirmLabel="Run Inference"
        onConfirm={runInference}
        onCancel={() => setConfirmOpen(false)}
      />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AppLayout>
  );
}
