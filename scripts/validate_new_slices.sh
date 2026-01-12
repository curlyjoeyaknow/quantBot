#!/bin/bash
# Validate newly exported slices

echo "=== Validating new slices ==="
python tools/backtest/validate_slices.py \
  --dir slices/per_token_v2 \
  --expected-hours 48 \
  --output validation_report_v2.json \
  --verbose

echo ""
echo "=== Quality Report ==="
cat validation_report_v2.json | python -m json.tool | head -100

