function $(id) {
  return document.getElementById(id);
}

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return Number(n).toFixed(digits);
}

function fmtInt(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return String(Math.trunc(Number(n)));
}

function fmtRate01(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return (Number(n) * 100).toFixed(1) + "%";
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function renderLeaderboard(rows) {
  const tbody = $("tbl").querySelector("tbody");
  tbody.innerHTML = "";

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.caller_name ?? "-"}</td>
      <td>${fmtInt(r.calls)}</td>
      <td>${fmt(r.agg_pnl_pct_sum, 2)}</td>
      <td>${fmtRate01(r.strike_rate)}</td>
      <td>${fmt(r.median_drawdown_bps, 0)}</td>
      <td>${fmt(r.total_drawdown_bps, 0)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderPath(rows) {
  const tbody = $("tblPath").querySelector("tbody");
  tbody.innerHTML = "";

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.caller_name ?? "-"}</td>
      <td>${fmtInt(r.calls)}</td>
      <td>${fmtInt(r.count_2x)}</td>
      <td>${fmtInt(r.count_3x)}</td>
      <td>${fmtInt(r.count_4x)}</td>
      <td>${fmtInt(r.fail_2x)}</td>
      <td>${fmt(r.median_t2x_min, 1)}</td>
      <td>${fmt(r.median_t3x_min, 1)}</td>
      <td>${fmt(r.median_t4x_min, 1)}</td>
      <td>${fmt(r.avg_drawdown_bps, 0)}</td>
      <td>${fmt(r.avg_drawdown_to_2x_bps, 0)}</td>
      <td>${fmt(r.median_alert_to_activity_s, 1)}</td>
      <td>${fmt(r.avg_peak_multiple, 2)}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function load(runId) {
  $("msg").textContent = "Loading...";
  try {
    const [lb, path] = await Promise.all([
      fetchJson(`/api/leaderboard/${encodeURIComponent(runId)}`),
      fetchJson(`/api/caller-path/${encodeURIComponent(runId)}`),
    ]);
    renderLeaderboard(lb);
    renderPath(path);
    $("msg").textContent = `Loaded ${lb.length} callers`;
  } catch (e) {
    $("msg").textContent = String(e?.message ?? e);
  }
}

$("load").addEventListener("click", () => {
  const runId = $("runId").value.trim();
  if (!runId) {
    $("msg").textContent = "Run ID required";
    return;
  }
  load(runId);
});
