from pydantic import BaseModel
from typing import Any, Dict, List, Optional

class Strategy(BaseModel):
    id: Optional[str] = None
    name: str
    entry: Dict[str, Any]
    exits: Dict[str, Any]
    stops: Dict[str, Any]
    execution: Dict[str, Any]

class FilterPreset(BaseModel):
    id: Optional[str] = None
    name: str
    chains: List[str]
    age_minutes: Dict[str, Optional[int]]
    mcap_usd: Dict[str, Optional[float]]

class RunCreate(BaseModel):
    strategy_id: str
    filter_id: str
    interval_seconds: int
    from_ts: str
    to_ts: str

