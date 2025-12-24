"""
Validate all addresses in DuckDB database

Checks for:
- Truncated addresses (wrong length)
- Invalid format (not Solana or EVM)
- Empty/null addresses
"""

from pydantic import BaseModel, Field
from typing import Optional, List
import duckdb

# Address validation functions (matching TypeScript logic)
BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

def is_base58(s: str) -> bool:
    """Check if string is valid Base58"""
    if not s:
        return False
    for ch in s:
        if ch not in BASE58_ALPHABET:
            return False
    return True

def is_solana_address(s: str) -> bool:
    """Check if string is a valid Solana address format"""
    if not isinstance(s, str):
        return False
    t = s.strip()
    if len(t) < 32 or len(t) > 44:
        return False
    return is_base58(t)

def is_evm_address(s: str) -> bool:
    """Check if string is a valid EVM address format"""
    if not isinstance(s, str):
        return False
    t = s.strip()
    # EVM: 0x + 40 hex chars = 42 chars total
    import re
    return bool(re.match(r'^0x[a-fA-F0-9]{40}$', t))

def is_valid_address(address: str) -> tuple[bool, Optional[str]]:
    """
    Validate address format and length
    Returns (is_valid, error_message)
    """
    if not address or not isinstance(address, str):
        return False, "Address is None or not a string"
    
    trimmed = address.strip()
    if len(trimmed) == 0:
        return False, "Address is empty or whitespace"
    
    # Check Solana format
    if is_solana_address(trimmed):
        if len(trimmed) < 32 or len(trimmed) > 44:
            return False, f"Solana address wrong length: {len(trimmed)} (expected 32-44)"
        return True, None
    
    # Check EVM format
    if is_evm_address(trimmed):
        if len(trimmed) != 42:
            return False, f"EVM address wrong length: {len(trimmed)} (expected 42)"
        return True, None
    
    # Unknown format
    return False, f"Unknown address format (not Solana or EVM), length: {len(trimmed)}"


class ValidateAddressesInput(BaseModel):
    """Input for address validation"""
    pass  # No input needed, validates all addresses in database


class FaultyAddress(BaseModel):
    """A faulty address found in the database"""
    mint: str
    table_name: str
    row_count: int  # How many rows have this address
    error: str
    address_length: int
    address_type: str  # 'solana', 'evm', or 'unknown'


class ValidateAddressesOutput(BaseModel):
    """Output from address validation"""
    success: bool
    total_addresses: int = 0
    valid_addresses: int = 0
    faulty_addresses: int = 0
    faulty: Optional[List[FaultyAddress]] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: ValidateAddressesInput) -> ValidateAddressesOutput:
    """
    Validate all addresses in DuckDB database
    """
    try:
        # Get list of tables
        table_info = con.execute("SHOW TABLES").fetchall()
        table_names = [row[0] for row in table_info] if table_info else []
        
        faulty_addresses: List[FaultyAddress] = []
        all_addresses = set()
        valid_count = 0
        
        # Check user_calls_d table (main table with mint addresses)
        if 'user_calls_d' in table_names:
            query = """
                SELECT DISTINCT mint, COUNT(*) as row_count
                FROM user_calls_d
                WHERE mint IS NOT NULL
                  AND TRIM(CAST(mint AS VARCHAR)) != ''
                GROUP BY mint
            """
            result = con.execute(query).fetchall()
            
            for row in result:
                mint = str(row[0])
                row_count = int(row[1])
                
                if mint not in all_addresses:
                    all_addresses.add(mint)
                    
                    is_valid, error_msg = is_valid_address(mint)
                    
                    if is_valid:
                        valid_count += 1
                    else:
                        # Determine address type
                        address_type = 'unknown'
                        if is_solana_address(mint):
                            address_type = 'solana'
                        elif is_evm_address(mint):
                            address_type = 'evm'
                        
                        faulty_addresses.append(FaultyAddress(
                            mint=mint,
                            table_name='user_calls_d',
                            row_count=row_count,
                            error=error_msg or "Unknown validation error",
                            address_length=len(mint),
                            address_type=address_type
                        ))
        
        # Check caller_links_d table (also has mint addresses)
        if 'caller_links_d' in table_names:
            query = """
                SELECT DISTINCT mint, COUNT(*) as row_count
                FROM caller_links_d
                WHERE mint IS NOT NULL
                  AND TRIM(CAST(mint AS VARCHAR)) != ''
                GROUP BY mint
            """
            result = con.execute(query).fetchall()
            
            for row in result:
                mint = str(row[0])
                row_count = int(row[1])
                
                if mint not in all_addresses:
                    all_addresses.add(mint)
                    
                    is_valid, error_msg = is_valid_address(mint)
                    
                    if is_valid:
                        valid_count += 1
                    else:
                        # Determine address type
                        address_type = 'unknown'
                        if is_solana_address(mint):
                            address_type = 'solana'
                        elif is_evm_address(mint):
                            address_type = 'evm'
                        
                        faulty_addresses.append(FaultyAddress(
                            mint=mint,
                            table_name='caller_links_d',
                            row_count=row_count,
                            error=error_msg or "Unknown validation error",
                            address_length=len(mint),
                            address_type=address_type
                        ))
        
        # Check calls_d or calls_list_d if they exist
        for table_name in ['calls_d', 'calls_list_d']:
            if table_name in table_names:
                query = f"""
                    SELECT DISTINCT mint, COUNT(*) as row_count
                    FROM {table_name}
                    WHERE mint IS NOT NULL
                      AND TRIM(CAST(mint AS VARCHAR)) != ''
                    GROUP BY mint
                """
                result = con.execute(query).fetchall()
                
                for row in result:
                    mint = str(row[0])
                    row_count = int(row[1])
                    
                    if mint not in all_addresses:
                        all_addresses.add(mint)
                        
                        is_valid, error_msg = is_valid_address(mint)
                        
                        if is_valid:
                            valid_count += 1
                        else:
                            # Determine address type
                            address_type = 'unknown'
                            if is_solana_address(mint):
                                address_type = 'solana'
                            elif is_evm_address(mint):
                                address_type = 'evm'
                            
                            faulty_addresses.append(FaultyAddress(
                                mint=mint,
                                table_name=table_name,
                                row_count=row_count,
                                error=error_msg or "Unknown validation error",
                                address_length=len(mint),
                                address_type=address_type
                            ))
        
        return ValidateAddressesOutput(
            success=True,
            total_addresses=len(all_addresses),
            valid_addresses=valid_count,
            faulty_addresses=len(faulty_addresses),
            faulty=faulty_addresses if faulty_addresses else None
        )
        
    except Exception as e:
        return ValidateAddressesOutput(
            success=False,
            error=str(e)
        )

