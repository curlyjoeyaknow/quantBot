const $ = (id) => document.getElementById(id);

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('runId')) {
  $("#runId").value = urlParams.get('runId');
}

let equityChart = null;
let drawdownChart = null;

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatDuration(ms) {
  const hours = ms / 3600000;
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

$("#load").onclick = async () => {
  $("#msg").textContent = "";
  $("#msg").style.color = "";

  const runId = $("#runId").value.trim();
  if (!runId) {
    $("#msg").textContent = "Run ID required";
    $("#msg").style.color = "red";
    return;
  }

  const initialCapital = parseFloat($("#initialCapital").value);
  const positionSizingMode = $("#positionSizingMode").value;
  const positionSizeValue = parseFloat($("#positionSizeValue").value);

  try {
    const res = await fetch(
      `/api/equity-curve/${runId}?initial_capital=${initialCapital}&position_sizing_mode=${positionSizingMode}&position_size_value=${positionSizeValue}`
    );

    if (!res.ok) {
      $("#msg").textContent = "Failed to load equity curve";
      $("#msg").style.color = "red";
      return;
    }

    const data = await res.json();
    
    renderMetrics(data.metrics);
    renderEquityChart(data.equity_curve);
    renderDrawdownChart(data.equity_curve);
    renderDrawdownPeriods(data.drawdown_periods);

    $("#msg").textContent = "✓ Loaded";
    $("#msg").style.color = "green";

  } catch (e) {
    $("#msg").textContent = `Error: ${e.message}`;
    $("#msg").style.color = "red";
  }
};

function renderMetrics(metrics) {
  $("#finalCapital").textContent = formatCurrency(metrics.final_capital);
  $("#totalPnl").textContent = formatCurrency(metrics.total_pnl);
  $("#totalPnl").style.color = metrics.total_pnl >= 0 ? 'green' : 'red';
  
  $("#pnlPercent").textContent = formatPercent(metrics.total_pnl_percent);
  $("#pnlPercent").style.color = metrics.total_pnl_percent >= 0 ? 'green' : 'red';
  
  $("#maxDrawdown").textContent = formatPercent(-metrics.max_drawdown_percent);
  $("#maxDrawdown").style.color = 'red';
  
  $("#sharpeRatio").textContent = metrics.sharpe_ratio.toFixed(2);
  $("#sharpeRatio").style.color = metrics.sharpe_ratio >= 1 ? 'green' : metrics.sharpe_ratio >= 0 ? 'orange' : 'red';
  
  $("#winRate").textContent = formatPercent(metrics.win_rate * 100);
  $("#totalTrades").textContent = metrics.total_trades;
  
  const wlRatio = metrics.losses > 0 ? (metrics.wins / metrics.losses).toFixed(2) : '∞';
  $("#wlRatio").textContent = wlRatio;
}

function renderEquityChart(equityCurve) {
  const ctx = $("#equityChart").getContext('2d');
  
  if (equityChart) {
    equityChart.destroy();
  }

  const labels = equityCurve.map(point => new Date(point.timestamp_ms).toLocaleString());
  const capitalData = equityCurve.map(point => point.capital);

  equityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Capital',
        data: capitalData,
        borderColor: 'rgb(122, 162, 255)',
        backgroundColor: 'rgba(122, 162, 255, 0.1)',
        fill: true,
        tension: 0.1,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: '#dbe7ff'
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `Capital: ${formatCurrency(context.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#93a4c7',
            maxRotation: 45,
            minRotation: 45
          },
          grid: {
            color: '#1d2a44'
          }
        },
        y: {
          ticks: {
            color: '#93a4c7',
            callback: function(value) {
              return formatCurrency(value);
            }
          },
          grid: {
            color: '#1d2a44'
          }
        }
      }
    }
  });
}

function renderDrawdownChart(equityCurve) {
  const ctx = $("#drawdownChart").getContext('2d');
  
  if (drawdownChart) {
    drawdownChart.destroy();
  }

  const labels = equityCurve.map(point => new Date(point.timestamp_ms).toLocaleString());
  const drawdownData = equityCurve.map(point => -point.drawdown_percent);

  drawdownChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Drawdown %',
        data: drawdownData,
        borderColor: 'rgb(255, 82, 82)',
        backgroundColor: 'rgba(255, 82, 82, 0.1)',
        fill: true,
        tension: 0.1,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: '#dbe7ff'
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `Drawdown: ${context.parsed.y.toFixed(2)}%`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#93a4c7',
            maxRotation: 45,
            minRotation: 45
          },
          grid: {
            color: '#1d2a44'
          }
        },
        y: {
          ticks: {
            color: '#93a4c7',
            callback: function(value) {
              return `${value.toFixed(1)}%`;
            }
          },
          grid: {
            color: '#1d2a44'
          }
        }
      }
    }
  });
}

function renderDrawdownPeriods(periods) {
  const tbody = $("#tblDrawdowns").querySelector("tbody");
  tbody.innerHTML = "";

  if (periods.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--muted);">No drawdown periods</td></tr>';
    return;
  }

  periods.forEach(period => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(period.start_ts).toLocaleString()}</td>
      <td>${new Date(period.end_ts).toLocaleString()}</td>
      <td>${formatDuration(period.duration_ms)}</td>
      <td style="color: red;">${formatPercent(-period.drawdown_pct)}</td>
      <td>Recovered</td>
    `;
    tbody.appendChild(tr);
  });
}

// Auto-load if runId is in URL
if (urlParams.get('runId')) {
  $("#load").click();
}

