# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for SuperNova AI desktop app.
# Build with:  pyinstaller supernova.spec --noconfirm
#
# Produces a one-folder app under dist/SuperNovaAI/. The .exe is
# dist/SuperNovaAI/SuperNovaAI.exe. Ship the WHOLE SuperNovaAI folder.

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

# Bundle the built React frontend so the backend can serve it.
datas = [("frontend/dist", "frontend/dist")]

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

a = Analysis(
    ["launcher.py"],
    pathex=["backend"],          # so `from app.main import app` resolves
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    # Keep the standalone build small + reliable: the heavy DL stack is excluded,
    # so packaged inference uses the graceful mock fallback. Remove these lines
    # (and install torch before building) if you want real models in the .exe.
    excludes=["torch", "torchvision", "cv2", "segmentation_models_pytorch", "timm"],
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
