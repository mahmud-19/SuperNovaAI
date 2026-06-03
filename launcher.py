"""
SuperNova AI - Desktop launcher.

Starts the FastAPI backend (which also serves the built React frontend) on a
local port, waits for it to come up, then opens it in a native desktop window
via pywebview. Works both when run from source (python launcher.py) and when
frozen into a single Windows executable with PyInstaller.
"""

import os
import sys
import socket
import threading
import time
import urllib.request
from pathlib import Path


# ---------------------------------------------------------------------------
# Path resolution: works in dev AND inside a PyInstaller bundle
# ---------------------------------------------------------------------------
def resource_base() -> Path:
    """Read-only files shipped with the app (frontend/dist, backend code)."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent


def data_base() -> Path:
    """Writable files (app.db, storage/, model weights). Lives next to the .exe."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


RESOURCE_DIR = resource_base()
DATA_DIR = data_base()

# Tell the backend where the bundled frontend lives.
os.environ.setdefault("SUPERNOVA_BASE_DIR", str(RESOURCE_DIR))
# Model weights live next to the executable (shipped as an external folder).
os.environ.setdefault("SUPERNOVA_WEIGHTS_DIR", str(DATA_DIR / "models" / "weights"))

# Make the backend package importable and put the DB + storage in a writable spot.
sys.path.insert(0, str(RESOURCE_DIR / "backend"))
sys.path.insert(0, str(RESOURCE_DIR))
DATA_DIR.mkdir(parents=True, exist_ok=True)
os.chdir(DATA_DIR)  # sqlite:///./app.db and storage/ resolve here


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = int(os.environ.get("SUPERNOVA_PORT", _free_port()))
HOST = "127.0.0.1"
URL = f"http://{HOST}:{PORT}"


def _run_server() -> None:
    import uvicorn
    from app.main import app

    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


def _wait_for_server(timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{URL}/health", timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.4)
    return False


def load_app_url(window) -> None:
    if _wait_for_server():
        window.load_url(URL)
    else:
        window.load_html("<h2>Error starting application</h2><p>The medical imaging server failed to start in time.</p>")


def main() -> None:
    server = threading.Thread(target=_run_server, daemon=True)
    server.start()

    import webview

    splash_html = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>SuperNova AI</title>
        <style>
            body {
                background-color: #0b0f19;
                color: #f3f4f6;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
                overflow: hidden;
            }
            .spinner {
                border: 4px solid rgba(255, 255, 255, 0.1);
                width: 48px;
                height: 48px;
                border-radius: 50%;
                border-left-color: #3b82f6;
                animation: spin 1s linear infinite;
                margin-bottom: 24px;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            h2 {
                font-weight: 500;
                margin: 0 0 8px 0;
                font-size: 1.5rem;
            }
            p {
                color: #9ca3af;
                margin: 0;
                font-size: 0.875rem;
            }
        </style>
    </head>
    <body>
        <div class="spinner"></div>
        <h2>SuperNova AI</h2>
        <p>Starting medical imaging server...</p>
    </body>
    </html>
    """

    window = webview.create_window(
        "SuperNova AI",
        html=splash_html,
        width=1366,
        height=900,
        min_size=(1024, 700),
    )
    webview.start(load_app_url, window)


if __name__ == "__main__":
    main()
