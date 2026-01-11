#!/bin/bash
# Install dashboard dependencies

echo "Installing QuantBot EV Dashboard dependencies..."

# Use virtual environment (works on all systems)
if [ ! -d ".venv-dashboard" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv-dashboard
fi

echo "Installing dependencies in virtual environment..."
.venv-dashboard/bin/pip install -q -r tools/backtest/requirements-dashboard.txt

echo "✅ Installed in virtual environment"
echo ""
echo "To run the dashboard:"
echo "  .venv-dashboard/bin/streamlit run tools/backtest/dashboard.py"
echo ""
echo "Or activate the venv first:"
echo "  source .venv-dashboard/bin/activate"
echo "  streamlit run tools/backtest/dashboard.py"
echo ""
echo "The dashboard will auto-discover all parquet files in output/ directories!"

