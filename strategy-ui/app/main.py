from fastapi import FastAPI, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from uuid import uuid4
import json

from .db import conn
from .models import Strategy, FilterPreset, RunCreate

app = FastAPI()

from pathlib import Path

BASE_DIR = Path(__file__).parent.parent

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "app" / "static")), name="static")

templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    rows = conn.execute("SELECT id, name FROM strategies ORDER BY updated_at DESC").fetchall()
    return templates.TemplateResponse("strategies.html", {
        "request": request,
        "strategies": rows
    })

@app.get("/strategies/new", response_class=HTMLResponse)
def new_strategy(request: Request):
    return templates.TemplateResponse("strategy_edit.html", {
        "request": request,
        "strategy": None
    })

@app.get("/strategies/wizard", response_class=HTMLResponse)
def strategy_wizard(request: Request):
    return templates.TemplateResponse("strategy_wizard.html", {
        "request": request
    })

@app.post("/api/strategies")
def create_strategy(request: Request, name: str = Form(...), json_str: str = Form(...)):
    try:
        strategy_data = json.loads(json_str)
        strategy = Strategy(name=name, **strategy_data)
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=400, content={"error": f"Invalid data: {str(e)}"})
    
    sid = strategy.id or f"strat_{uuid4().hex[:8]}"
    conn.execute(
        "INSERT OR REPLACE INTO strategies VALUES (?, ?, ?, now())",
        [sid, strategy.name, json.dumps(strategy.dict())]
    )
    
    # HTMX-compatible redirect
    response = RedirectResponse(url="/", status_code=303)
    response.headers["HX-Redirect"] = "/"
    return response

@app.post("/api/runs")
def create_run(run: RunCreate):
    from .services.run_execute import execute_run, load_filter, extract_tokens_from_filter
    
    run_id = f"run_{uuid4().hex[:8]}"
    conn.execute(
        "INSERT INTO runs (run_id, strategy_id, filter_id, status, summary_json) VALUES (?, ?, ?, ?, ?)",
        [run_id, run.strategy_id, run.filter_id, "queued", "{}"]
    )
    
    # TODO: Integrate simulation execution
    # For now, this is a placeholder. To enable:
    # 1. Implement load_candles_for_token() in run_execute.py to fetch from ClickHouse/@quantbot/ohlcv
    # 2. Implement extract_tokens_from_filter() to get token list from filter
    # 3. Uncomment the execution call below (can be backgrounded with threading/async later)
    
    try:
        # Load filter and extract tokens
        filter_data = load_filter(run.filter_id)
        tokens = extract_tokens_from_filter(filter_data)
        
        if not tokens:
            conn.execute("UPDATE runs SET status = ? WHERE run_id = ?", ["error", run_id])
            return {"run_id": run_id, "status": "error", "error": "No tokens found in filter. Filter must contain 'tokens' array."}
        
        # Execute simulation run (synchronous for now - can be backgrounded later)
        execute_run(run_id, run.strategy_id, run.filter_id, run.interval_seconds, run.from_ts, run.to_ts, tokens)
        
        # Query final status
        status_row = conn.execute("SELECT status FROM runs WHERE run_id = ?", [run_id]).fetchone()
        final_status = status_row[0] if status_row else "unknown"
        
        return {"run_id": run_id, "status": final_status}
        
    except Exception as e:
        conn.execute("UPDATE runs SET status = ? WHERE run_id = ?", ["error", run_id])
        return {"run_id": run_id, "status": "error", "error": str(e)}

@app.get("/runs", response_class=HTMLResponse)
def runs(request: Request):
    rows = conn.execute("SELECT run_id, status, created_at FROM runs ORDER BY created_at DESC").fetchall()
    return templates.TemplateResponse("runs.html", {
        "request": request,
        "runs": rows
    })

