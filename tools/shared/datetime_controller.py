"""
DateTimeController - Centralized UTC-only datetime handling

ALL datetime operations in the codebase MUST go through this module.
This prevents timezone bugs like using local time instead of UTC.

RULES:
1. NEVER use datetime.now() - use DateTimeController.now()
2. NEVER use datetime.fromtimestamp() - use DateTimeController.from_timestamp_ms()
3. NEVER use datetime.fromisoformat() without validation - use DateTimeController.from_iso()
4. ALL timestamps in the system are milliseconds since Unix epoch (UTC)
5. ALL ISO strings MUST end with 'Z' (UTC indicator)

Usage:
    from tools.shared.datetime_controller import dt

    # Get current time
    now = dt.now()

    # Convert timestamp (milliseconds) to datetime
    dt_obj = dt.from_timestamp_ms(1714521600000)

    # Convert datetime to ISO string
    iso_str = dt.to_iso(dt_obj)  # "2024-05-01T00:00:00Z"

    # Parse ISO string
    dt_obj = dt.from_iso("2024-05-01T00:00:00Z")

    # Convert datetime to timestamp (milliseconds)
    ts_ms = dt.to_timestamp_ms(dt_obj)
"""

from datetime import datetime, timezone
from typing import Optional, Union
import re


class DateTimeController:
    """
    Centralized datetime controller enforcing UTC everywhere.
    
    This class provides a single source of truth for all datetime operations,
    preventing timezone bugs by always working in UTC.
    """
    
    # Regex to validate ISO 8601 UTC format
    ISO_UTC_PATTERN = re.compile(
        r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
    )
    
    @staticmethod
    def now() -> datetime:
        """
        Get current time in UTC.
        
        NEVER use datetime.now() directly - it uses local timezone!
        
        Returns:
            datetime: Current UTC time (timezone-aware)
        """
        return datetime.now(timezone.utc)
    
    @staticmethod
    def from_timestamp_s(timestamp_seconds: Union[int, float]) -> datetime:
        """
        Convert Unix timestamp (seconds) to UTC datetime.
        
        NEVER use datetime.fromtimestamp() - it uses local timezone!
        
        Args:
            timestamp_seconds: Unix timestamp in seconds
            
        Returns:
            datetime: UTC datetime (timezone-aware)
        """
        return datetime.fromtimestamp(timestamp_seconds, tz=timezone.utc)
    
    @staticmethod
    def from_timestamp_ms(timestamp_ms: Union[int, float]) -> datetime:
        """
        Convert Unix timestamp (milliseconds) to UTC datetime.
        
        This is the preferred method since QuantBot uses milliseconds internally.
        
        Args:
            timestamp_ms: Unix timestamp in milliseconds
            
        Returns:
            datetime: UTC datetime (timezone-aware)
        """
        return datetime.fromtimestamp(timestamp_ms / 1000.0, tz=timezone.utc)
    
    @staticmethod
    def to_timestamp_s(dt_obj: datetime) -> int:
        """
        Convert datetime to Unix timestamp (seconds).
        
        Args:
            dt_obj: datetime object (must be UTC or timezone-aware)
            
        Returns:
            int: Unix timestamp in seconds
        """
        if dt_obj.tzinfo is None:
            raise ValueError(
                "Naive datetime passed to to_timestamp_s(). "
                "All datetimes must be timezone-aware. "
                "Use DateTimeController methods to create datetimes."
            )
        return int(dt_obj.timestamp())
    
    @staticmethod
    def to_timestamp_ms(dt_obj: datetime) -> int:
        """
        Convert datetime to Unix timestamp (milliseconds).
        
        This is the preferred method since QuantBot uses milliseconds internally.
        
        Args:
            dt_obj: datetime object (must be UTC or timezone-aware)
            
        Returns:
            int: Unix timestamp in milliseconds
        """
        if dt_obj.tzinfo is None:
            raise ValueError(
                "Naive datetime passed to to_timestamp_ms(). "
                "All datetimes must be timezone-aware. "
                "Use DateTimeController methods to create datetimes."
            )
        return int(dt_obj.timestamp() * 1000)
    
    @staticmethod
    def to_iso(dt_obj: datetime) -> str:
        """
        Convert datetime to ISO 8601 UTC string.
        
        Always returns format: "YYYY-MM-DDTHH:MM:SSZ"
        
        Args:
            dt_obj: datetime object (must be UTC or timezone-aware)
            
        Returns:
            str: ISO 8601 string with Z suffix
        """
        if dt_obj.tzinfo is None:
            raise ValueError(
                "Naive datetime passed to to_iso(). "
                "All datetimes must be timezone-aware. "
                "Use DateTimeController methods to create datetimes."
            )
        # Convert to UTC and format
        utc_dt = dt_obj.astimezone(timezone.utc)
        # Use isoformat but replace +00:00 with Z for consistency
        iso = utc_dt.isoformat()
        if iso.endswith('+00:00'):
            iso = iso[:-6] + 'Z'
        elif not iso.endswith('Z'):
            iso = iso + 'Z'
        return iso
    
    @staticmethod
    def to_iso_no_ms(dt_obj: datetime) -> str:
        """
        Convert datetime to ISO 8601 UTC string without milliseconds.
        
        Always returns format: "YYYY-MM-DDTHH:MM:SSZ"
        
        Args:
            dt_obj: datetime object (must be UTC or timezone-aware)
            
        Returns:
            str: ISO 8601 string with Z suffix, no milliseconds
        """
        if dt_obj.tzinfo is None:
            raise ValueError(
                "Naive datetime passed to to_iso_no_ms(). "
                "All datetimes must be timezone-aware. "
                "Use DateTimeController methods to create datetimes."
            )
        utc_dt = dt_obj.astimezone(timezone.utc)
        return utc_dt.strftime('%Y-%m-%dT%H:%M:%SZ')
    
    @staticmethod
    def from_iso(iso_string: str) -> datetime:
        """
        Parse ISO 8601 string to UTC datetime.
        
        Accepts:
        - "2024-05-01T00:00:00Z"
        - "2024-05-01T00:00:00.123Z"
        - "2024-05-01T00:00:00+00:00"
        - "2024-05-01" (assumes midnight UTC)
        
        Args:
            iso_string: ISO 8601 formatted string
            
        Returns:
            datetime: UTC datetime (timezone-aware)
        """
        if not iso_string:
            raise ValueError("Empty ISO string")
        
        # Handle Z suffix
        if iso_string.endswith('Z'):
            iso_string = iso_string[:-1] + '+00:00'
        
        # Handle date-only format
        if 'T' not in iso_string and len(iso_string) == 10:
            iso_string = iso_string + 'T00:00:00+00:00'
        
        # Parse with fromisoformat
        dt_obj = datetime.fromisoformat(iso_string)
        
        # If naive, assume UTC
        if dt_obj.tzinfo is None:
            dt_obj = dt_obj.replace(tzinfo=timezone.utc)
        
        # Convert to UTC
        return dt_obj.astimezone(timezone.utc)
    
    @staticmethod
    def to_clickhouse_format(dt_obj: datetime) -> str:
        """
        Convert datetime to ClickHouse-compatible format.
        
        ClickHouse prefers: "YYYY-MM-DD HH:MM:SS"
        
        Args:
            dt_obj: datetime object (must be UTC or timezone-aware)
            
        Returns:
            str: ClickHouse-compatible datetime string
        """
        if dt_obj.tzinfo is None:
            raise ValueError(
                "Naive datetime passed to to_clickhouse_format(). "
                "All datetimes must be timezone-aware."
            )
        utc_dt = dt_obj.astimezone(timezone.utc)
        return utc_dt.strftime('%Y-%m-%d %H:%M:%S')
    
    @staticmethod
    def validate_is_utc(dt_obj: datetime) -> bool:
        """
        Validate that a datetime is UTC.
        
        Args:
            dt_obj: datetime object
            
        Returns:
            bool: True if datetime is UTC
        """
        if dt_obj.tzinfo is None:
            return False
        return dt_obj.tzinfo == timezone.utc or dt_obj.utcoffset().total_seconds() == 0


