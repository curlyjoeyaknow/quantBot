"""Pytest configuration and shared fixtures"""
import json
from pathlib import Path

import pytest

# Path to fixtures directory
FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir():
    """Return path to fixtures directory"""
    return FIXTURES_DIR


@pytest.fixture
def telegram_cases():
    """Load Telegram message test cases from JSON"""
    cases_path = FIXTURES_DIR / "telegram_cases.json"
    if not cases_path.exists():
        return []
    with open(cases_path, "r") as f:
        return json.load(f)


# Helper function for parametrized tests
def load_json_fixture(filename: str):
    """Load JSON fixture file for parametrized tests"""
    cases_path = FIXTURES_DIR / filename
    if not cases_path.exists():
        return []
    with open(cases_path, "r") as f:
        return json.load(f)


# Make it available to pytest
pytest.helpers = type("helpers", (), {"load_json_fixture": staticmethod(load_json_fixture)})()

