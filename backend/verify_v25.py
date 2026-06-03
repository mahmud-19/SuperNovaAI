"""End-to-end verification of v25 changes."""
import time, requests, sys
from pathlib import Path

# Add current directory to path
sys.path.append(str(Path(__file__).parent.resolve()))

# ---- Programmatic DB Reset ----
try:
    from app.database import SessionLocal
    from app.models import User, Case, InferenceResult, Annotation, AuditLog, RetrainingLog, RetrainingState
    from app.seed import seed_demo_users
    
    db = SessionLocal()
    db.query(AuditLog).delete()
    db.query(Annotation).delete()
    db.query(InferenceResult).delete()
    db.query(Case).delete()
    db.query(RetrainingLog).delete()
    db.query(RetrainingState).delete()
    db.query(User).delete()
    db.commit()
    seed_demo_users(db)
    db.close()
    print("PASS: Clean database reset completed programmatically")
except Exception as e:
    print(f"WARNING: Database reset failed or skipped: {e}")

BASE = "http://localhost:8000/api"

# Wait for server
for _ in range(10):
    try:
        requests.get(f"http://localhost:8000/health", timeout=2).raise_for_status()
        break
    except Exception:
        time.sleep(1)

# ---- Admin Authentication & Clinical User Creation ----
admin_login = requests.post(
    f"{BASE}/auth/login",
    json={"identifier": "admin@supernova.com", "password": "123456789", "role": "admin"}
)
admin_login.raise_for_status()
admin_token = admin_login.json()["access_token"]
admin_headers = {"Authorization": f"Bearer {admin_token}"}

# Create clinical sonologist user
r = requests.post(
    f"{BASE}/admin/users",
    headers=admin_headers,
    json={
        "full_name": "Sonologist User",
        "username": "sonologist",
        "email": "sonologist@supernova.com",
        "password": "12345678",
        "role": "sonologist"
    }
)
r.raise_for_status()

# Create clinical reviewer user
r = requests.post(
    f"{BASE}/admin/users",
    headers=admin_headers,
    json={
        "full_name": "Expert Reviewer User",
        "username": "reviewer",
        "email": "reviewer@supernova.com",
        "password": "87654321",
        "role": "expert_reviewer"
    }
)
r.raise_for_status()

# ---- Login Sonologist ----
r = requests.post(f"{BASE}/auth/login", json={"identifier": "sonologist@supernova.com", "password": "12345678", "role": "sonologist"})
r.raise_for_status()
s_token = r.json()["access_token"]
s_headers = {"Authorization": f"Bearer {s_token}"}

# ---- Login Reviewer ----
r = requests.post(f"{BASE}/auth/login", json={"identifier": "reviewer@supernova.com", "password": "87654321", "role": "expert_reviewer"})
r.raise_for_status()
rev_token = r.json()["access_token"]
rev_headers = {"Authorization": f"Bearer {rev_token}"}

# Let's upload a case
with open("sample.png", "rb") as f:
    r = requests.post(f"{BASE}/cases/upload", headers=s_headers,
                      files={"file": ("sample.png", f, "image/png")},
                      data={"patient_id": "PT-25000", "patient_name": "v25 Test", "age": "30",
                            "gender": "male", "exam_date": "2026-06-03", "sonologist_note": "v25 note"})
r.raise_for_status()
case_id = r.json()["id"]

# run inference
requests.post(f"{BASE}/cases/{case_id}/infer", headers=s_headers).raise_for_status()

# submit
requests.post(f"{BASE}/cases/{case_id}/submit", headers=s_headers).raise_for_status()

# Reannotate/Annotate
import json
contour_data = [[[100, 100], [200, 100], [200, 200], [100, 200]]]
# Create a dummy 512x512 mask PNG in base64
from PIL import Image
import io
import base64
mask = Image.new("L", (512, 512), 0)
# Draw a white rectangle in the middle
from PIL import ImageDraw
draw = ImageDraw.Draw(mask)
draw.rectangle([100, 100, 200, 200], fill=255)
buffered = io.BytesIO()
mask.save(buffered, format="PNG")
mask_base64 = "data:image/png;base64," + base64.b64encode(buffered.getvalue()).decode()

r = requests.post(
    f"{BASE}/cases/{case_id}/annotate",
    headers=rev_headers,
    json={"contour_json": contour_data, "mask_png_base64": mask_base64, "reviewer_note": "Expert annotations saved"}
)
r.raise_for_status()
print("PASS: Case annotated by expert reviewer")

# ---- Test reannotated.png endpoint ----
# Test with header auth
r = requests.get(f"{BASE}/cases/{case_id}/reannotated.png", headers=rev_headers)
print("reannotated.png status:", r.status_code)
assert r.status_code == 200, f"Expected 200, got {r.status_code}"
assert r.headers["content-type"] == "image/png", f"Expected image/png, got {r.headers['content-type']}"
print("PASS: reannotated.png works with header authorization")

# Test with query param token auth
r = requests.get(f"{BASE}/cases/{case_id}/reannotated.png?token={rev_token}")
assert r.status_code == 200, f"Expected 200, got {r.status_code}"
assert r.headers["content-type"] == "image/png", f"Expected image/png, got {r.headers['content-type']}"
print("PASS: reannotated.png works with query parameter token authorization")

# ---- Test Sonologist Report PDF ----
r = requests.get(f"{BASE}/cases/{case_id}/report?report_type=sonologist", headers=rev_headers)
assert r.status_code == 200, f"Expected 200, got {r.status_code}"
assert r.headers["content-type"] == "application/pdf", f"Expected application/pdf, got {r.headers['content-type']}"
print("PASS: Sonologist report PDF generated successfully")

# ---- Test Reviewer Report PDF ----
r = requests.get(f"{BASE}/cases/{case_id}/report?report_type=reviewer", headers=rev_headers)
assert r.status_code == 200, f"Expected 200, got {r.status_code}"
assert r.headers["content-type"] == "application/pdf", f"Expected application/pdf, got {r.headers['content-type']}"
print("PASS: Reviewer report PDF generated successfully")

print("All v25 verifications PASSED!")
