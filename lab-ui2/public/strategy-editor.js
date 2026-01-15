const $ = (id) => document.getElementById(id);

const urlParams = new URLSearchParams(window.location.search);
const strategyId = urlParams.get('id');
const mode = urlParams.get('mode') || 'edit';

let originalStrategy = null;

async function loadStrategy() {
  if (!strategyId) {
    $("#msg").textContent = "No strategy ID provided";
    return;
  }

  const res = await fetch(`/api/strategies/${strategyId}`);
  if (!res.ok) {
    $("#msg").textContent = "Failed to load strategy";
    return;
  }

  originalStrategy = await res.json();
  $("#strategyId").value = originalStrategy.strategy_id;
  $("#name").value = originalStrategy.name;
  $("#config").value = originalStrategy.config_json;

  if (mode === 'view') {
    $("#title").textContent = "View Strategy";
    $("#name").readOnly = true;
    $("#config").readOnly = true;
    $("#save").disabled = true;
    $("#save").textContent = "Read-only mode";
  }

  formatJSON();
  validateConfig();
}

function formatJSON() {
  try {
    const parsed = JSON.parse($("#config").value);
    $("#config").value = JSON.stringify(parsed, null, 2);
    $("#msg").textContent = "✓ Formatted";
    $("#msg").style.color = "green";
    setTimeout(() => { $("#msg").textContent = ""; }, 2000);
  } catch (e) {
    $("#msg").textContent = `Cannot format: ${e.message}`;
    $("#msg").style.color = "red";
  }
}

function validateConfig() {
  const validationDiv = $("#validation");
  const previewDiv = $("#preview");
  
  try {
    const config = JSON.parse($("#config").value);
    
    // Build validation report
    const issues = [];
    const warnings = [];
    
    // Check for enabled strategies
    if (!config.ladder?.enabled && !config.trailing?.enabled && !config.indicator?.enabled) {
      warnings.push("No exit strategies enabled");
    }
    
    // Validate ladder
    if (config.ladder?.enabled) {
      if (!config.ladder.levels || config.ladder.levels.length === 0) {
        issues.push("Ladder enabled but no levels defined");
      } else {
        const totalFraction = config.ladder.levels.reduce((sum, l) => sum + (l.fraction || 0), 0);
        if (Math.abs(totalFraction - 1.0) > 0.01 && totalFraction > 1.0) {
          warnings.push(`Ladder fractions sum to ${totalFraction.toFixed(2)} (should be ≤ 1.0)`);
        }
      }
    }
    
    // Validate trailing
    if (config.trailing?.enabled) {
      if (!config.trailing.trail_bps) {
        issues.push("Trailing enabled but trail_bps not set");
      }
      if (!config.trailing.activation) {
        warnings.push("Trailing has no activation trigger");
      }
    }
    
    // Validate indicator
    if (config.indicator?.enabled) {
      if (!config.indicator.rules || config.indicator.rules.length === 0) {
        issues.push("Indicator enabled but no rules defined");
      }
    }
    
    // Build validation HTML
    let validationHTML = '<h3 style="margin-top: 0;">Validation Results</h3>';
    
    if (issues.length === 0 && warnings.length === 0) {
      validationHTML += '<p style="color: green;">✓ Configuration is valid</p>';
    } else {
      if (issues.length > 0) {
        validationHTML += '<h4 style="color: red;">Issues:</h4><ul>';
        issues.forEach(issue => {
          validationHTML += `<li style="color: red;">${issue}</li>`;
        });
        validationHTML += '</ul>';
      }
      
      if (warnings.length > 0) {
        validationHTML += '<h4 style="color: orange;">Warnings:</h4><ul>';
        warnings.forEach(warning => {
          validationHTML += `<li style="color: orange;">${warning}</li>`;
        });
        validationHTML += '</ul>';
      }
    }
    
    validationDiv.innerHTML = validationHTML;
    
    // Build preview HTML
    let previewHTML = '<h3 style="margin-top: 0;">Configuration Summary</h3>';
    
    if (config.ladder?.enabled) {
      previewHTML += '<h4>Ladder Exits</h4><ul>';
      config.ladder.levels.forEach((level, i) => {
        previewHTML += `<li>Level ${i + 1}: ${level.multiple}x @ ${(level.fraction * 100).toFixed(0)}%</li>`;
      });
      previewHTML += '</ul>';
    }
    
    if (config.trailing?.enabled) {
      previewHTML += '<h4>Trailing Stop</h4><ul>';
      previewHTML += `<li>Trail: ${config.trailing.trail_bps} bps</li>`;
      if (config.trailing.activation) {
        previewHTML += `<li>Activation: ${config.trailing.activation.multiple}x</li>`;
      }
      if (config.trailing.hard_stop_bps) {
        previewHTML += `<li>Hard stop: ${config.trailing.hard_stop_bps} bps</li>`;
      }
      previewHTML += '</ul>';
    }
    
    if (config.indicator?.enabled) {
      previewHTML += '<h4>Indicator Exits</h4><ul>';
      previewHTML += `<li>Mode: ${config.indicator.mode || 'ANY'}</li>`;
      previewHTML += `<li>Rules: ${config.indicator.rules?.length || 0}</li>`;
      previewHTML += '</ul>';
    }
    
    if (config.max_hold_ms) {
      previewHTML += `<p><strong>Max hold:</strong> ${(config.max_hold_ms / 3600000).toFixed(1)} hours</p>`;
    }
    
    previewDiv.innerHTML = previewHTML;
    
    $("#msg").textContent = "✓ Valid configuration";
    $("#msg").style.color = "green";
    
  } catch (e) {
    validationDiv.innerHTML = `<p style="color: red;">❌ Invalid JSON: ${e.message}</p>`;
    previewDiv.innerHTML = '<p style="color: #999;">Fix JSON errors to see preview</p>';
    $("#msg").textContent = `Invalid JSON: ${e.message}`;
    $("#msg").style.color = "red";
  }
}

$("#validate").onclick = validateConfig;
$("#format").onclick = formatJSON;

$("#save").onclick = async () => {
  if (mode === 'view') return;
  
  $("#msg").textContent = "";
  const name = $("#name").value.trim();
  const config_json = $("#config").value.trim();

  if (!name) {
    $("#msg").textContent = "Name required";
    $("#msg").style.color = "red";
    return;
  }

  try {
    JSON.parse(config_json);
  } catch (e) {
    $("#msg").textContent = `Invalid JSON: ${e.message}`;
    $("#msg").style.color = "red";
    return;
  }

  const res = await fetch(`/api/strategies/${strategyId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, config_json })
  });

  if (!res.ok) {
    const out = await res.json();
    $("#msg").textContent = out.error ?? "Save failed";
    $("#msg").style.color = "red";
    return;
  }

  $("#msg").textContent = "✓ Saved successfully";
  $("#msg").style.color = "green";
  
  setTimeout(() => {
    window.location.href = "/strategies";
  }, 1500);
};

// Auto-validate on load and on change
if (strategyId) {
  loadStrategy();
}

$("#config").addEventListener('input', () => {
  // Debounce validation
  clearTimeout(window.validationTimeout);
  window.validationTimeout = setTimeout(validateConfig, 500);
});

