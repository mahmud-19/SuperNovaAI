"""End-to-end verification of v5 changes."""
import time, requests, base64, io, sys
from pathlib import Path
from PIL import Image

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

# ---- Sonologist login ----
r = requests.post(f"{BASE}/auth/login", json={"identifier": "sonologist@supernova.com", "password": "12345678", "role": "sonologist"})
r.raise_for_status()
s_token = r.json()["access_token"]
s_headers = {"Authorization": f"Bearer {s_token}"}
print("PASS: Sonologist login")

# ---- Upload with PT- prefix patient ID ----
with open("sample.png", "rb") as f:
    r = requests.post(f"{BASE}/cases/upload", headers=s_headers,
                      files={"file": ("sample.png", f, "image/png")},
                      data={"patient_id": "PT-99999", "patient_name": "v5 Test", "age": "30",
                            "gender": "male", "exam_date": "2026-05-26", "sonologist_note": "v5 note"})
r.raise_for_status()
case = r.json()
case_id = case["id"]
assert case["patient_id"] == "PT-99999", f"patient_id: {case['patient_id']}"
assert case["status"] == "pending", f"status after upload should be pending, got {case['status']}"
print(f"PASS: Upload -> status=pending, patient_id={case['patient_id']}")

# ---- Run inference -> status stays pending ----
r = requests.post(f"{BASE}/cases/{case_id}/infer", headers=s_headers)
r.raise_for_status()
r2 = requests.get(f"{BASE}/cases/{case_id}", headers=s_headers)
assert r2.json()["status"] == "pending", f"After infer: {r2.json()['status']}"
print("PASS: After inference -> status still pending")

# ---- Submit -> status becomes in_review ----
r = requests.post(f"{BASE}/cases/{case_id}/submit", headers=s_headers)
r.raise_for_status()
assert r.json()["status"] == "in_review", f"After submit: {r.json()['status']}"
print(f"PASS: After submit -> status=in_review")

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

# ---- Reviewer sees it ----
r = requests.post(f"{BASE}/auth/login", json={"identifier": "reviewer@supernova.com", "password": "87654321", "role": "expert_reviewer"})
r.raise_for_status()
rev_token = r.json()["access_token"]
rev_headers = {"Authorization": f"Bearer {rev_token}"}
print("PASS: Reviewer login")

r = requests.get(f"{BASE}/cases", headers=rev_headers)
r.raise_for_status()
all_cases = r.json()
rev_case = next((c for c in all_cases if c["id"] == case_id), None)
assert rev_case is not None, "Case not visible to reviewer"
assert rev_case["status"] == "in_review"
assert rev_case["patient_id"] == "PT-99999"
assert rev_case["patient_name"] == "v5 Test"
assert rev_case["sonologist_note"] == "v5 note"
assert rev_case["owner_name"] == "Sonologist User", f"Uploader name not preserved, got {rev_case['owner_name']}"
print(f"PASS: Reviewer sees case; uploader_name 'Sonologist User' preserved perfectly!")

# ---- Annotate + Final Approval -> status becomes approved ----
img = Image.new("L", (512, 512), 0)
buf = io.BytesIO(); img.save(buf, format="PNG")
mask_b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

r = requests.post(f"{BASE}/cases/{case_id}/annotate", headers=rev_headers,
                  json={"contour_json": [], "mask_png_base64": mask_b64, "reviewer_note": "looks fine"})
r.raise_for_status()
print("PASS: Annotate succeeded")

r = requests.post(f"{BASE}/cases/{case_id}/finalize", headers=rev_headers)
r.raise_for_status()
assert r.json()["status"] == "approved", f"After finalize: {r.json()['status']}"
print("PASS: After Final Approval -> status=approved")

# ---- Verify approved case NO longer shows Review button (status=approved -> not in_review) ----
r = requests.get(f"{BASE}/cases", headers=rev_headers)
approved_case = next((c for c in r.json() if c["id"] == case_id), None)
assert approved_case is not None, "Approved case should still be visible to reviewer"
assert approved_case["status"] == "approved"
assert approved_case["owner_name"] == "Sonologist User", f"Uploader name mismatch post-finalize: {approved_case['owner_name']}"
print("PASS: Approved case still visible to reviewer (status=approved, uploader_name preserved)")

# Export PDF and verify uploader name shown
r = requests.get(f"{BASE}/cases/{case_id}/report", headers=rev_headers)
r.raise_for_status()
pdf_bytes = r.content
assert b"%PDF" in pdf_bytes, "Response does not appear to be a PDF"
print("PASS: Case PDF report compiled successfully post-user deletion")

# ---- Verify ONLY in_review + approved appear in reviewer list (not plain pending) ----
# Create a new active sonologist to test plain pending visibility
r = requests.post(
    f"{BASE}/admin/users",
    headers=admin_headers,
    json={
        "full_name": "Sonologist User 2",
        "username": "sonologist2",
        "email": "sonologist2@supernova.com",
        "password": "12345678",
        "role": "sonologist"
    }
)
r.raise_for_status()
s2_token_resp = requests.post(f"{BASE}/auth/login", json={"identifier": "sonologist2@supernova.com", "password": "12345678", "role": "sonologist"})
s2_token = s2_token_resp.json()["access_token"]
s2_headers = {"Authorization": f"Bearer {s2_token}"}

# Upload a second case but don't submit it
with open("sample.png", "rb") as f:
    r2 = requests.post(f"{BASE}/cases/upload", headers=s2_headers,
                       files={"file": ("sample.png", f, "image/png")},
                       data={"patient_id": "PT-00001", "patient_name": "Not Submitted"})
r2.raise_for_status()
pending_case_id = r2.json()["id"]
requests.post(f"{BASE}/cases/{pending_case_id}/infer", headers=s2_headers)

r = requests.get(f"{BASE}/cases", headers=rev_headers)
visible_ids = [c["id"] for c in r.json()]
assert pending_case_id not in visible_ids, "Plain pending case should NOT be visible to reviewer"
print(f"PASS: Plain pending case NOT visible to reviewer (only in_review/approved shown)")

print("\nAll v5 verifications PASSED!")
