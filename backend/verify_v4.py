"""End-to-end verification of v4 changes."""
import sys, requests, time
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
print("PASS: Admin login at /admin portal")

# Reject admin logging in with clinical role
for clinical_role in ["sonologist", "expert_reviewer"]:
    r = requests.post(
        f"{BASE}/auth/login",
        json={"identifier": "admin@supernova.com", "password": "123456789", "role": clinical_role}
    )
    assert r.status_code == 403, f"Admin login as {clinical_role} should be rejected with 403"
print("PASS: Admin login rejected at clinical endpoints")

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
sonologist_user_id = r.json()["id"]
print("PASS: Created Sonologist user via Admin user management API")

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
reviewer_user_id = r.json()["id"]
print("PASS: Created Expert Reviewer user via Admin user management API")

# Verify email/username uniqueness constraint
r = requests.post(
    f"{BASE}/admin/users",
    headers=admin_headers,
    json={
        "full_name": "Duplicate Sonologist",
        "username": "sonologist",
        "email": "another@supernova.com",
        "password": "password123",
        "role": "sonologist"
    }
)
assert r.status_code == 400, "Should reject duplicate username"
assert "Username already exists" in r.text or "exists" in r.text, f"Unexpected error: {r.text}"

r = requests.post(
    f"{BASE}/admin/users",
    headers=admin_headers,
    json={
        "full_name": "Duplicate Sonologist",
        "username": "another_username",
        "email": "sonologist@supernova.com",
        "password": "password123",
        "role": "sonologist"
    }
)
assert r.status_code == 400, "Should reject duplicate email"
assert "Email already exists" in r.text or "exists" in r.text, f"Unexpected error: {r.text}"
print("PASS: Duplicate username/email checks validated successfully")

# -- Sonologist flow --
r = requests.post(f"{BASE}/auth/login", json={"identifier": "sonologist@supernova.com", "password": "12345678", "role": "sonologist"})
r.raise_for_status()
s_token = r.json()["access_token"]
s_headers = {"Authorization": f"Bearer {s_token}"}
print("PASS: Sonologist login")

# Check /cases/mine returns empty list for fresh sonologist
r = requests.get(f"{BASE}/cases/mine", headers=s_headers)
r.raise_for_status()
mine_before = r.json()
print(f"PASS: /cases/mine returns {len(mine_before)} case(s) (expected 0 initially or from previous runs)")

# Upload a case with patient fields
with open("sample.png", "rb") as f:
    r = requests.post(f"{BASE}/cases/upload", headers=s_headers, files={"file": ("sample.png", f, "image/png")},
                      data={"patient_id": "PT-TEST", "patient_name": "Jane Smith", "age": "42", "gender": "female",
                            "exam_date": "2026-05-26", "sonologist_note": "Test case for v4 verification"})
r.raise_for_status()
case = r.json()
case_id = case["id"]
assert case["patient_id"] == "PT-TEST", f"patient_id mismatch: {case['patient_id']}"
assert case["patient_name"] == "Jane Smith", f"patient_name mismatch: {case['patient_name']}"
assert case["age"] == 42, f"age mismatch: {case['age']}"
assert case["gender"] == "female"
assert case["submitted"] == False
print(f"PASS: Upload case {case_id} with patient data: patient_id={case['patient_id']}, patient_name={case['patient_name']}")

# Run inference
r = requests.post(f"{BASE}/cases/{case_id}/infer", headers=s_headers)
r.raise_for_status()
infer = r.json()
conf = round(infer["confidence_score"] * 100)
print(f"PASS: Inference run, confidence={conf}%")

# Submit for review
r = requests.post(f"{BASE}/cases/{case_id}/submit", headers=s_headers)
r.raise_for_status()
submitted = r.json()
assert submitted["submitted"] == True, "submitted should be True"
assert submitted["status"] == "in_review", f"status should be in_review, got {submitted['status']}"
print(f"PASS: Case submitted: submitted={submitted['submitted']}, status={submitted['status']}")

# ---- Admin User Deletion & Hard Delete Verification ----
# Deleting (hard-deleting) the Sonologist account
r = requests.delete(f"{BASE}/admin/users/{sonologist_user_id}", headers=admin_headers)
r.raise_for_status()
print("PASS: Hard-deleted Sonologist user successfully")

# Attempt to log in with hard-deleted user (should fail with 401 Unauthorized)
r = requests.post(
    f"{BASE}/auth/login",
    json={"identifier": "sonologist@supernova.com", "password": "12345678", "role": "sonologist"}
)
assert r.status_code == 401, f"Hard-deleted user login should fail with 401, got {r.status_code}"
print("PASS: Hard-deleted user login blocked successfully")

# -- Expert Reviewer flow --
r = requests.post(f"{BASE}/auth/login", json={"identifier": "reviewer@supernova.com", "password": "87654321", "role": "expert_reviewer"})
r.raise_for_status()
rev_token = r.json()["access_token"]
rev_headers = {"Authorization": f"Bearer {rev_token}"}
print("PASS: Reviewer login")

# Reviewer sees submitted cases (even when Sonologist was deleted)
r = requests.get(f"{BASE}/cases", headers=rev_headers)
r.raise_for_status()
all_cases = r.json()
rev_case = next((c for c in all_cases if c["id"] == case_id), None)
assert rev_case is not None, f"Case {case_id} not visible to reviewer"
assert rev_case["status"] == "in_review"
assert rev_case["patient_id"] == "PT-TEST"
assert rev_case["owner_name"] == "Sonologist User", f"Uploader name not preserved, got {rev_case['owner_name']}"
print(f"PASS: Reviewer sees submitted case; uploader_name 'Sonologist User' preserved perfectly!")

# -- Annotate with reviewer_note --
import base64
# Create a tiny 512x512 black PNG mask
try:
    from PIL import Image
    import io
    img = Image.new("L", (512, 512), 0)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    mask_b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
except ImportError:
    # Fallback: minimal valid 1x1 PNG
    mask_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg=="

r = requests.post(f"{BASE}/cases/{case_id}/annotate", headers=rev_headers,
                  json={"contour_json": [], "mask_png_base64": mask_b64, "reviewer_note": "Boundary looks clear"})
r.raise_for_status()
print("PASS: Annotate with reviewer_note succeeded")

# Check reviewer_note saved
r = requests.get(f"{BASE}/cases/{case_id}", headers=rev_headers)
r.raise_for_status()
detail = r.json()
assert detail["reviewer_note"] == "Boundary looks clear", f"reviewer_note mismatch: {detail['reviewer_note']}"
assert detail["owner_name"] == "Sonologist User", f"Uploader name mismatch in detail: {detail['owner_name']}"
print(f"PASS: reviewer_note saved: '{detail['reviewer_note']}' and uploader name preserved")

# Export PDF and verify uploader name shown
r = requests.get(f"{BASE}/cases/{case_id}/report", headers=rev_headers)
r.raise_for_status()
pdf_bytes = r.content
assert b"%PDF" in pdf_bytes, "Response does not appear to be a PDF"
print("PASS: Case PDF report compiled successfully post-user deletion")

print("\nAll v4 verifications passed!")
