# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for SuperNova AI desktop app.
# Build with:  pyinstaller supernova.spec --noconfirm
#
# Produces a one-folder app under dist/SuperNovaAI/. The .exe is
# dist/SuperNovaAI/SuperNovaAI.exe. Ship the WHOLE SuperNovaAI folder.

from PyInstaller.utils.hooks import collect_submodules, collect_data_files, collect_all

block_cipher = None

# Bundle the built React frontend so the backend can serve it.
datas = [("frontend/dist", "frontend/dist"), ("assets", "assets")]
binaries = []

# uvicorn / fastapi load some modules dynamically; declare them explicitly.
hiddenimports = []
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("app")          # the FastAPI backend package
hiddenimports += [
    "passlib.handlers.bcrypt",
    "bcrypt",
    "email_validator",
    "anyio",
    "click",
]

# Collect DL packages: torch, cv2, segmentation_models_pytorch, timm
for pkg in ["torch", "cv2", "segmentation_models_pytorch", "timm"]:
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(pkg)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

a = Analysis(
    ["launcher.py"],
    pathex=["backend"],          # so `from app.main import app` resolves
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],                 # DL libraries are bundled now
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="SuperNovaAI",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,          # no terminal window; set True to see logs while debugging
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="assets/supernova.ico",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="SuperNovaAI",
)
