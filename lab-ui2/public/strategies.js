const $ = (id) => document.getElementById(id);

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

let allStrategies = [];
let selectedStrategies = new Set();

function getStrategyType(config) {
  try {
    const parsed = JSON.parse(config);
    const types = [];
    if (parsed.ladder?.enabled) types.push('ladder');
    if (parsed.trailing?.enabled) types.push('trailing');
    if (parsed.indicator?.enabled) types.push('indicator');
    return types.length > 0 ? types.join('+') : 'basic';
  } catch {
    return 'unknown';
  }
}

function filterStrategies() {
  const searchTerm = $("#search").value.toLowerCase();
  const typeFilter = $("#filterType").value;
  
  return allStrategies.filter(s => {
    const matchesSearch = !searchTerm || 
      s.name.toLowerCase().includes(searchTerm) ||
      s.strategy_id.toLowerCase().includes(searchTerm);
    
    const matchesType = !typeFilter || s.type.includes(typeFilter);
    
    return matchesSearch && matchesType;
  });
}

function updateCounts() {
  const filtered = filterStrategies();
  $("#count").textContent = filtered.length;
  $("#selected").textContent = selectedStrategies.size;
}

function renderStrategies() {
  const filtered = filterStrategies();
  const tbody = $("#tbl").querySelector("tbody");
  tbody.innerHTML = "";
  
  for (const r of filtered) {
    const tr = document.createElement("tr");
    const isSelected = selectedStrategies.has(r.strategy_id);
    
    tr.innerHTML = `
      <td><input type="checkbox" class="strategy-select" data-id="${r.strategy_id}" ${isSelected ? 'checked' : ''} /></td>
      <td><code>${r.strategy_id}</code></td>
      <td>${r.name}</td>
      <td><span class="badge">${r.type}</span></td>
      <td>${new Date(r.created_at).toLocaleString()}</td>
      <td>
        <button class="btn-small" onclick="viewStrategy('${r.strategy_id}')">View</button>
        <button class="btn-small" onclick="editStrategy('${r.strategy_id}')">Edit</button>
        <button class="btn-small btn-danger" onclick="deleteStrategy('${r.strategy_id}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  
  // Add event listeners to checkboxes
  document.querySelectorAll('.strategy-select').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) {
        selectedStrategies.add(id);
      } else {
        selectedStrategies.delete(id);
      }
      updateCounts();
    });
  });
  
  updateCounts();
}

async function refresh() {
  const res = await fetch("/api/strategies");
  const rows = await res.json();
  allStrategies = rows.map(r => ({
    ...r,
    type: getStrategyType(r.config_json)
  }));
  renderStrategies();
}

$("#seed").onclick = () => {
  $("#config").value = JSON.stringify(seedPlan, null, 2);
};

$("#validate").onclick = () => {
  $("#msg").textContent = "";
  const config_json = $("#config").value.trim();
  
  try {
    const parsed = JSON.parse(config_json);
    // Basic validation
    if (!parsed.ladder && !parsed.trailing && !parsed.indicator) {
      $("#msg").textContent = "⚠️ Warning: No exit strategies enabled";
      $("#msg").style.color = "orange";
    } else {
      $("#msg").textContent = "✓ Valid JSON";
      $("#msg").style.color = "green";
    }
  } catch (e) {
    $("#msg").textContent = `❌ Invalid JSON: ${e.message}`;
    $("#msg").style.color = "red";
  }
};

$("#save").onclick = async () => {
  $("#msg").textContent = "";
  $("#msg").style.color = "";
  const name = $("#name").value.trim();
  const config_json = $("#config").value.trim();

  if (!name) { $("#msg").textContent = "Name required."; return; }

  try { JSON.parse(config_json); } catch { $("#msg").textContent = "Config JSON invalid."; return; }

  const res = await fetch("/api/strategies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, config_json })
  });

  const out = await res.json();
  if (!res.ok) {
    $("#msg").textContent = out.error ?? "Save failed.";
    return;
  }

  $("#msg").textContent = `✓ Saved: ${out.strategy_id}`;
  $("#msg").style.color = "green";
  $("#name").value = "";
  $("#config").value = "";
  await refresh();
};

$("#search").addEventListener('input', renderStrategies);
$("#filterType").addEventListener('change', renderStrategies);

$("#selectAll").addEventListener('change', (e) => {
  const filtered = filterStrategies();
  if (e.target.checked) {
    filtered.forEach(s => selectedStrategies.add(s.strategy_id));
  } else {
    filtered.forEach(s => selectedStrategies.delete(s.strategy_id));
  }
  renderStrategies();
});

$("#compare").onclick = () => {
  if (selectedStrategies.size < 2) {
    alert("Select at least 2 strategies to compare");
    return;
  }
  if (selectedStrategies.size > 3) {
    alert("Can only compare up to 3 strategies at once");
    return;
  }
  const ids = Array.from(selectedStrategies);
  window.location.href = `/strategy-compare?ids=${ids.join(',')}`;
};

window.viewStrategy = (id) => {
  window.location.href = `/strategy-editor?id=${id}&mode=view`;
};

window.editStrategy = (id) => {
  window.location.href = `/strategy-editor?id=${id}&mode=edit`;
};

window.deleteStrategy = async (id) => {
  if (!confirm('Delete this strategy? This cannot be undone.')) return;
  
  const res = await fetch(`/api/strategies/${id}`, { method: 'DELETE' });
  if (res.ok) {
    selectedStrategies.delete(id);
    await refresh();
  } else {
    alert('Failed to delete strategy');
  }
};

refresh();

