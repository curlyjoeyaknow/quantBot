const $ = (id) => document.getElementById(id);

const urlParams = new URLSearchParams(window.location.search);
const runId = urlParams.get('runId');

let allResults = [];
let runMetadata = null;

async function loadResults() {
  if (!runId) {
    $("#summary").innerHTML = '<p style="color: red;">No run ID provided</p>';
    return;
  }

  try {
    // Load run metadata
    const runRes = await fetch(`/api/runs/${runId}`);
    if (!runRes.ok) {
      $("#summary").innerHTML = '<p style="color: red;">Run not found</p>';
      return;
    }
    runMetadata = await runRes.json();

    // Load optimization results
    const resultsRes = await fetch(`/api/optimize-results/${runId}`);
    if (!resultsRes.ok) {
      $("#summary").innerHTML = '<p style="color: red;">Results not found</p>';
      return;
    }
    const data = await resultsRes.json();
    allResults = data.results || [];

    renderSummary();
    renderResults();
    renderQualityStats(data.quality_stats);

  } catch (e) {
    $("#summary").innerHTML = `<p style="color: red;">Error: ${e.message}</p>`;
  }
}

function renderSummary() {
  let params = {};
  try {
    params = JSON.parse(runMetadata.params_json);
  } catch {}

  const status = runMetadata.status || 'unknown';
  const statusColor = 
    status === 'completed' ? 'green' :
    status === 'running' ? 'orange' :
    status === 'error' ? 'red' : 'gray';

  let html = `
    <h3 style="margin-top: 0;">Run ${runId}</h3>
    <p><strong>Status:</strong> <span style="color: ${statusColor};">${status}</span></p>
    <p><strong>Path-Only Run:</strong> ${params.path_only_run_id || 'N/A'}</p>
    <p><strong>Caller:</strong> ${params.caller || 'all'}</p>
    <p><strong>Policy Type:</strong> ${params.policy_type || 'N/A'}</p>
    <p><strong>Search Algorithm:</strong> ${params.search_algo || 'grid'}</p>
    <p><strong>Started:</strong> ${new Date(runMetadata.created_at).toLocaleString()}</p>
  `;

  if (runMetadata.finished_at) {
    html += `<p><strong>Finished:</strong> ${new Date(runMetadata.finished_at).toLocaleString()}</p>`;
    const duration = (new Date(runMetadata.finished_at) - new Date(runMetadata.started_at || runMetadata.created_at)) / 1000;
    html += `<p><strong>Duration:</strong> ${duration.toFixed(1)}s</p>`;
  }

  if (runMetadata.error_text) {
    html += `<p style="color: red;"><strong>Error:</strong> ${runMetadata.error_text}</p>`;
  }

  $("#summary").innerHTML = html;
}

