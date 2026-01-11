const $ = (id) => document.getElementById(id);

async function loadStrategies() {
  const res = await fetch("/api/strategies");
  const rows = await res.json();
  const sel = $("#strategy");
  sel.innerHTML = "";
  for (const r of rows) {
    const opt = document.createElement("option");
    opt.value = r.strategy_id;
    opt.textContent = `${r.name} (${r.strategy_id})`;
    sel.appendChild(opt);
  }
}

async function loadRuns() {
  const res = await fetch("/api/runs");
  const rows = await res.json();
  const tbody = $("#tbl").querySelector("tbody");
  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><code>${r.run_id}</code></td><td><code>${r.strategy_id}</code></td><td>${r.status}</td><td>${r.created_at}</td>`;
    tbody.appendChild(tr);
  }
}

$("#run").onclick = async () => {
  $("#msg").textContent = "";

  const payload = {
    strategy_id: $("#strategy").value,
    interval: $("#interval").value,
    from: $("#from").value,
    to: $("#to").value,
    caller_filter: ($("#filter").value || "").trim() || undefined,
    taker_fee_bps: Number($("#fee").value),
    slippage_bps: Number($("#slip").value),
    position_usd: Number($("#pos").value)
  };

  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const out = await res.json();
  if (!res.ok) {
    $("#msg").textContent = out.error ?? "Run start failed.";
    return;
  }

  $("#msg").textContent = `Started run: ${out.run_id}`;
  await loadRuns();
};

loadStrategies().then(loadRuns);
setInterval(loadRuns, 5000);

