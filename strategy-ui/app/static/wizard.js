// Strategy Wizard JavaScript
// Handles form interactions, validation, and JSON generation

document.addEventListener('DOMContentLoaded', function() {
  const entryMode = document.getElementById('entry-mode');
  const signalConfig = document.getElementById('signal-config');
  const signalType = document.getElementById('signal-type');
  const rsiConfig = document.getElementById('rsi-config');
  const emaConfig = document.getElementById('ema-config');
  const delayMode = document.getElementById('delay-mode');
  const delayConfig = document.getElementById('delay-config');
  const trailingEnabled = document.getElementById('trailing-enabled');
  const trailingConfig = document.getElementById('trailing-config');
  const timeExitEnabled = document.getElementById('time-exit-enabled');
  const timeExitConfig = document.getElementById('time-exit-config');
  const showJson = document.getElementById('show-json');
  const jsonPreview = document.getElementById('json-preview');
  const jsonStr = document.getElementById('json-str');
  const jsonStrHidden = document.getElementById('json-str-hidden');
  const strategySummary = document.getElementById('strategy-summary');
  const targetsContainer = document.getElementById('targets-container');
  const addTargetBtn = document.getElementById('add-target');
  const targetsSumError = document.getElementById('targets-sum-error');
  const strategyNameInput = document.getElementById('strategy-name-input');
  const strategyNameHidden = document.getElementById('strategy-name');
  const previewBtn = document.getElementById('preview-btn');
  
  // Update strategy name
  strategyNameInput.addEventListener('input', function() {
    strategyNameHidden.value = this.value;
  });
  
  // Entry mode toggle
  entryMode.addEventListener('change', function() {
    signalConfig.classList.toggle('hidden', this.value !== 'signal');
    updateStrategy();
  });
  
  // Signal type toggle
  signalType.addEventListener('change', function() {
    rsiConfig.classList.toggle('hidden', this.value !== 'rsi_below');
    emaConfig.classList.toggle('hidden', this.value !== 'ema_cross');
    updateStrategy();
  });
  
  // Delay mode toggle
  delayMode.addEventListener('change', function() {
    delayConfig.classList.toggle('hidden', this.value !== 'candles');
    updateStrategy();
  });
  
  // Trailing enabled toggle
  trailingEnabled.addEventListener('change', function() {
    trailingConfig.classList.toggle('hidden', !this.checked);
    updateStrategy();
  });
  
  // Time exit enabled toggle
  timeExitEnabled.addEventListener('change', function() {
    timeExitConfig.classList.toggle('hidden', !this.checked);
    updateStrategy();
  });
  
  // Show JSON toggle
  showJson.addEventListener('change', function() {
    jsonPreview.classList.toggle('hidden', !this.checked);
    if (this.checked) {
      updateStrategy();
    }
  });
  
  // Add target button
  addTargetBtn.addEventListener('click', function() {
    const row = document.createElement('div');
    row.className = 'target-row mb-4 p-4 border rounded';
    row.innerHTML = `
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-2">Size (%)</label>
          <input type="number" name="target_size[]" class="target-size w-full p-2 border rounded" min="0" max="100" value="25" step="0.1" required>
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Profit (%)</label>
          <input type="number" name="target_profit[]" class="target-profit w-full p-2 border rounded" min="0" value="10" step="0.1" required>
        </div>
      </div>
      <button type="button" class="remove-target text-red-600 hover:underline mt-2">Remove</button>
    `;
    targetsContainer.appendChild(row);
    
    // Add remove handler
    row.querySelector('.remove-target').addEventListener('click', function() {
      row.remove();
      updateStrategy();
    });
    
    // Add input handlers
    row.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', updateStrategy);
    });
    
    updateStrategy();
  });
  
  // Remove target handlers (for existing targets)
  document.querySelectorAll('.remove-target').forEach(btn => {
    btn.addEventListener('click', function() {
      this.closest('.target-row').remove();
      updateStrategy();
    });
  });
  
  // Update strategy on any input change
  document.querySelectorAll('input, select').forEach(input => {
    input.addEventListener('input', updateStrategy);
    input.addEventListener('change', updateStrategy);
  });
  
  // Preview button
  previewBtn.addEventListener('click', function() {
    updateStrategy();
    showJson.checked = true;
    jsonPreview.classList.remove('hidden');
  });
  
  function updateStrategy() {
    const strategy = buildStrategy();
    updateSummary(strategy);
    const jsonString = JSON.stringify(strategy, null, 2);
    // Always update JSON (even if hidden) so form submission works
    jsonStr.value = jsonString;
    if (jsonStrHidden) {
      jsonStrHidden.value = JSON.stringify(strategy); // Compact version for submission
    }
    validateTargets();
  }
  
  function buildStrategy() {
    const entryMode = document.getElementById('entry-mode').value;
    const entry = { mode: entryMode };
    
    if (entryMode === 'signal') {
      const signalType = document.getElementById('signal-type').value;
      const signal = { type: signalType };
      
      if (signalType === 'rsi_below') {
        signal.period = parseInt(document.getElementById('rsi-period').value) || 14;
        signal.value = parseFloat(document.getElementById('rsi-value').value) || 30;
      } else if (signalType === 'ema_cross') {
        signal.fast = parseInt(document.getElementById('ema-fast').value) || 12;
        signal.slow = parseInt(document.getElementById('ema-slow').value) || 26;
        signal.direction = document.getElementById('ema-direction').value || 'bull';
      }
      
      entry.signal = signal;
    }
    
    const delayMode = document.getElementById('delay-mode').value;
    if (delayMode === 'candles') {
      entry.delay = {
        mode: 'candles',
        n: parseInt(document.getElementById('delay-n').value) || 0
      };
    } else {
      entry.delay = { mode: 'none' };
    }
    
    const stops = {
      stop_loss_pct: parseFloat(document.getElementById('stop-loss-pct').value) || 0,
      break_even_after_first_target: document.getElementById('break-even-after-first').checked
    };
    
    const targets = [];
    document.querySelectorAll('.target-row').forEach(row => {
      const size = parseFloat(row.querySelector('.target-size').value) || 0;
      const profit = parseFloat(row.querySelector('.target-profit').value) || 0;
      if (size > 0 && profit > 0) {
        targets.push({ size_pct: size, profit_pct: profit });
      }
    });
    
    const exits = {
      targets: targets.sort((a, b) => a.profit_pct - b.profit_pct)
    };
    
    if (document.getElementById('trailing-enabled').checked) {
      exits.trailing = {
        enabled: true,
        trail_pct: parseFloat(document.getElementById('trail-pct').value) || 6,
        activate_profit_pct: parseFloat(document.getElementById('trail-activate').value) || 12
      };
    } else {
      exits.trailing = { enabled: false };
    }
    
    if (document.getElementById('time-exit-enabled').checked) {
      exits.time_exit = {
        enabled: true,
        max_candles_in_trade: parseInt(document.getElementById('max-candles-in-trade').value) || 100
      };
    } else {
      exits.time_exit = { enabled: false };
    }
    
    const execution = {
      fill_model: document.getElementById('fill-model').value || 'close',
      fee_bps: parseFloat(document.getElementById('fee-bps').value) || 0,
      slippage_bps: parseFloat(document.getElementById('slippage-bps').value) || 0
    };
    
    return { entry, exits, stops, execution };
  }
  
  function updateSummary(strategy) {
    const parts = [];
    
    // Entry
    if (strategy.entry.mode === 'immediate') {
      parts.push('Entry: Immediate');
    } else {
      const sig = strategy.entry.signal;
      if (sig.type === 'rsi_below') {
        parts.push(`Entry: RSI(${sig.period}) < ${sig.value}`);
      } else if (sig.type === 'ema_cross') {
        parts.push(`Entry: EMA(${sig.fast}/${sig.slow}) ${sig.direction === 'bull' ? 'bullish' : 'bearish'} cross`);
      }
    }
    
    if (strategy.entry.delay?.mode === 'candles' && strategy.entry.delay.n > 0) {
      parts.push(`Wait ${strategy.entry.delay.n} candles`);
    }
    
    // Stops
    if (strategy.stops.stop_loss_pct > 0) {
      parts.push(`Stop: -${strategy.stops.stop_loss_pct}%`);
    }
    if (strategy.stops.break_even_after_first_target) {
      parts.push('Break-even after first target');
    }
    
    // Exits
    if (strategy.exits.targets.length > 0) {
      const targetStrs = strategy.exits.targets.map(t => `${t.size_pct}% at +${t.profit_pct}%`);
      parts.push(`Take profit: ${targetStrs.join(', ')}`);
    }
    
    if (strategy.exits.trailing?.enabled) {
      parts.push(`Trail: ${strategy.exits.trailing.trail_pct}% after +${strategy.exits.trailing.activate_profit_pct}%`);
    }
    
    if (strategy.exits.time_exit?.enabled) {
      parts.push(`Time exit: ${strategy.exits.time_exit.max_candles_in_trade} candles`);
    }
    
    // Execution
    parts.push(`Fill: ${strategy.execution.fill_model}`);
    parts.push(`Fees: ${strategy.execution.fee_bps} bps, Slippage: ${strategy.execution.slippage_bps} bps`);
    
    strategySummary.innerHTML = '<p class="font-semibold">' + parts.join('.<br>') + '.</p>';
  }
  
  function validateTargets() {
    let sum = 0;
    document.querySelectorAll('.target-size').forEach(input => {
      sum += parseFloat(input.value) || 0;
    });
    
    if (sum > 100.01) {
      targetsSumError.textContent = `Target sizes sum to ${sum.toFixed(1)}% (must be <= 100%)`;
      targetsSumError.classList.remove('hidden');
      return false;
    } else {
      targetsSumError.classList.add('hidden');
      return true;
    }
  }
  
  // Initial update
  updateStrategy();
});

