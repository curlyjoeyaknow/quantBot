"""
Golden Fixtures Test

Tests Python simulator against golden fixtures.
Ensures simulator produces expected results on canonical test cases.
"""

import pytest
import json
import duckdb
from pathlib import Path
from simulation.contracts import SimInput, SimResult
from simulation.simulator import DuckDBSimulator

FIXTURES_DIR = Path(__file__).parent.parent / 'fixtures'


@pytest.fixture
def golden_inputs():
    """Load golden input fixtures"""
    with open(FIXTURES_DIR / 'golden_sim_inputs.json') as f:
        return json.load(f)


@pytest.fixture
def golden_results():
    """Load golden result fixtures"""
    with open(FIXTURES_DIR / 'golden_sim_results.json') as f:
        return json.load(f)


@pytest.mark.integration
def test_golden_fixtures(golden_inputs, golden_results):
    """Test Python sim against golden fixtures"""
    con = duckdb.connect(':memory:')
    simulator = DuckDBSimulator(con)
    
    # Create expected map
    expected_map = {e['name']: e['expected_result'] for e in golden_results}
    
    for input_data in golden_inputs:
        name = input_data.pop('name')
        sim_input = SimInput.from_dict(input_data)
        result = simulator.run_from_contract(sim_input)
        
        # Validate results match (within tolerance)
        expected = expected_map.get(name)
        if expected:
            expected_result = SimResult.from_dict(expected)
            
            # Compare final PnL (within 2 decimal places)
            assert abs(result.final_pnl - expected_result.final_pnl) < 0.01, \
                f"{name}: final_pnl mismatch: {result.final_pnl} vs {expected_result.final_pnl}"
            
            # Compare entry/final prices
            assert abs(result.entry_price - expected_result.entry_price) < 0.01, \
                f"{name}: entry_price mismatch"
            assert abs(result.final_price - expected_result.final_price) < 0.01, \
                f"{name}: final_price mismatch"
            
            # Compare event counts (should be close)
            assert abs(len(result.events) - len(expected_result.events)) <= 1, \
                f"{name}: event count mismatch: {len(result.events)} vs {len(expected_result.events)}"
        else:
            # No expected result, just verify it's valid
            assert result.run_id == sim_input.run_id
            assert result.total_candles == len(sim_input.candles)
            assert result.final_pnl >= 0
    
    con.close()

