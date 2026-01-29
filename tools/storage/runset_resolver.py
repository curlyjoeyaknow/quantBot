#!/usr/bin/env python3
"""
RunSet Resolver

The Resolver is the ONLY convenience layer allowed to touch truth.
It takes a RunSet spec and produces concrete URIs.

Resolver contract:
- Deterministic: same inputs => same resolved list (unless using latest=true)
- Versioned: outputs carry resolver_version
- Auditable: writes a resolution record

Think of it like DNS for your data lake.

Usage:
    python runset_resolver.py <operation> <args_json>
    
Operations:
    create_runset: Create a new RunSet
    resolve_runset: Resolve RunSet to concrete run_ids
    freeze_runset: Freeze RunSet (pin for reproducibility)
    get_runset: Get RunSet by ID
    query_runsets: Query RunSets with filters
"""

import sys
import json
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

# Resolver version (for auditing)
RESOLVER_VERSION = "1.0.0"


class RunSetResolver:
    """
    RunSet Resolver - DNS for your data lake
    
    Allowed to:
    - Find data
    - Select data
    - Cache data
    
    NOT allowed to:
    - Alter canonical events
    - Infer missing candles
    - Compute outcomes without engine replay
    """
    
    def __init__(self, registry_root: str):
        self.registry_root = Path(registry_root)
        self.resolver_version = RESOLVER_VERSION
        
        # Ensure registry directories exist
        self._ensure_directories()
    
    def _ensure_directories(self):
        """Ensure registry directories exist."""
        dirs = [
            'runsets_spec',
            'runs',
            'artifacts',
            'runsets_resolution',
            'tags',
        ]
        for d in dirs:
            (self.registry_root / d).mkdir(parents=True, exist_ok=True)
    
    def create_runset(self, spec: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create a new RunSet.
        
        Args:
            spec: RunSet specification (declarative selection)
            
        Returns:
            RunSetWithResolution (spec + optional resolution)
        """
        # 1. Generate deterministic ID
        runset_id = self._hash_spec(spec)
        spec['runsetId'] = runset_id
        
        # 2. Add metadata
        spec['createdAt'] = datetime.utcnow().isoformat() + 'Z'
        spec['specVersion'] = '1.0.0'
        
        # 3. Write spec to Parquet
        self._write_spec(runset_id, spec)
        
        # 4. Optionally resolve
        resolution = None
        if spec.get('autoResolve', False):
            resolution = self.resolve_runset(runset_id, force=False)
        
        return {
            'spec': spec,
            'resolution': resolution,
            'mode': 'exploration' if not spec.get('frozen', False) else 'reproducible'
        }
    
    def resolve_runset(self, runset_id: str, force: bool = False) -> Dict[str, Any]:
        """
        Resolve RunSet to concrete run_ids and artifacts.
        
        Args:
            runset_id: RunSet ID
            force: Force re-resolution even if cached
            
        Returns:
            RunSetResolution (concrete artifact list)
        """
        # 1. Load spec
        spec = self._load_spec(runset_id)
        
        # 2. Check if frozen (and not forcing)
        if spec.get('frozen', False) and not force:
            return self._load_frozen_resolution(runset_id)
        
        # 3. Load runs metadata
        runs_df = self._load_runs()
        
        if runs_df.empty:
            # No runs yet - return empty resolution
            return self._create_empty_resolution(runset_id)
        
        # 4. Filter by spec criteria
        filtered_runs = self._filter_runs(runs_df, spec)
        
        if filtered_runs.empty:
            # No matching runs - return empty resolution
            return self._create_empty_resolution(runset_id)
        
        # 5. Load artifacts for matching runs
        run_ids = filtered_runs['run_id'].tolist()
        artifacts = self._load_artifacts(run_ids)
        
        # 6. Compute resolution hash
        run_ids_sorted = sorted(run_ids)
        resolution_hash = hashlib.sha256(
            json.dumps(run_ids_sorted, sort_keys=True).encode()
        ).hexdigest()
        
        # 7. Create resolution record
        resolution = {
            'runsetId': runset_id,
            'resolverVersion': self.resolver_version,
            'resolvedAt': datetime.utcnow().isoformat() + 'Z',
            'runIds': run_ids_sorted,
            'artifacts': artifacts,
            'contentHash': resolution_hash,
            'metadata': {
                'runCount': len(run_ids_sorted),
                'artifactCount': len(artifacts),
                'coverage': self._compute_coverage(filtered_runs),
            },
            'frozen': False
        }
        
        # 8. Write resolution snapshot (audit trail)
        self._write_resolution(runset_id, resolution)
        
        return resolution
    
    def freeze_runset(self, runset_id: str) -> Dict[str, Any]:
        """
        Freeze RunSet (pin resolution for reproducibility).
        
        Args:
            runset_id: RunSet ID
            
        Returns:
            Frozen RunSetResolution
        """
        # 1. Resolve (if not already resolved)
        resolution = self.resolve_runset(runset_id, force=False)
        
        # 2. Mark as frozen
        resolution['frozen'] = True
        
        # 3. Write frozen resolution
        self._write_resolution(runset_id, resolution, frozen=True)
        
        # 4. Update spec (mark as frozen)
        self._update_spec_frozen_status(runset_id, frozen=True)
        
        return resolution
    
    def get_runset(self, runset_id: str) -> Dict[str, Any]:
        """Get RunSet by ID."""
        spec = self._load_spec(runset_id)
        
        # Try to load latest resolution
        try:
            resolution = self._load_latest_resolution(runset_id)
        except FileNotFoundError:
            resolution = None
        
        return {
            'spec': spec,
            'resolution': resolution,
            'mode': 'exploration' if not spec.get('frozen', False) else 'reproducible'
        }
    
    def query_runsets(self, filter_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Query RunSets with filters."""
        # Load all specs
        specs = self._load_all_specs()
        
        # Filter by criteria
        filtered = specs
        
        if 'tags' in filter_dict:
            tags = set(filter_dict['tags'])
            filtered = [s for s in filtered if tags.issubset(set(s.get('tags', [])))]
        
        if 'frozen' in filter_dict:
            frozen = filter_dict['frozen']
            filtered = [s for s in filtered if s.get('frozen', False) == frozen]
        
        if 'datasetId' in filter_dict:
            dataset_id = filter_dict['datasetId']
            filtered = [s for s in filtered if s.get('datasetId') == dataset_id]
        
        # Limit
        limit = filter_dict.get('limit', 100)
        filtered = filtered[:limit]
        
        # Load resolutions for each
        results = []
        for spec in filtered:
            runset_id = spec['runsetId']
            try:
                resolution = self._load_latest_resolution(runset_id)
            except FileNotFoundError:
                resolution = None
            
            results.append({
                'spec': spec,
                'resolution': resolution,
                'mode': 'exploration' if not spec.get('frozen', False) else 'reproducible'
            })
        
        return results
    
    # ========================================================================
    # Private Methods
    # ========================================================================
    
    def _hash_spec(self, spec: Dict[str, Any]) -> str:
        """Generate deterministic runset_id from spec."""
        # Remove fields that don't affect identity
        spec_for_hash = {k: v for k, v in spec.items() 
                        if k not in ['createdAt', 'createdBy', 'notes', 'autoResolve']}
        
        # Canonical JSON (sorted keys, no whitespace)
        canonical = json.dumps(spec_for_hash, sort_keys=True, separators=(',', ':'))
        return hashlib.sha256(canonical.encode()).hexdigest()[:16]
    
    def _write_spec(self, runset_id: str, spec: Dict[str, Any]):
        """Write RunSet spec to Parquet."""
        spec_dir = self.registry_root / 'runsets_spec' / f'runset_id={runset_id}'
        spec_dir.mkdir(parents=True, exist_ok=True)
        
        # Convert to DataFrame
        df = pd.DataFrame([{
            'runset_id': runset_id,
            'spec_json': json.dumps(spec, sort_keys=True),
            'created_at': pd.Timestamp(spec['createdAt']),
            'mode': 'exploration' if not spec.get('frozen', False) else 'reproducible',
        }])
        
        # Write to Parquet
        output_path = spec_dir / f'part-{datetime.utcnow().strftime("%Y%m%d%H%M%S")}.parquet'
        df.to_parquet(output_path, index=False)
    
    def _load_spec(self, runset_id: str) -> Dict[str, Any]:
        """Load RunSet spec from Parquet."""
        spec_dir = self.registry_root / 'runsets_spec' / f'runset_id={runset_id}'
        
        if not spec_dir.exists():
            raise FileNotFoundError(f"RunSet not found: {runset_id}")
        
        # Read all parts (should be only one, but handle multiple)
        df = pd.read_parquet(spec_dir)
        
        if df.empty:
            raise FileNotFoundError(f"RunSet not found: {runset_id}")
        
        # Return latest spec (in case of multiple writes)
        latest = df.sort_values('created_at', ascending=False).iloc[0]
        return json.loads(latest['spec_json'])
    
    def _load_all_specs(self) -> List[Dict[str, Any]]:
        """Load all RunSet specs."""
        specs_root = self.registry_root / 'runsets_spec'
        
        if not specs_root.exists():
            return []
        
        specs = []
        for spec_dir in specs_root.iterdir():
            if spec_dir.is_dir() and spec_dir.name.startswith('runset_id='):
                try:
                    df = pd.read_parquet(spec_dir)
                    if not df.empty:
                        latest = df.sort_values('created_at', ascending=False).iloc[0]
                        specs.append(json.loads(latest['spec_json']))
                except Exception:
                    continue
        
        return specs
    
    def _load_runs(self) -> pd.DataFrame:
        """Load runs metadata from Parquet."""
        runs_root = self.registry_root / 'runs'
        
        if not runs_root.exists():
            return pd.DataFrame()
        
        try:
            return pd.read_parquet(runs_root)
        except Exception:
            return pd.DataFrame()
    
    def _filter_runs(self, runs_df: pd.DataFrame, spec: Dict[str, Any]) -> pd.DataFrame:
        """Filter runs by spec criteria (core selection logic)."""
        filtered = runs_df.copy()
        
        # Filter by dataset_id
        if 'datasetId' in spec:
            dataset_id = spec['datasetId']
            filtered = filtered[
                filtered['dataset_ids'].apply(
                    lambda ids: dataset_id in (ids if isinstance(ids, list) else json.loads(ids))
                )
            ]
        
        # Filter by time bounds
        if 'timeBounds' in spec:
            from_ts = pd.Timestamp(spec['timeBounds']['from'])
            to_ts = pd.Timestamp(spec['timeBounds']['to'])
            filtered = filtered[
                (filtered['created_at'] >= from_ts) &
                (filtered['created_at'] <= to_ts)
            ]
        
        # Filter by strategy
        if 'strategy' in spec:
            strategy_filter = spec['strategy']
            
            if 'strategyHash' in strategy_filter:
                filtered = filtered[
                    filtered['strategy_spec_hash'] == strategy_filter['strategyHash']
                ]
            
            if 'engineVersion' in strategy_filter:
                filtered = filtered[
                    filtered['engine_version'] == strategy_filter['engineVersion']
                ]
            
            if 'strategyFamily' in strategy_filter:
                # Would need to parse strategy_spec to filter by family
                # For now, defer to metadata filtering
                pass
        
        # Filter by explicit run_ids (pinned mode)
        if 'runIds' in spec:
            filtered = filtered[filtered['run_id'].isin(spec['runIds'])]
        
        return filtered
    
    def _load_artifacts(self, run_ids: List[str]) -> List[Dict[str, Any]]:
        """Load artifacts for given run_ids."""
        artifacts_root = self.registry_root / 'artifacts'
        
        if not artifacts_root.exists():
            return []
        
        try:
            artifacts_df = pd.read_parquet(artifacts_root)
            filtered = artifacts_df[artifacts_df['run_id'].isin(run_ids)]
            
            return [
                {
                    'artifactId': row['artifact_id'],
                    'kind': row['kind'],
                    'uri': row['uri'],
                    'contentHash': row['content_hash'],
                    'runId': row['run_id'],
                }
                for _, row in filtered.iterrows()
            ]
        except Exception:
            return []
    
    def _compute_coverage(self, runs_df: pd.DataFrame) -> Dict[str, Any]:
        """Compute coverage summary for runs."""
        if runs_df.empty:
            return {}
        
        return {
            'dateRange': {
                'from': runs_df['created_at'].min().isoformat(),
                'to': runs_df['created_at'].max().isoformat(),
            },
            'runCount': len(runs_df),
        }
    
    def _create_empty_resolution(self, runset_id: str) -> Dict[str, Any]:
        """Create empty resolution (no matching runs)."""
        return {
            'runsetId': runset_id,
            'resolverVersion': self.resolver_version,
            'resolvedAt': datetime.utcnow().isoformat() + 'Z',
            'runIds': [],
            'artifacts': [],
            'contentHash': hashlib.sha256(b'[]').hexdigest(),
            'metadata': {
                'runCount': 0,
                'artifactCount': 0,
                'warnings': ['No matching runs found'],
            },
            'frozen': False
        }
    
    def _write_resolution(self, runset_id: str, resolution: Dict[str, Any], frozen: bool = False):
        """Write resolution snapshot to Parquet."""
        resolved_at = resolution['resolvedAt'].replace(':', '').replace('-', '').split('.')[0]
        resolution_dir = (
            self.registry_root / 'runsets_resolution' / 
            f'runset_id={runset_id}' / 
            f'resolved_at={resolved_at}'
        )
        resolution_dir.mkdir(parents=True, exist_ok=True)
        
        # Create one row per run_id (for easy querying)
        rows = []
        for run_id in resolution['runIds']:
            rows.append({
                'runset_id': runset_id,
                'resolved_at': pd.Timestamp(resolution['resolvedAt']),
                'resolver_version': resolution['resolverVersion'],
                'resolution_hash': resolution['contentHash'],
                'run_id': run_id,
                'frozen': frozen,
                'metadata_json': json.dumps(resolution['metadata']),
            })
        
        if not rows:
            # Write empty resolution record
            rows.append({
                'runset_id': runset_id,
                'resolved_at': pd.Timestamp(resolution['resolvedAt']),
                'resolver_version': resolution['resolverVersion'],
                'resolution_hash': resolution['contentHash'],
                'run_id': None,
                'frozen': frozen,
                'metadata_json': json.dumps(resolution['metadata']),
            })
        
        df = pd.DataFrame(rows)
        
        # Write to Parquet
        output_path = resolution_dir / f'part-{datetime.utcnow().strftime("%Y%m%d%H%M%S")}.parquet'
        df.to_parquet(output_path, index=False)
    
    def _load_frozen_resolution(self, runset_id: str) -> Dict[str, Any]:
        """Load frozen resolution for RunSet."""
        resolution_root = self.registry_root / 'runsets_resolution' / f'runset_id={runset_id}'
        
        if not resolution_root.exists():
            raise FileNotFoundError(f"No resolution found for RunSet: {runset_id}")
        
        # Read all resolutions
        df = pd.read_parquet(resolution_root)
        
        # Filter by frozen=True
        frozen_df = df[df['frozen'] == True]
        
        if frozen_df.empty:
            raise FileNotFoundError(f"No frozen resolution found for RunSet: {runset_id}")
        
        # Get latest frozen resolution
        latest = frozen_df.sort_values('resolved_at', ascending=False).iloc[0]
        
        # Reconstruct resolution
        run_ids = df[
            (df['runset_id'] == runset_id) &
            (df['resolved_at'] == latest['resolved_at'])
        ]['run_id'].dropna().tolist()
        
        return {
            'runsetId': runset_id,
            'resolverVersion': latest['resolver_version'],
            'resolvedAt': latest['resolved_at'].isoformat(),
            'runIds': sorted(run_ids),
            'artifacts': self._load_artifacts(run_ids),
            'contentHash': latest['resolution_hash'],
            'metadata': json.loads(latest['metadata_json']),
            'frozen': True
        }
    
    def _load_latest_resolution(self, runset_id: str) -> Dict[str, Any]:
        """Load latest resolution for RunSet."""
        resolution_root = self.registry_root / 'runsets_resolution' / f'runset_id={runset_id}'
        
        if not resolution_root.exists():
            raise FileNotFoundError(f"No resolution found for RunSet: {runset_id}")
        
        # Read all resolutions
        df = pd.read_parquet(resolution_root)
        
        if df.empty:
            raise FileNotFoundError(f"No resolution found for RunSet: {runset_id}")
        
        # Get latest resolution
        latest = df.sort_values('resolved_at', ascending=False).iloc[0]
        
        # Reconstruct resolution
        run_ids = df[
            (df['runset_id'] == runset_id) &
            (df['resolved_at'] == latest['resolved_at'])
        ]['run_id'].dropna().tolist()
        
        return {
            'runsetId': runset_id,
            'resolverVersion': latest['resolver_version'],
            'resolvedAt': latest['resolved_at'].isoformat(),
            'runIds': sorted(run_ids),
            'artifacts': self._load_artifacts(run_ids),
            'contentHash': latest['resolution_hash'],
            'metadata': json.loads(latest['metadata_json']),
            'frozen': latest['frozen']
        }
    
    def _update_spec_frozen_status(self, runset_id: str, frozen: bool):
        """Update spec frozen status (append new record)."""
        spec = self._load_spec(runset_id)
        spec['frozen'] = frozen
        spec['updatedAt'] = datetime.utcnow().isoformat() + 'Z'
        
        # Write updated spec (append-only)
        self._write_spec(runset_id, spec)


def main():
    """Main entry point for CLI usage."""
    if len(sys.argv) < 2:
        print(json.dumps({
            'success': False,
            'error': 'Usage: runset_resolver.py <operation> <args_json>'
        }))
        sys.exit(1)
    
    operation = sys.argv[1]
    args = json.loads(sys.stdin.read()) if len(sys.argv) == 2 else json.loads(sys.argv[2])
    
    # Get registry root from args or environment
    registry_root = args.get('registry_root', '/home/memez/opn/registry')
    
    resolver = RunSetResolver(registry_root)
    
    try:
        if operation == 'create_runset':
            result = resolver.create_runset(args['spec'])
        elif operation == 'resolve_runset':
            result = resolver.resolve_runset(args['runset_id'], args.get('force', False))
        elif operation == 'freeze_runset':
            result = resolver.freeze_runset(args['runset_id'])
        elif operation == 'get_runset':
            result = resolver.get_runset(args['runset_id'])
        elif operation == 'query_runsets':
            result = resolver.query_runsets(args.get('filter', {}))
        else:
            result = {'success': False, 'error': f'Unknown operation: {operation}'}
        
        print(json.dumps({'success': True, 'result': result}, default=str))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()

