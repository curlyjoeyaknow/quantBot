#!/bin/bash
#
# Start the DuckDB write queue worker as a background process.
#
# Usage:
#   ./start_write_worker.sh          # Start worker
#   ./start_write_worker.sh stop     # Stop worker
#   ./start_write_worker.sh status   # Check status
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/../../data/.duckdb_write_queue/worker.pid"
LOG_FILE="$SCRIPT_DIR/../../logs/duckdb_write_worker.log"

cd "$SCRIPT_DIR"

start_worker() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "Worker already running (PID $PID)"
            exit 0
        fi
        rm "$PID_FILE"
    fi

    echo "Starting DuckDB write queue worker..."
    mkdir -p "$(dirname "$LOG_FILE")"
    
    nohup python3 -m lib.write_queue work --poll 2.0 >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Worker started (PID $(cat "$PID_FILE"))"
    echo "Log: $LOG_FILE"
}

stop_worker() {
    if [ ! -f "$PID_FILE" ]; then
        echo "Worker not running (no PID file)"
        exit 0
    fi

    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Stopping worker (PID $PID)..."
        kill "$PID"
        sleep 1
        if kill -0 "$PID" 2>/dev/null; then
            kill -9 "$PID"
        fi
        rm "$PID_FILE"
        echo "Worker stopped"
    else
        echo "Worker not running (stale PID file)"
        rm "$PID_FILE"
    fi
}

check_status() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "Worker running (PID $PID)"
            python3 -m lib.write_queue status
            exit 0
        fi
        echo "Worker not running (stale PID file)"
        rm "$PID_FILE"
        exit 1
    fi
    echo "Worker not running"
    python3 -m lib.write_queue status
    exit 1
}

case "$1" in
    stop)
        stop_worker
        ;;
    status)
        check_status
        ;;
    *)
        start_worker
        ;;
esac

