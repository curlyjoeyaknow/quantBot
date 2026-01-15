const $ = (id) => document.getElementById(id);

let killSwitchConfig = null;
let strategies = [];

async function loadKillSwitches() {
  try {
    const res = await fetch('/api/governance/kill-switches');
    killSwitchConfig = await res.json();
    renderKillSwitches();
  } catch (e) {
    console.error('Failed to load kill switches:', e);
  }
}

async function loadStrategies() {
  try {
    const res = await fetch('/api/strategies');
    strategies = await res.json();
    renderApprovalTable();
  } catch (e) {
    console.error('Failed to load strategies:', e);
  }
}

function renderKillSwitches() {
  if (!killSwitchConfig) return;

  // Global kill switch
  const globalActive = killSwitchConfig.global?.state?.enabled ?? false;
  $("#globalStatus").textContent = globalActive ? 'ACTIVE' : 'Inactive';
  $("#globalStatus").style.color = globalActive ? 'red' : 'green';
  $("#globalKillSwitch").textContent = globalActive ? 'Deactivate Global Kill Switch' : 'Activate Global Kill Switch';

  // Daily loss limit
  const dailyLoss = killSwitchConfig.dailyLossLimit?.currentDailyLossUsd ?? 0;
  const maxDailyLoss = killSwitchConfig.dailyLossLimit?.maxDailyLossUsd ?? 1000;
  $("#currentDailyLoss").textContent = dailyLoss.toFixed(2);
  $("#maxDailyLoss").value = maxDailyLoss;
  
  const dailyLossActive = killSwitchConfig.dailyLossLimit?.state?.enabled ?? false;
  $("#dailyLossStatus").textContent = dailyLossActive ? 'BREACHED' : 'OK';
  $("#dailyLossStatus").style.color = dailyLossActive ? 'red' : 'green';

  // Drawdown limit
  const drawdown = killSwitchConfig.drawdownLimit?.currentDrawdownPercent ?? 0;
  const maxDrawdown = killSwitchConfig.drawdownLimit?.maxDrawdownPercent ?? 20;
  $("#currentDrawdown").textContent = drawdown.toFixed(1);
  $("#maxDrawdown").value = maxDrawdown;
  
  const drawdownActive = killSwitchConfig.drawdownLimit?.state?.enabled ?? false;
  $("#drawdownStatus").textContent = drawdownActive ? 'BREACHED' : 'OK';
  $("#drawdownStatus").style.color = drawdownActive ? 'red' : 'green';
}

function renderApprovalTable() {
  const tbody = $("#tblApproval").querySelector("tbody");
  tbody.innerHTML = "";

  if (strategies.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--muted);">No strategies</td></tr>';
    return;
  }

  strategies.forEach(strategy => {
    const tr = document.createElement("tr");
    
    const status = strategy.status || 'draft';
    const statusColor = 
      status === 'live' ? 'green' :
      status === 'approved' ? 'blue' :
      status === 'deprecated' ? 'gray' : 'orange';

    tr.innerHTML = `
      <td>${strategy.name}</td>
      <td><span style="color: ${statusColor};">${status}</span></td>
      <td>10</td>
      <td>40%</td>
      <td>20%</td>
      <td><button class="btn-small" onclick="viewChecklist('${strategy.strategy_id}')">View</button></td>
      <td>
        ${status === 'draft' ? `<button class="btn-small" onclick="approveStrategy('${strategy.strategy_id}')">Approve</button>` : ''}
        ${status === 'approved' ? `<button class="btn-small" onclick="goLive('${strategy.strategy_id}')">Go Live</button>` : ''}
        ${status === 'live' ? `<button class="btn-small btn-danger" onclick="deprecateStrategy('${strategy.strategy_id}')">Deprecate</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

$("#globalKillSwitch").onclick = async () => {
  const globalActive = killSwitchConfig?.global?.state?.enabled ?? false;
  
  if (globalActive) {
    if (!confirm('Deactivate global kill switch? All strategies will resume.')) return;
  } else {
    if (!confirm('Activate global kill switch? All strategies will be paused immediately.')) return;
  }

  try {
    const res = await fetch('/api/governance/kill-switches/global', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: !globalActive,
        reason: globalActive ? undefined : 'Manual activation',
      })
    });

    if (res.ok) {
      await loadKillSwitches();
    } else {
      alert('Failed to toggle global kill switch');
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
};

$("#manageStrategyKillSwitches").onclick = () => {
  alert('Strategy kill switch management UI coming soon');
};

window.viewChecklist = (strategyId) => {
  const strategy = strategies.find(s => s.strategy_id === strategyId);
  if (!strategy) return;

  let html = `<h3 style="margin-top: 0;">Approval Checklist: ${strategy.name}</h3>`;
  html += '<ul>';
  html += '<li>✓ Minimum 10 trades in backtest</li>';
  html += '<li>✓ Win rate ≥ 40%</li>';
  html += '<li>✓ Max drawdown ≤ 20%</li>';
  html += '<li>✓ Positive expectancy (avg R > 0)</li>';
  html += '<li>✓ Profit factor > 1.2</li>';
  html += '<li>✓ Walk-forward validation passed</li>';
  html += '<li>✓ Risk management rules defined</li>';
  html += '<li>✓ Position sizing configured</li>';
  html += '</ul>';

  $("#checklist").innerHTML = html;
};

window.approveStrategy = async (strategyId) => {
  if (!confirm('Approve this strategy? It will be eligible to go live.')) return;

  try {
    const res = await fetch(`/api/strategies/${strategyId}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        approved_by: 'admin',
      })
    });

    if (res.ok) {
      await loadStrategies();
    } else {
      alert('Failed to approve strategy');
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
};

window.goLive = async (strategyId) => {
  if (!confirm('Deploy this strategy to live trading?')) return;

  try {
    const res = await fetch(`/api/strategies/${strategyId}/go-live`, {
      method: 'POST',
    });

    if (res.ok) {
      await loadStrategies();
    } else {
      alert('Failed to deploy strategy');
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
};

window.deprecateStrategy = async (strategyId) => {
  if (!confirm('Deprecate this strategy? It will be removed from live trading.')) return;

  try {
    const res = await fetch(`/api/strategies/${strategyId}/deprecate`, {
      method: 'POST',
    });

    if (res.ok) {
      await loadStrategies();
    } else {
      alert('Failed to deprecate strategy');
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
};

loadKillSwitches();
loadStrategies();

