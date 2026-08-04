"""FastAPI wrapper — optional deployment mode (the API layer may also spawn the
CLI per job). Run: .venv/bin/uvicorn painting_engine.service:app --port 8781
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .params import EngineParams
from .pipeline import ALL_STAGES, parse_sessions, run_pipeline
from .version import ENGINE_VERSION

app = FastAPI(title="painting-engine", version=ENGINE_VERSION)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "engineVersion": ENGINE_VERSION, "stages": ALL_STAGES}


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    reference_kind: str = Form(...),
    reference_cm: float = Form(...),
    stages: str = Form(",".join(ALL_STAGES)),
    params_json: str | None = Form(None),
    sessions: str | None = Form(None),
) -> dict:
    import json

    overrides = json.loads(params_json) if params_json else None
    params = EngineParams.from_dict(overrides)
    suffix = Path(file.filename or "art.png").suffix or ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(await file.read())
        tmp.flush()
        try:
            return run_pipeline(
                image_path=tmp.name,
                reference_kind=reference_kind,
                reference_value_cm=reference_cm,
                params=params,
                stages=[s for s in stages.split(",") if s],
                sessions=parse_sessions(sessions),
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/analyze-path")
def analyze_path(payload: dict) -> dict:
    """Same as /analyze but for a server-local path (used by the NestJS API,
    which stores uploads on the same host)."""
    try:
        params = EngineParams.from_dict(payload.get("params"))
        return run_pipeline(
            image_path=payload["imagePath"],
            reference_kind=payload["referenceKind"],
            reference_value_cm=float(payload["referenceCm"]),
            params=params,
            stages=payload.get("stages"),
            sessions=parse_sessions(payload.get("sessions")),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