# Singleton instance for convenient imports
dt = DateTimeController()


# ============================================================================
# DEPRECATED FUNCTION WRAPPERS - These exist to catch misuse
# ============================================================================

def _deprecated_fromtimestamp(*args, **kwargs):
    raise NotImplementedError(
        "datetime.fromtimestamp() is BANNED in this codebase! "
        "Use DateTimeController.from_timestamp_ms() or from_timestamp_s() instead. "
        "See tools/shared/datetime_controller.py for details."
    )


def _deprecated_now(*args, **kwargs):
    raise NotImplementedError(
        "datetime.now() without timezone is BANNED in this codebase! "
        "Use DateTimeController.now() instead. "
        "See tools/shared/datetime_controller.py for details."
    )


# ============================================================================
# TESTS
# ============================================================================

if __name__ == '__main__':
    print("DateTimeController self-test...")
    
    # Test now()
    now = dt.now()
    assert now.tzinfo == timezone.utc, "now() must return UTC"
    print(f"✓ now(): {now}")
    
    # Test from_timestamp_ms
    ts_ms = 1714521600000  # 2024-05-01 00:00:00 UTC
    dt_obj = dt.from_timestamp_ms(ts_ms)
    assert dt_obj.tzinfo == timezone.utc, "from_timestamp_ms must return UTC"
    assert dt_obj.year == 2024 and dt_obj.month == 5 and dt_obj.day == 1
    print(f"✓ from_timestamp_ms({ts_ms}): {dt_obj}")
    
    # Test to_iso
    iso = dt.to_iso(dt_obj)
    assert iso.endswith('Z'), "to_iso must end with Z"
    print(f"✓ to_iso(): {iso}")
    
    # Test from_iso
    parsed = dt.from_iso(iso)
    assert parsed.tzinfo == timezone.utc, "from_iso must return UTC"
    assert parsed == dt_obj, "Round-trip must be identical"
    print(f"✓ from_iso(): {parsed}")
    
    # Test to_timestamp_ms round-trip
    ts_back = dt.to_timestamp_ms(dt_obj)
    assert ts_back == ts_ms, "Round-trip timestamp must match"
    print(f"✓ to_timestamp_ms(): {ts_back}")
    
    # Test ClickHouse format
    ch_format = dt.to_clickhouse_format(dt_obj)
    assert ch_format == '2024-05-01 00:00:00', f"Expected '2024-05-01 00:00:00', got '{ch_format}'"
    print(f"✓ to_clickhouse_format(): {ch_format}")
    
    # Test date-only parsing
    date_only = dt.from_iso("2024-05-01")
    assert date_only.hour == 0 and date_only.minute == 0
    print(f"✓ from_iso(date-only): {date_only}")
    
    print("\n✓ All tests passed!")

