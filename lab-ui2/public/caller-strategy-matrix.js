const $ = (id) => document.getElementById(id);

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('runId')) {
  $("#runId").value = urlParams.get('runId');
}

let matrixData = [];

$("#load").onclick = async () => {
  $("#msg").textContent = "";
  $("#msg").style.color = "";

  const runId = $("#runId").value.trim();
  if (!runId) {
    $("#msg").textContent = "Run ID required";
    $("#msg").style.color = "red";
    return;
  }

  const metric = $("#metric").value;

  try {
    const res = await fetch(`/api/caller-strategy-matrix/${runId}?metric=${metric}`);

    if (!res.ok) {
      $("#msg").textContent = "Failed to load matrix";
      $("#msg").style.color = "red";
      return;
    }

    matrixData = await res.json();
    
    if (matrixData.length === 0) {
      $("#msg").textContent = "No data available (feature coming soon)";
      $("#msg").style.color = "orange";
      renderMockMatrix();
      return;
    }

    renderMatrix(matrixData, metric);
    renderInsights(matrixData, metric);

    $("#msg").textContent = "✓ Loaded";
    $("#msg").style.color = "green";

  } catch (e) {
    $("#msg").textContent = `Error: ${e.message}`;
    $("#msg").style.color = "red";
  }
};

function renderMockMatrix() {
  // Mock data for demonstration
  const callers = ['Caller A', 'Caller B', 'Caller C', 'Caller D'];
  const strategies = ['Strategy 1', 'Strategy 2', 'Strategy 3'];
  
  const mockData = callers.map(caller => ({
    caller,
    strategies: strategies.reduce((acc, strat) => {
      acc[strat] = (Math.random() - 0.3) * 2; // Random R between -0.6 and 1.4
      return acc;
    }, {})
  }));

  renderMatrix(mockData, 'avg_r');
  
  $("#insights").innerHTML = `
    <h3 style="margin-top: 0;">Mock Data</h3>
    <p>This is demonstration data. Real data will be available when optimization runs complete.</p>
    <p><strong>How to interpret:</strong></p>
    <ul>
      <li>Green cells: Strategy performs well for this caller</li>
      <li>Red cells: Strategy performs poorly for this caller</li>
      <li>Gray cells: No data or neutral performance</li>
    </ul>
  `;
}

function renderMatrix(data, metric) {
  if (data.length === 0) return;

  const table = $("#matrix");
  const thead = table.querySelector("thead tr");
  const tbody = table.querySelector("tbody");

  // Get unique strategies
  const strategies = new Set();
  data.forEach(row => {
    Object.keys(row.strategies || {}).forEach(s => strategies.add(s));
  });
  const strategyList = Array.from(strategies).sort();

  // Build header
  thead.innerHTML = '<th>Caller</th>';
  strategyList.forEach(strategy => {
    const th = document.createElement('th');
    th.textContent = strategy;
    thead.appendChild(th);
  });

  // Build body
  tbody.innerHTML = "";
  data.forEach(row => {
    const tr = document.createElement("tr");
    
    // Caller name
    const callerTd = document.createElement("td");
    callerTd.textContent = row.caller;
    tr.appendChild(callerTd);

    // Strategy cells
    strategyList.forEach(strategy => {
      const td = document.createElement("td");
      const value = row.strategies?.[strategy];
      
      if (value !== undefined && value !== null) {
        td.textContent = value.toFixed(2);
        
        // Color based on value
        if (value > 0.5) {
          td.className = 'cell-positive';
        } else if (value < 0) {
          td.className = 'cell-negative';
        } else {
          td.className = 'cell-neutral';
        }
      } else {
        td.textContent = '-';
        td.className = 'cell-neutral';
      }
      
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

function renderInsights(data, metric) {
  if (data.length === 0) return;

  let html = '<h3 style="margin-top: 0;">Key Insights</h3>';

  // Find best caller-strategy combinations
  const combinations = [];
  data.forEach(row => {
    Object.entries(row.strategies || {}).forEach(([strategy, value]) => {
      if (value !== undefined && value !== null) {
        combinations.push({
          caller: row.caller,
          strategy,
          value
        });
      }
    });
  });

  combinations.sort((a, b) => b.value - a.value);

  html += '<h4>Top 5 Caller-Strategy Combinations:</h4><ol>';
  combinations.slice(0, 5).forEach(combo => {
    html += `<li><strong>${combo.caller}</strong> + <strong>${combo.strategy}</strong>: ${combo.value.toFixed(2)}</li>`;
  });
  html += '</ol>';

  html += '<h4>Worst 5 Caller-Strategy Combinations:</h4><ol>';
  combinations.slice(-5).reverse().forEach(combo => {
    html += `<li><strong>${combo.caller}</strong> + <strong>${combo.strategy}</strong>: ${combo.value.toFixed(2)}</li>`;
  });
  html += '</ol>';

  $("#insights").innerHTML = html;
}

// Auto-load if runId is in URL
if (urlParams.get('runId')) {
  $("#load").click();
}

