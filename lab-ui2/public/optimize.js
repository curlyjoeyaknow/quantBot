const $ = (id) => document.getElementById(id);

let refreshInterval = null;

function parseCommaSeparated(value) {
  return value.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
}

$("#loadExample").onclick = () => {
  $("#pathOnlyRunId").value = "example_run_123";
  $("#caller").value = "";
  $("#policyType").value = "fixed-stop";
  $("#searchAlgo").value = "grid";
  $("#tpMults").value = "2.0, 3.0, 4.0";
  $("#slMults").value = "0.5, 0.7, 1.0";
  $("#timeStopHours").value = "";
  $("#trailActivation").value = "";
  $("#minWinRate").value = "40";
  $("#maxDrawdown").value = "5000";
  $("#minAvgR").value = "0.5";
  $("#minTrades").value = "10";
};

$("#launch").onclick = async () => {
  $("#msg").textContent = "";
  $("#msg").style.color = "";

  const pathOnlyRunId = $("#pathOnlyRunId").value.trim();
  const caller = $("#caller").value.trim();
  const policyType = $("#policyType").value;
  const searchAlgo = $("#searchAlgo").value;

  if (!pathOnlyRunId) {
    $("#msg").textContent = "Path-only run ID required";
    $("#msg").style.color = "red";
    return;
  }

  // Build parameter grid
  const tpMults = parseCommaSeparated($("#tpMults").value);
  const slMults = parseCommaSeparated($("#slMults").value);
  const timeStopHours = parseCommaSeparated($("#timeStopHours").value);
  const trailActivation = parseCommaSeparated($("#trailActivation").value);

  if (tpMults.length === 0 || slMults.length === 0) {
    $("#msg").textContent = "TP and SL multiples required";
    $("#msg").style.color = "red";
    return;
  }

  const gridJson = JSON.stringify({
    tp_mult: tpMults,
    sl_mult: slMults,
    time_stop_hours: timeStopHours.length > 0 ? timeStopHours : undefined,
    trail_activation_pct: trailActivation.length > 0 ? trailActivation : undefined,
  });

  // Build constraints
  const constraintsJson = JSON.stringify({
    min_win_rate: parseFloat($("#minWinRate").value) / 100,
    max_drawdown_bps: parseFloat($("#maxDrawdown").value),
    min_avg_r: parseFloat($("#minAvgR").value),
    min_trades: parseInt($("#minTrades").value),
  });

  try {
    const res = await fetch("/api/runs/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path_only_run_id: pathOnlyRunId,
        caller: caller || undefined,
        policy_type: policyType,
        search_algo: searchAlgo,
        constraints_json: constraintsJson,
        grid_json: gridJson,
      })
    });

    const out = await res.json();
    if (!res.ok) {
      $("#msg").textContent = out.error ?? "Launch failed";
      $("#msg").style.color = "red";
      return;
    }

    $("#msg").textContent = `✓ Launched: ${out.run_id}`;
    $("#msg").style.color = "green";

    // Refresh runs list
    await refreshRuns();

    // Start auto-refresh
    if (!refreshInterval) {
      refreshInterval = setInterval(refreshRuns, 3000);
    }

  } catch (e) {
    $("#msg").textContent = `Error: ${e.message}`;
    $("#msg").style.color = "red";
  }
};

async function refreshRuns() {
  try {
    const res = await fetch("/api/runs?mode=optimize&limit=20");
    const runs = await res.json();

    const tbody = $("#tblRuns").querySelector("tbody");
    tbody.innerHTML = "";

    if (runs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--muted);">No optimization runs yet</td></tr>';
      $("#runCount").textContent = "0";
      return;
    }

    for (const run of runs) {
      const tr = document.createElement("tr");
      
      let params = {};
      try {
        params = JSON.parse(run.params_json);
      } catch {}

      const status = run.status || 'unknown';
      const statusColor = 
        status === 'completed' ? 'green' :
        status === 'running' ? 'orange' :
        status === 'error' ? 'red' : 'gray';

      // Calculate progress (mock for now - would need actual progress tracking)
      const progress = status === 'completed' ? '100%' : 
                      status === 'running' ? '...' : 
                      status === 'queued' ? '0%' : '-';

      const bestScore = '-'; // Would need to fetch from results

      tr.innerHTML = `
        <td><code>${run.run_id}</code></td>
        <td>${params.caller || 'all'}</td>
        <td><span style="color: ${statusColor};">${status}</span></td>
        <td>${progress}</td>
        <td>${bestScore}</td>
        <td>${new Date(run.created_at).toLocaleString()}</td>
        <td>
          <button class="btn-small" onclick="viewResults('${run.run_id}')">Results</button>
          ${status === 'running' ? `<button class="btn-small btn-danger" onclick="cancelRun('${run.run_id}')">Cancel</button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    }

    $("#runCount").textContent = runs.length;

    // Stop auto-refresh if no running jobs
    const hasRunning = runs.some(r => r.status === 'running' || r.status === 'queued');
    if (!hasRunning && refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }

  } catch (e) {
    console.error('Failed to refresh runs:', e);
  }
}

window.viewResults = (runId) => {
  window.location.href = `/optimize-results?runId=${runId}`;
};

window.cancelRun = async (runId) => {
  if (!confirm('Cancel this optimization run?')) return;
  
  try {
    const res = await fetch(`/api/runs/${runId}/cancel`, { method: 'POST' });
    if (res.ok) {
      await refreshRuns();
    } else {
      alert('Failed to cancel run');
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
};

// Initial load
refreshRuns();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

