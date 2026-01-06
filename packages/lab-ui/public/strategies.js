const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

function init() {
  const seedBtn = $('seed');
  const saveBtn = $('save');
  
  if (seedBtn) seedBtn.onclick = () => {
    $('config').value = JSON.stringify(seedPlan, null, 2);
  };
  
  if (saveBtn) saveBtn.onclick = saveStrategy;
  
  refresh();
}

const seedPlan = {
  ladder: {
    enabled: true,
    levels: [
      { kind: "multiple", multiple: 2.0, fraction: 0.25 },
      { kind: "multiple", multiple: 3.0, fraction: 0.25 },
      { kind: "multiple", multiple: 4.0, fraction: 0.25 }
    ]
  },
  trailing: {
    enabled: true,
    trail_bps: 1500,
    activation: { kind: "multiple", multiple: 2.0 },
    hard_stop_bps: 2500,
    intrabar_policy: "STOP_FIRST"
  },
  indicator: {
    enabled: true,
    mode: "ANY",
    rules: [
      { type: "ichimoku_cross", tenkan: 9, kijun: 26, direction: "bearish" },
      { type: "ema_cross", fast: 9, slow: 21, direction: "bearish", source: "close" },
      { type: "rsi_cross", period: 14, level: 50, direction: "down", source: "close" }
    ]
  },
  max_hold_ms: 3600000,
  min_hold_candles_for_indicator: 3
};

async function refresh() {
  const res = await fetch("/api/strategies");
  const rows = await res.json();
  const tbl = $("tbl");
  if (!tbl) return;
  const tbody = tbl.querySelector("tbody");
  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><code>${r.strategy_id}</code></td><td>${r.name}</td><td>${r.created_at}</td>`;
    tbody.appendChild(tr);
  }
}

async function saveStrategy() {
  $("msg").textContent = "";
  const name = $("name").value.trim();
  const config_json = $("config").value.trim();

  if (!name) { $("msg").textContent = "Name required."; return; }

  try { JSON.parse(config_json); } catch { $("msg").textContent = "Config JSON invalid."; return; }

  const res = await fetch("/api/strategies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, config_json })
  });

  const out = await res.json();
  if (!res.ok) {
    $("msg").textContent = out.error ?? "Save failed.";
    return;
  }

  $("msg").textContent = `Saved: ${out.strategy_id}`;
  await refresh();
}

