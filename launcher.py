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


class Api:
    def __init__(self):
        self._window = None

    def set_window(self, window):
        self._window = window

    def save_file(self, filename: str, b64_data: str) -> bool:
        """
        Open a native save file dialog and save base64 data to the selected path.
        """
        try:
            import base64
            import webview
            
            if not self._window:
                return False
                
            # Open save file dialog
            result = self._window.create_file_dialog(webview.SAVE_DIALOG, save_filename=filename)
            if not result:
                return False
            
            # If result is a list/tuple, get the first element
            save_path = result[0] if isinstance(result, (list, tuple)) else result
            if not save_path:
                return False
            
            # Decode the base64 content and write it
            data = base64.b64decode(b64_data)
            with open(save_path, "wb") as f:
                f.write(data)
            return True
        except Exception as e:
            print(f"Error saving file: {e}", file=sys.stderr)
            return False


def main() -> None:
    server = threading.Thread(target=_run_server, daemon=True)
    server.start()

    import webview

    splash_html = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset='UTF-8'>
        <title>SuperNova AI</title>
        <style>
            body {
                background: radial-gradient(circle at center, #0b1528 0%, #030712 100%);
                color: #f3f4f6;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
                overflow: hidden;
            }
            .container {
                text-align: center;
                animation: fadeIn 0.8s ease-out;
            }
            .logo-wrap {
                margin-bottom: 24px;
                animation: logoPulse 3s infinite ease-in-out;
            }
            .title {
                font-size: 1.75rem;
                font-weight: 800;
                letter-spacing: -0.02em;
                margin: 0 0 4px 0;
                color: #ffffff;
            }
            .title span {
                color: #2DD4BF;
            }
            .tagline {
                font-size: 0.8125rem;
                color: #94A3B8;
                font-weight: 600;
                letter-spacing: 0.08em;
                margin: 0;
            }
            .loader-track {
                width: 200px;
                height: 3px;
                background: rgba(255, 255, 255, 0.08);
                border-radius: 2px;
                overflow: hidden;
                margin: 28px auto 14px;
                position: relative;
            }
            .loader-bar {
                height: 100%;
                background: linear-gradient(90deg, #0F766E, #2DD4BF, #5EEAD4);
                width: 40%;
                border-radius: 2px;
                position: absolute;
                animation: loadSlide 1.6s infinite ease-in-out;
            }
            .status {
                font-size: 0.75rem;
                color: #64748B;
                margin: 0;
                font-weight: 500;
                letter-spacing: 0.02em;
            }
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(8px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes logoPulse {
                0% { transform: scale(1); filter: drop-shadow(0 0 10px rgba(45, 212, 191, 0.15)); }
                50% { transform: scale(1.04); filter: drop-shadow(0 0 24px rgba(45, 212, 191, 0.4)); }
                100% { transform: scale(1); filter: drop-shadow(0 0 10px rgba(45, 212, 191, 0.15)); }
            }
            @keyframes loadSlide {
                0% { left: -40%; }
                50% { width: 50%; }
                100% { left: 100%; }
            }
        </style>
    </head>
    <body>
        <div class='container'>
            <div class='logo-wrap'>
                <svg width='96' height='96' viewBox='0 0 64 64' fill='none' xmlns='http://www.w3.org/2000/svg' aria-label='SuperNova AI logo'>
                    <circle cx='32' cy='32' r='30' fill='url(#snGlow)' opacity='0.18'/>
                    <line x1='46' y1='32' x2='63' y2='32' stroke='#0F766E' stroke-width='3' stroke-linecap='round'/>
                    <line x1='39.78' y1='39.78' x2='50.38' y2='50.38' stroke='#14B8A6' stroke-width='2' stroke-linecap='round'/>
                    <line x1='32' y1='46' x2='32' y2='63' stroke='#0F766E' stroke-width='3' stroke-linecap='round'/>
                    <line x1='24.22' y1='39.78' x2='13.62' y2='50.38' stroke='#14B8A6' stroke-width='2' stroke-linecap='round'/>
                    <line x1='18' y1='32' x2='1' y2='32' stroke='#0F766E' stroke-width='3' stroke-linecap='round'/>
                    <line x1='24.22' y1='24.22' x2='13.62' y2='13.62' stroke='#14B8A6' stroke-width='2' stroke-linecap='round'/>
                    <line x1='32' y1='18' x2='32' y2='1' stroke='#0F766E' stroke-width='3' stroke-linecap='round'/>
                    <line x1='39.78' y1='24.22' x2='50.38' y2='13.62' stroke='#14B8A6' stroke-width='2' stroke-linecap='round'/>
                    <circle cx='32' cy='32' r='10' fill='url(#snCore)'/>
                    <circle cx='32' cy='32' r='4.5' fill='#ffffff' opacity='0.95'/>
                    <line x1='32' y1='18' x2='32' y2='22' stroke='#5EEAD4' stroke-width='1.5' stroke-linecap='round'/>
                    <line x1='32' y1='42' x2='32' y2='46' stroke='#5EEAD4' stroke-width='1.5' stroke-linecap='round'/>
                    <line x1='18' y1='32' x2='22' y2='32' stroke='#5EEAD4' stroke-width='1.5' stroke-linecap='round'/>
                    <line x1='42' y1='32' x2='46' y2='32' stroke='#5EEAD4' stroke-width='1.5' stroke-linecap='round'/>
                    <defs>
                        <radialGradient id='snGlow' cx='50%' cy='50%' r='50%'>
                            <stop offset='0%' stop-color='#0F766E'/>
                            <stop offset='100%' stop-color='#0F766E' stop-opacity='0'/>
                        </radialGradient>
                        <radialGradient id='snCore' cx='40%' cy='35%' r='65%'>
                            <stop offset='0%' stop-color='#2DD4BF'/>
                            <stop offset='100%' stop-color='#0F766E'/>
                        </radialGradient>
                    </defs>
                </svg>
            </div>
            <h1 class='title'>SuperNova <span>AI</span></h1>
            <p class='tagline'>CLINICAL ULTRASOUND INTELLIGENCE</p>
            <div class='loader-track'>
                <div class='loader-bar'></div>
            </div>
            <p class='status'>Preparing your workspace...</p>
        </div>
    </body>
    </html>
    """

    api = Api()
    window = webview.create_window(
        "SuperNova AI",
        html=splash_html,
        width=1366,
        height=900,
        min_size=(1024, 700),
        js_api=api,
    )
    api.set_window(window)
    
    # Safely try to set app icon for dev runs (ignored if unsupported)
    try:
        icon_file = RESOURCE_DIR / "assets" / "supernova-256.png"
        if icon_file.exists():
            if hasattr(window, "set_icon"):
                window.set_icon(str(icon_file))
    except Exception as e:
        print(f"Non-critical: Failed to set window icon: {e}", file=sys.stderr)

    webview.start(load_app_url, window)


if __name__ == "__main__":
    main()