function renderResults() {
  const sortBy = $("#sortBy").value;
  
  // Sort results
  const sorted = [...allResults].sort((a, b) => {
    const aVal = a[sortBy] || 0;
    const bVal = b[sortBy] || 0;
    return bVal - aVal; // Descending
  });

  const tbody = $("#tblResults").querySelector("tbody");
  tbody.innerHTML = "";

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align: center; color: var(--muted);">No results yet</td></tr>';
    $("#resultCount").textContent = "0";
    return;
  }

  sorted.forEach((result, index) => {
    const tr = document.createElement("tr");
    
    // Highlight top 5
    if (index < 5) {
      tr.style.background = 'rgba(122, 162, 255, 0.08)';
    }

    const params = result.params || {};
    
    tr.innerHTML = `
      <td><strong>${index + 1}</strong></td>
      <td>${params.tp_mult?.toFixed(2) || '-'}</td>
      <td>${params.sl_mult?.toFixed(2) || '-'}</td>
      <td>${params.time_stop_hours?.toFixed(1) || '-'}</td>
      <td>${params.trail_activation_pct ? (params.trail_activation_pct * 100).toFixed(0) + '%' : '-'}</td>
      <td><strong>${result.objective_score?.toFixed(3) || '-'}</strong></td>
      <td>${result.avg_r?.toFixed(2) || '-'}</td>
      <td>${result.win_rate ? (result.win_rate * 100).toFixed(1) + '%' : '-'}</td>
      <td>${result.profit_factor?.toFixed(2) || '-'}</td>
      <td>${result.total_r?.toFixed(1) || '-'}</td>
      <td>${result.alerts_ok || 0}/${result.alerts_total || 0}</td>
      <td>
        <button class="btn-small" onclick="viewDetails(${index})">Details</button>
        <button class="btn-small" onclick="createStrategy(${index})">Create Strategy</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  $("#resultCount").textContent = sorted.length;
}

function renderQualityStats(stats) {
  if (!stats) {
    $("#qualityStats").innerHTML = '<p style="color: #999;">No quality filter applied</p>';
    return;
  }

  let html = '<h3 style="margin-top: 0;">Quality Filter Results</h3>';
  html += `<p><strong>Total Configs:</strong> ${stats.total || 0}</p>`;
  html += `<p><strong>Passed:</strong> <span style="color: green;">${stats.passed || 0}</span></p>`;
  html += `<p><strong>Failed:</strong> <span style="color: red;">${stats.failed || 0}</span></p>`;
  html += `<p><strong>Pass Rate:</strong> ${stats.pass_rate ? (stats.pass_rate * 100).toFixed(1) + '%' : '0%'}</p>`;

  if (stats.failure_reasons && Object.keys(stats.failure_reasons).length > 0) {
    html += '<h4>Failure Reasons:</h4><ul>';
    for (const [reason, count] of Object.entries(stats.failure_reasons)) {
      html += `<li>${reason}: ${count}</li>`;
    }
    html += '</ul>';
  }

  $("#qualityStats").innerHTML = html;
}

$("#sortBy").addEventListener('change', renderResults);

$("#exportCsv").onclick = () => {
  const csv = convertToCSV(allResults);
  downloadFile(csv, `optimization_results_${runId}.csv`, 'text/csv');
};

$("#exportJson").onclick = () => {
  const json = JSON.stringify(allResults, null, 2);
  downloadFile(json, `optimization_results_${runId}.json`, 'application/json');
};

function convertToCSV(results) {
  if (results.length === 0) return '';

  const headers = ['rank', 'tp_mult', 'sl_mult', 'time_stop_hours', 'trail_activation_pct', 
                   'objective_score', 'avg_r', 'win_rate', 'profit_factor', 'total_r', 'alerts_ok', 'alerts_total'];
  
  let csv = headers.join(',') + '\n';
  
  results.forEach((result, index) => {
    const params = result.params || {};
    const row = [
      index + 1,
      params.tp_mult || '',
      params.sl_mult || '',
      params.time_stop_hours || '',
      params.trail_activation_pct || '',
      result.objective_score || '',
      result.avg_r || '',
      result.win_rate || '',
      result.profit_factor || '',
      result.total_r || '',
      result.alerts_ok || '',
      result.alerts_total || ''
    ];
    csv += row.join(',') + '\n';
  });

  return csv;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

window.viewDetails = (index) => {
  const result = allResults[index];
  alert(JSON.stringify(result, null, 2));
};

window.createStrategy = async (index) => {
  const result = allResults[index];
  const params = result.params || {};
  
  const name = `Optimized ${params.tp_mult}x/${params.sl_mult}x`;
  const config = {
    ladder: {
      enabled: true,
      levels: [
        { kind: "multiple", multiple: params.tp_mult, fraction: 1.0 }
      ]
    },
    trailing: {
      enabled: false
    },
    indicator: {
      enabled: false
    }
  };

  try {
    const res = await fetch("/api/strategies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        config_json: JSON.stringify(config, null, 2)
      })
    });

    if (res.ok) {
      const out = await res.json();
      alert(`Strategy created: ${out.strategy_id}`);
    } else {
      alert('Failed to create strategy');
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
};

loadResults();

