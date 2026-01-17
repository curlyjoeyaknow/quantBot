const $ = (id) => document.getElementById(id);

const urlParams = new URLSearchParams(window.location.search);
const strategyIds = urlParams.get('ids')?.split(',') || [];

let strategies = [];

async function loadStrategies() {
  if (strategyIds.length < 2) {
    $("#comparison").innerHTML = '<p style="color: red;">Need at least 2 strategy IDs to compare</p>';
    return;
  }

  const promises = strategyIds.map(id => 
    fetch(`/api/strategies/${id}`).then(r => r.json())
  );

  try {
    strategies = await Promise.all(promises);
    renderComparison();
    analyzeDifferences();
  } catch (e) {
    $("#comparison").innerHTML = `<p style="color: red;">Failed to load strategies: ${e.message}</p>`;
  }
}

function renderComparison() {
  const comparisonDiv = $("#comparison");
  comparisonDiv.innerHTML = '';

  strategies.forEach((strategy, index) => {
    const config = JSON.parse(strategy.config_json);
    
    const column = document.createElement('div');
    column.className = 'strategy-column';
    
    let html = `
      <h3>Strategy ${index + 1}</h3>
      <p><strong>Name:</strong> ${strategy.name}</p>
      <p><strong>ID:</strong> <code>${strategy.strategy_id}</code></p>
      <p><strong>Created:</strong> ${new Date(strategy.created_at).toLocaleString()}</p>
      <hr />
    `;
    
    // Ladder
    if (config.ladder?.enabled) {
      html += '<h4>Ladder</h4><ul>';
      config.ladder.levels.forEach((level, i) => {
        html += `<li>${level.multiple}x @ ${(level.fraction * 100).toFixed(0)}%</li>`;
      });
      html += '</ul>';
    } else {
      html += '<p style="color: #999;">Ladder: disabled</p>';
    }
    
    // Trailing
    if (config.trailing?.enabled) {
      html += '<h4>Trailing</h4><ul>';
      html += `<li>Trail: ${config.trailing.trail_bps} bps</li>`;
      if (config.trailing.activation) {
        html += `<li>Activation: ${config.trailing.activation.multiple}x</li>`;
      }
      if (config.trailing.hard_stop_bps) {
        html += `<li>Hard stop: ${config.trailing.hard_stop_bps} bps</li>`;
      }
      html += `<li>Policy: ${config.trailing.intrabar_policy || 'STOP_FIRST'}</li>`;
      html += '</ul>';
    } else {
      html += '<p style="color: #999;">Trailing: disabled</p>';
    }
    
    // Indicator
    if (config.indicator?.enabled) {
      html += '<h4>Indicator</h4><ul>';
      html += `<li>Mode: ${config.indicator.mode || 'ANY'}</li>`;
      html += `<li>Rules: ${config.indicator.rules?.length || 0}</li>`;
      if (config.indicator.rules) {
        config.indicator.rules.forEach(rule => {
          html += `<li style="font-size: 0.9em;">${rule.type}</li>`;
        });
      }
      html += '</ul>';
    } else {
      html += '<p style="color: #999;">Indicator: disabled</p>';
    }
    
    // Other settings
    html += '<h4>Other Settings</h4><ul>';
    if (config.max_hold_ms) {
      html += `<li>Max hold: ${(config.max_hold_ms / 3600000).toFixed(1)}h</li>`;
    }
    if (config.min_hold_candles_for_indicator) {
      html += `<li>Min hold candles: ${config.min_hold_candles_for_indicator}</li>`;
    }
    html += '</ul>';
    
    column.innerHTML = html;
    comparisonDiv.appendChild(column);
  });
}

function analyzeDifferences() {
  const differencesDiv = $("#differences");
  const configs = strategies.map(s => JSON.parse(s.config_json));
  
  let html = '<h3 style="margin-top: 0;">Key Differences</h3>';
  
  const differences = [];
  
  // Compare ladder
  const ladderEnabled = configs.map(c => c.ladder?.enabled || false);
  if (!ladderEnabled.every(v => v === ladderEnabled[0])) {
    differences.push('Ladder enabled status differs');
  } else if (ladderEnabled[0]) {
    const levelCounts = configs.map(c => c.ladder?.levels?.length || 0);
    if (!levelCounts.every(v => v === levelCounts[0])) {
      differences.push(`Ladder level counts differ: ${levelCounts.join(' vs ')}`);
    }
  }
  
  // Compare trailing
  const trailingEnabled = configs.map(c => c.trailing?.enabled || false);
  if (!trailingEnabled.every(v => v === trailingEnabled[0])) {
    differences.push('Trailing enabled status differs');
  } else if (trailingEnabled[0]) {
    const trailBps = configs.map(c => c.trailing?.trail_bps || 0);
    if (!trailBps.every(v => v === trailBps[0])) {
      differences.push(`Trail BPS differs: ${trailBps.join(' vs ')}`);
    }
    
    const activationMult = configs.map(c => c.trailing?.activation?.multiple || null);
    if (!activationMult.every(v => v === activationMult[0])) {
      differences.push(`Trailing activation differs: ${activationMult.join(' vs ')}`);
    }
  }
  
  // Compare indicator
  const indicatorEnabled = configs.map(c => c.indicator?.enabled || false);
  if (!indicatorEnabled.every(v => v === indicatorEnabled[0])) {
    differences.push('Indicator enabled status differs');
  } else if (indicatorEnabled[0]) {
    const ruleCounts = configs.map(c => c.indicator?.rules?.length || 0);
    if (!ruleCounts.every(v => v === ruleCounts[0])) {
      differences.push(`Indicator rule counts differ: ${ruleCounts.join(' vs ')}`);
    }
  }
  
  // Compare max hold
  const maxHold = configs.map(c => c.max_hold_ms || null);
  if (!maxHold.every(v => v === maxHold[0])) {
    differences.push(`Max hold time differs: ${maxHold.map(h => h ? `${(h/3600000).toFixed(1)}h` : 'none').join(' vs ')}`);
  }
  
  if (differences.length === 0) {
    html += '<p style="color: green;">✓ Strategies are identical</p>';
  } else {
    html += '<ul>';
    differences.forEach(diff => {
      html += `<li>${diff}</li>`;
    });
    html += '</ul>';
  }
  
  // Similarity score
  const totalChecks = 10; // Rough estimate of comparison points
  const similarityScore = ((totalChecks - differences.length) / totalChecks * 100).toFixed(0);
  html += `<p><strong>Similarity Score:</strong> ${similarityScore}%</p>`;
  
  differencesDiv.innerHTML = html;
}

loadStrategies();

