"""
NSSF Member Data Capture Web Application Server.
Powered by Python FastAPI & ug_id_parser AI Engine.
Listens on http://127.0.0.1:8000
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import shutil
import tempfile
import os
from pathlib import Path
from ug_id_parser import read_card

app = FastAPI(title="NSSF Member Data Capture API", version="1.0.0")

# Enable CORS for local clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom Middleware to disable static file browser caching
@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# API Endpoint: Scan ID Back
@app.post("/api/scan-id")
async def scan_id(file: UploadFile = File(...)):
    """
    Accepts an uploaded ID back photo, runs ug_id_parser, and returns JSON record.
    """
    suffix = Path(file.filename).suffix if file.filename else ".jpg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        record = read_card(tmp_path)
        return record.to_dict()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    finally:
        p = Path(tmp_path)
        if p.exists():
            try:
                p.unlink()
            except OSError:
                pass

# Serve static CSS & JS folders
app.mount("/css", StaticFiles(directory="css"), name="css")
app.mount("/js", StaticFiles(directory="js"), name="js")

# Serve main index.html page & service worker
@app.get("/")
async def serve_index():
    return FileResponse("index.html")

@app.get("/sw.js")
async def serve_sw():
    return FileResponse("sw.js", media_type="application/javascript")

if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("NSSF Member Data Capture App is running with NO-CACHE headers!")
    print("Open http://127.0.0.1:8000 in your web browser.")
    print("=" * 60)
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
