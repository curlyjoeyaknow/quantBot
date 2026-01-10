<template>
  <div class="app">
    <header class="header">
      <h1>📊 Test Coverage Dashboard</h1>
      <div class="upload-section">
        <label class="upload-btn">
          <input
            type="file"
            accept=".json"
            @change="handleFileUpload"
            ref="fileInput"
          />
          📁 Upload Coverage JSON
        </label>
        <button v-if="coverageData" @click="clearData" class="clear-btn">
          Clear
        </button>
      </div>
    </header>

    <div v-if="error" class="error">
      ❌ {{ error }}
    </div>

    <div v-if="coverageData" class="dashboard">
      <!-- Overall Coverage Card -->
      <div class="card overall-card">
        <h2>Overall Coverage</h2>
        <div class="coverage-display">
          <div class="coverage-percentage" :class="coverageClass">
            {{ overallCoverage.toFixed(2) }}%
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{ width: `${overallCoverage}%` }"
              :class="coverageClass"
            ></div>
          </div>
          <div class="stats">
            <div class="stat">
              <span class="stat-label">Covered:</span>
              <span class="stat-value">{{ covered }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Total:</span>
              <span class="stat-value">{{ total }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Skipped:</span>
              <span class="stat-value">{{ skipped }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Distribution Histogram -->
      <div v-if="distributionData.length > 0" class="card">
        <h2>Coverage Distribution</h2>
        <div class="histogram">
          <div
            v-for="(bucket, idx) in distributionData"
            :key="idx"
            class="histogram-row"
          >
            <div class="bucket-label">{{ bucket.label }}</div>
            <div class="bucket-bar-container">
              <div
                class="bucket-bar"
                :style="{ width: `${bucket.percentage}%` }"
                :class="getBucketClass(bucket.range)"
              ></div>
            </div>
            <div class="bucket-count">{{ bucket.count }} files</div>
          </div>
        </div>
      </div>

      <!-- File List -->
      <div v-if="fileCoverage.length > 0" class="card">
        <h2>File Coverage Details</h2>
        <div class="file-list-header">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search files..."
            class="search-input"
          />
          <select v-model="sortBy" class="sort-select">
            <option value="coverage">Sort by Coverage</option>
            <option value="name">Sort by Name</option>
          </select>
        </div>
        <div class="file-list">
          <div
            v-for="file in filteredAndSortedFiles"
            :key="file.path"
            class="file-item"
            :class="getFileClass(file.coverage)"
          >
            <div class="file-path">{{ file.path }}</div>
            <div class="file-coverage">
              <div class="file-coverage-bar">
                <div
                  class="file-coverage-fill"
                  :style="{ width: `${file.coverage}%` }"
                ></div>
              </div>
              <span class="file-coverage-text">{{ file.coverage.toFixed(1) }}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">📈</div>
      <h2>No Coverage Data</h2>
      <p>Upload a coverage JSON file to get started</p>
      <p class="hint">
        Expected formats: coverage-summary.json or coverage-final.json
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const fileInput = ref(null);
const coverageData = ref(null);
const error = ref(null);
const searchQuery = ref('');
const sortBy = ref('coverage');

const overallCoverage = computed(() => {
  if (!coverageData.value) return 0;
  const lines = getTotalLines(coverageData.value);
  return lines ? Number(lines.pct) : 0;
});

const covered = computed(() => {
  if (!coverageData.value) return 0;
  const lines = getTotalLines(coverageData.value);
  return lines ? Number(lines.covered ?? 0) : 0;
});

const total = computed(() => {
  if (!coverageData.value) return 0;
  const lines = getTotalLines(coverageData.value);
  return lines ? Number(lines.total ?? 0) : 0;
});

const skipped = computed(() => {
  if (!coverageData.value) return 0;
  const lines = getTotalLines(coverageData.value);
  return lines ? Number(lines.skipped ?? 0) : 0;
});

const coverageClass = computed(() => {
  const pct = overallCoverage.value;
  if (pct >= 90) return 'excellent';
  if (pct >= 75) return 'good';
  if (pct >= 50) return 'fair';
  return 'poor';
});

const distributionData = computed(() => {
  if (!coverageData.value || !fileCoverage.value.length) return [];
  
  const buckets = Array.from({ length: 11 }, () => ({ count: 0, range: 0 }));
  
  fileCoverage.value.forEach(file => {
    const pct = file.coverage;
    const idx = pct >= 100 ? 10 : Math.max(0, Math.min(9, Math.floor(pct / 10)));
    buckets[idx].count++;
    buckets[idx].range = idx * 10;
  });
  
  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  
  return buckets.map((bucket, idx) => ({
    label: idx === 10 ? '100' : `${String(idx * 10).padStart(2, '0')}-${String(idx * 10 + 9).padStart(2, '0')}`,
    count: bucket.count,
    range: bucket.range,
    percentage: (bucket.count / maxCount) * 100
  }));
});

const fileCoverage = computed(() => {
  if (!coverageData.value) return [];
  
  // Try coverage-final.json format (per-file data)
  if (typeof coverageData.value === 'object' && !coverageData.value.total) {
    const files = [];
    for (const [path, entry] of Object.entries(coverageData.value)) {
      const pct = fileLinePct(entry);
      if (pct != null) {
        files.push({ path, coverage: pct });
      }
    }
    return files;
  }
  
  // Try coverage-summary.json format (aggregated per-file)
  if (coverageData.value.total) {
    const files = [];
    for (const [path, data] of Object.entries(coverageData.value)) {
      if (path === 'total') continue;
      if (data.lines?.pct != null) {
        files.push({ path, coverage: Number(data.lines.pct) });
      }
    }
    return files;
  }
  
  return [];
});

const filteredAndSortedFiles = computed(() => {
  let files = [...fileCoverage.value];
  
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    files = files.filter(f => f.path.toLowerCase().includes(query));
  }
  
  if (sortBy.value === 'coverage') {
    files.sort((a, b) => a.coverage - b.coverage);
  } else {
    files.sort((a, b) => a.path.localeCompare(b.path));
  }
  
  return files;
});

function getTotalLines(json) {
  if (json?.total?.lines?.pct != null) return json.total.lines;
  if (json?.total?.statements?.pct != null) return json.total.statements;
  if (json?.lines?.pct != null) return json.lines;
  return null;
}

function fileLinePct(entry) {
  const lines = entry?.l;
  if (!lines) return null;
  const counts = Object.values(lines);
  if (counts.length === 0) return null;
  const covered = counts.filter(n => Number(n) > 0).length;
  const total = counts.length;
  return (covered / total) * 100;
}

function getBucketClass(range) {
  if (range >= 90) return 'excellent';
  if (range >= 75) return 'good';
  if (range >= 50) return 'fair';
  return 'poor';
}

function getFileClass(coverage) {
  if (coverage >= 90) return 'excellent';
  if (coverage >= 75) return 'good';
  if (coverage >= 50) return 'fair';
  return 'poor';
}

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  error.value = null;
  const reader = new FileReader();
  
  reader.onload = (e) => {
    try {
      const json = JSON.parse(e.target.result);
      coverageData.value = json;
    } catch (err) {
      error.value = `Failed to parse JSON: ${err.message}`;
      coverageData.value = null;
    }
  };
  
  reader.onerror = () => {
    error.value = 'Failed to read file';
    coverageData.value = null;
  };
  
  reader.readAsText(file);
}

function clearData() {
  coverageData.value = null;
  error.value = null;
  if (fileInput.value) {
    fileInput.value.value = '';
  }
}
</script>

<style scoped>
.app {
  min-height: 100vh;
}

.header {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.header h1 {
  font-size: 28px;
  color: #333;
  margin: 0;
}

.upload-section {
  display: flex;
  gap: 12px;
  align-items: center;
}

.upload-btn {
  background: #667eea;
  color: white;
  padding: 10px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
  display: inline-block;
}

.upload-btn:hover {
  background: #5568d3;
}

.upload-btn input {
  display: none;
}

.clear-btn {
  background: #ef4444;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
}

.clear-btn:hover {
  background: #dc2626;
}

.error {
  background: #fee2e2;
  color: #991b1b;
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 24px;
  border: 1px solid #fecaca;
}

.dashboard {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.card h2 {
  font-size: 20px;
  color: #333;
  margin-bottom: 20px;
}

.overall-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.overall-card h2 {
  color: white;
}

.coverage-display {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.coverage-percentage {
  font-size: 64px;
  font-weight: bold;
  text-align: center;
}

.progress-bar {
  width: 100%;
  height: 24px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 12px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  transition: width 0.5s ease;
  border-radius: 12px;
}

.progress-fill.excellent {
  background: #10b981;
}

.progress-fill.good {
  background: #3b82f6;
}

.progress-fill.fair {
  background: #f59e0b;
}

.progress-fill.poor {
  background: #ef4444;
}

.stats {
  display: flex;
  justify-content: space-around;
  gap: 16px;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-label {
  font-size: 14px;
  opacity: 0.9;
}

.stat-value {
  font-size: 24px;
  font-weight: bold;
}

.histogram {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.histogram-row {
  display: grid;
  grid-template-columns: 80px 1fr 100px;
  gap: 12px;
  align-items: center;
}

.bucket-label {
  font-weight: 500;
  color: #666;
  font-size: 14px;
}

.bucket-bar-container {
  height: 24px;
  background: #f3f4f6;
  border-radius: 12px;
  overflow: hidden;
}

.bucket-bar {
  height: 100%;
  transition: width 0.5s ease;
  border-radius: 12px;
}

.bucket-bar.excellent {
  background: #10b981;
}

.bucket-bar.good {
  background: #3b82f6;
}

.bucket-bar.fair {
  background: #f59e0b;
}

.bucket-bar.poor {
  background: #ef4444;
}

.bucket-count {
  text-align: right;
  font-size: 14px;
  color: #666;
  font-weight: 500;
}

.file-list-header {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.search-input {
  flex: 1;
  padding: 10px 16px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.search-input:focus {
  outline: none;
  border-color: #667eea;
}

.sort-select {
  padding: 10px 16px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  cursor: pointer;
}

.file-list {
  max-height: 600px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-item {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  transition: all 0.2s;
}

.file-item:hover {
  background: #f9fafb;
  border-color: #667eea;
}

.file-path {
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  color: #333;
  margin-bottom: 8px;
  word-break: break-all;
}

.file-coverage {
  display: flex;
  align-items: center;
  gap: 12px;
}

.file-coverage-bar {
  flex: 1;
  height: 16px;
  background: #f3f4f6;
  border-radius: 8px;
  overflow: hidden;
}

.file-coverage-fill {
  height: 100%;
  transition: width 0.5s ease;
}

.file-item.excellent .file-coverage-fill {
  background: #10b981;
}

.file-item.good .file-coverage-fill {
  background: #3b82f6;
}

.file-item.fair .file-coverage-fill {
  background: #f59e0b;
}

.file-item.poor .file-coverage-fill {
  background: #ef4444;
}

.file-coverage-text {
  font-size: 14px;
  font-weight: 500;
  color: #666;
  min-width: 60px;
  text-align: right;
}

.empty-state {
  background: white;
  border-radius: 12px;
  padding: 80px 24px;
  text-align: center;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.empty-state h2 {
  font-size: 24px;
  color: #333;
  margin-bottom: 8px;
}

.empty-state p {
  color: #666;
  margin-bottom: 4px;
}

.hint {
  font-size: 14px;
  color: #999;
  margin-top: 16px;
}
</style>
