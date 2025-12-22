"""
Tests for OHLCV Cache

Tests:
- Cache key generation
- Cache hit/miss behavior
- Cache expiration
- Cache file management
"""

import pytest
import tempfile
import os
import json
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

# Import cache functions
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../simulation'))
from ohlcv_cache import (
    generate_cache_key,
    get_cache_path,
    load_from_cache,
    save_to_cache,
    clear_cache,
)


@pytest.fixture
def temp_cache_dir():
    """Create a temporary cache directory"""
    cache_dir = tempfile.mkdtemp()
    yield cache_dir
    # Cleanup
    import shutil
    if os.path.exists(cache_dir):
        shutil.rmtree(cache_dir)


def test_generate_cache_key():
    """Test cache key generation"""
    token = 'So11111111111111111111111111111111111111112'
    chain = 'solana'
    start = datetime(2024, 1, 1, 12, 0, 0)
    end = datetime(2024, 1, 1, 13, 0, 0)
    interval = '5m'
    
    key1 = generate_cache_key(token, chain, start, end, interval)
    key2 = generate_cache_key(token, chain, start, end, interval)
    
    # Should be deterministic
    assert key1 == key2
    assert len(key1) == 64  # SHA256 hex length
    
    # Different inputs should produce different keys
    key3 = generate_cache_key(token, chain, start, end, '1m')
    assert key1 != key3


def test_get_cache_path(temp_cache_dir):
    """Test cache path generation"""
    cache_key = 'test_key'
    path = get_cache_path(temp_cache_dir, cache_key)
    
    assert path.parent.exists()
    assert path.name == 'test_key.json'
    assert str(temp_cache_dir) in str(path)


def test_save_and_load_cache(temp_cache_dir):
    """Test saving and loading cache"""
    cache_key = 'test_key'
    cache_path = get_cache_path(temp_cache_dir, cache_key)
    
    data = {
        'candles': [{'timestamp': 1704110400, 'open': 1.0, 'close': 1.1}],
        'count': 1,
    }
    
    # Save to cache
    save_to_cache(cache_path, data, expiration_hours=24)
    
    # Verify file exists
    assert cache_path.exists()
    
    # Load from cache
    loaded = load_from_cache(cache_path)
    assert loaded is not None
    assert loaded['candles'] == data['candles']
    assert loaded['count'] == data['count']
    assert 'expires_at' in loaded
    assert 'cached_at' in loaded


def test_cache_expiration(temp_cache_dir):
    """Test cache expiration"""
    cache_key = 'test_key'
    cache_path = get_cache_path(temp_cache_dir, cache_key)
    
    data = {'candles': [], 'count': 0}
    
    # Save with very short expiration
    save_to_cache(cache_path, data, expiration_hours=0.001)  # ~3.6 seconds
    
    # Should load immediately
    loaded = load_from_cache(cache_path)
    assert loaded is not None
    
    # Wait for expiration (simulate by modifying expires_at in file)
    with open(cache_path, 'r') as f:
        cache_data = json.load(f)
    cache_data['expires_at'] = (datetime.now() - timedelta(hours=1)).isoformat()
    with open(cache_path, 'w') as f:
        json.dump(cache_data, f)
    
    # Should not load expired cache
    loaded = load_from_cache(cache_path)
    assert loaded is None
    assert not cache_path.exists()  # Expired cache should be deleted


def test_cache_miss(temp_cache_dir):
    """Test cache miss behavior"""
    cache_key = 'nonexistent_key'
    cache_path = get_cache_path(temp_cache_dir, cache_key)
    
    loaded = load_from_cache(cache_path)
    assert loaded is None


def test_clear_cache(temp_cache_dir):
    """Test clearing cache"""
    # Create some cache files
    for i in range(5):
        cache_key = f'test_key_{i}'
        cache_path = get_cache_path(temp_cache_dir, cache_key)
        save_to_cache(cache_path, {'candles': [], 'count': 0})
    
    # Clear all cache
    deleted = clear_cache(temp_cache_dir)
    assert deleted == 5
    
    # Verify files are gone
    cache_dir = Path(temp_cache_dir) / 'ohlcv'
    assert len(list(cache_dir.glob('*.json'))) == 0


def test_clear_cache_older_than(temp_cache_dir):
    """Test clearing cache older than specified time"""
    # Create cache files
    for i in range(3):
        cache_key = f'test_key_{i}'
        cache_path = get_cache_path(temp_cache_dir, cache_key)
        save_to_cache(cache_path, {'candles': [], 'count': 0})
    
    # Modify file timestamps (make one old)
    cache_dir = Path(temp_cache_dir) / 'ohlcv'
    files = list(cache_dir.glob('*.json'))
    if files:
        # Make first file old
        old_time = (datetime.now() - timedelta(hours=25)).timestamp()
        os.utime(files[0], (old_time, old_time))
    
    # Clear cache older than 24 hours
    deleted = clear_cache(temp_cache_dir, older_than_hours=24)
    assert deleted >= 1  # At least the old file should be deleted


@pytest.mark.integration
def test_query_ohlcv_with_cache_integration(temp_cache_dir):
    """Test query_ohlcv_with_cache integration"""
    from ohlcv_cache import query_ohlcv_with_cache
    
    # Mock ClickHouse client
    mock_client = Mock()
    mock_query_result = Mock()
    mock_query_result.result_rows = [
        (1704110400, 1.0, 1.1, 0.9, 1.05, 1000.0),
    ]
    mock_query_result.result_rows.__iter__ = lambda self: iter([(1704110400, 1.0, 1.1, 0.9, 1.05, 1000.0)])
    
    # Mock query_ohlcv function
    with patch('ohlcv_cache.query_ohlcv') as mock_query:
        mock_query.return_value = {
            'success': True,
            'candles': [{'timestamp': 1704110400, 'open': 1.0, 'high': 1.1, 'low': 0.9, 'close': 1.05, 'volume': 1000.0}],
            'count': 1,
        }
        
        token = 'So11111111111111111111111111111111111111112'
        chain = 'solana'
        start = datetime(2024, 1, 1, 12, 0, 0)
        end = datetime(2024, 1, 1, 13, 0, 0)
        
        # First call - cache miss
        result1 = query_ohlcv_with_cache(mock_client, temp_cache_dir, token, chain, start, end)
        assert result1['success'] is True
        assert result1['cached'] is False
        assert mock_query.called
        
        # Second call - cache hit
        result2 = query_ohlcv_with_cache(mock_client, temp_cache_dir, token, chain, start, end)
        assert result2['success'] is True
        assert result2['cached'] is True
        # Should not call query_ohlcv again (call count should be 1)
        assert mock_query.call_count == 1

