const $ = (id) => document.getElementById(id);

let allEntries = [];
let allTags = new Set();

async function loadEntries() {
  try {
    const res = await fetch('/api/journal');
    allEntries = await res.json();
    
    // Extract unique tags
    allTags.clear();
    allEntries.forEach(entry => {
      if (entry.tags) {
        entry.tags.split(',').forEach(tag => allTags.add(tag.trim()));
      }
    });
    
    updateTagFilter();
    renderEntries(allEntries);
  } catch (e) {
    console.error('Failed to load journal entries:', e);
  }
}

function updateTagFilter() {
  const filterTag = $("#filterTag");
  const currentValue = filterTag.value;
  
  filterTag.innerHTML = '<option value="">All Tags</option>';
  Array.from(allTags).sort().forEach(tag => {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tag;
    filterTag.appendChild(option);
  });
  
  filterTag.value = currentValue;
}

function renderEntries(entries) {
  const container = $("#entries");
  
  if (entries.length === 0) {
    container.innerHTML = '<p style="color: #999;">No entries found</p>';
    return;
  }
  
  container.innerHTML = '';
  
  entries.forEach(entry => {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'journal-entry';
    entryDiv.style.cssText = 'background: rgba(16, 24, 38, 0.6); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px;';
    
    let html = `
      <h3 style="margin-top: 0;">${entry.title}</h3>
      <p style="color: var(--muted); font-size: 12px;">${new Date(entry.created_at).toLocaleString()}</p>
      <div style="white-space: pre-wrap; margin: 12px 0;">${entry.content}</div>
    `;
    
    if (entry.tags) {
      html += '<div style="margin-top: 12px;">';
      entry.tags.split(',').forEach(tag => {
        html += `<span class="badge" style="margin-right: 4px;">${tag.trim()}</span>`;
      });
      html += '</div>';
    }
    
    if (entry.linked_runs) {
      html += '<div style="margin-top: 12px; color: var(--muted); font-size: 12px;">';
      html += '<strong>Linked runs:</strong> ';
      entry.linked_runs.split(',').forEach((runId, i) => {
        if (i > 0) html += ', ';
        html += `<a href="/runs?id=${runId.trim()}" style="color: var(--accent);">${runId.trim()}</a>`;
      });
      html += '</div>';
    }
    
    html += `
      <div class="row" style="margin-top: 12px;">
        <button class="btn-small" onclick="editEntry('${entry.entry_id}')">Edit</button>
        <button class="btn-small btn-danger" onclick="deleteEntry('${entry.entry_id}')">Delete</button>
      </div>
    `;
    
    entryDiv.innerHTML = html;
    container.appendChild(entryDiv);
  });
}

$("#save").onclick = async () => {
  $("#msg").textContent = "";
  $("#msg").style.color = "";
  
  const title = $("#title").value.trim();
  const content = $("#content").value.trim();
  const tags = $("#tags").value.trim();
  const linkedRuns = $("#linkedRuns").value.trim();
  
  if (!title) {
    $("#msg").textContent = "Title required";
    $("#msg").style.color = "red";
    return;
  }
  
  if (!content) {
    $("#msg").textContent = "Content required";
    $("#msg").style.color = "red";
    return;
  }
  
  try {
    const res = await fetch('/api/journal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        content,
        tags: tags || undefined,
        linked_runs: linkedRuns || undefined,
      })
    });
    
    if (!res.ok) {
      $("#msg").textContent = "Failed to save entry";
      $("#msg").style.color = "red";
      return;
    }
    
    $("#msg").textContent = "✓ Entry saved";
    $("#msg").style.color = "green";
    
    // Clear form
    $("#title").value = "";
    $("#content").value = "";
    $("#tags").value = "";
    $("#linkedRuns").value = "";
    
    // Reload entries
    await loadEntries();
    
  } catch (e) {
    $("#msg").textContent = `Error: ${e.message}`;
    $("#msg").style.color = "red";
  }
};

$("#clear").onclick = () => {
  $("#title").value = "";
  $("#content").value = "";
  $("#tags").value = "";
  $("#linkedRuns").value = "";
  $("#msg").textContent = "";
};

$("#searchBtn").onclick = () => {
  const searchTerm = $("#search").value.toLowerCase();
  const filterTag = $("#filterTag").value;
  
  let filtered = allEntries;
  
  if (searchTerm) {
    filtered = filtered.filter(entry => 
      entry.title.toLowerCase().includes(searchTerm) ||
      entry.content.toLowerCase().includes(searchTerm)
    );
  }
  
  if (filterTag) {
    filtered = filtered.filter(entry => 
      entry.tags && entry.tags.split(',').some(tag => tag.trim() === filterTag)
    );
  }
  
  renderEntries(filtered);
};

$("#search").addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    $("#searchBtn").click();
  }
});

window.editEntry = (entryId) => {
  const entry = allEntries.find(e => e.entry_id === entryId);
  if (!entry) return;
  
  $("#title").value = entry.title;
  $("#content").value = entry.content;
  $("#tags").value = entry.tags || '';
  $("#linkedRuns").value = entry.linked_runs || '';
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.deleteEntry = async (entryId) => {
  if (!confirm('Delete this journal entry? This cannot be undone.')) return;
  
  try {
    const res = await fetch(`/api/journal/${entryId}`, { method: 'DELETE' });
    if (res.ok) {
      await loadEntries();
    } else {
      alert('Failed to delete entry');
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
};

loadEntries();

