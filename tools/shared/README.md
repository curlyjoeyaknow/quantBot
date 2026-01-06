# tools/shared

Shared Python library code used by Python tool "apps" in `tools/*`.

## Architecture
- `packages/*` = TypeScript packages (strict ports/adapters).
- `tools/*` = Python "apps" (CLI scripts) invoked by TypeScript via `PythonEngine`.
- `tools/shared/*` = shared Python utilities (adapters/helpers) used by those apps.

## Boundary rule
- `tools/shared/*` MUST NOT import from `tools/storage/*`.
- `tools/storage/*` MAY import from `tools/shared/*`.

## Modules

### `progress_bar.py`

Reusable progress bar utility with visual histogram bars and ETA calculation.

**Features:**
- Static progress bars that update in place (no scrolling)
- Visual histogram with filled (`█`) and unfilled (`░`) characters
- Real-time ETA calculation based on processing speed
- Customizable prefixes and bar lengths
- Context manager support for automatic cleanup

**Usage Examples:**

```python
# Option 1: Class-based with context manager (recommended)
from tools.shared.progress_bar import ProgressBar

with ProgressBar(total=1000, prefix="Processing items") as progress:
    for i in range(1000):
        # ... do work ...
        progress.update(i + 1)

# Option 2: Class-based with manual control
progress = ProgressBar(total=1000, prefix="Processing")
for i in range(1000):
    # ... do work ...
    progress.update(i + 1)
    # Can also update prefix dynamically
    if i % 100 == 0:
        progress.update(prefix=f"Processing batch {i // 100}")
progress.finish()

# Option 3: Simple function interface
from tools.shared.progress_bar import print_progress_bar

for i in range(1000):
    # ... do work ...
    print_progress_bar(i + 1, 1000, prefix="Processing")
```

**API:**

- `ProgressBar(total, prefix="Progress", bar_length=50, update_interval=1, stream=sys.stderr)`
  - `update(completed=None, increment=1, prefix=None)` - Update progress
  - `finish()` - Finish and print newline
  - Context manager support (`with` statement)

- `print_progress_bar(completed, total, prefix="Progress", bar_length=50, stream=sys.stderr)`
  - Simple stateless function for quick progress bars

