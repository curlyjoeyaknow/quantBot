"""
Remove faulty addresses from DuckDB database

Deletes rows containing invalid/truncated addresses that were identified
by the validate_addresses operation.
"""

from pydantic import BaseModel, Field
from typing import Optional, List
import duckdb
from .validate_addresses import is_valid_address

class RemoveFaultyAddressesInput(BaseModel):
    """Input for removing faulty addresses"""
    dry_run: bool = Field(default=False, description="If True, only report what would be deleted without actually deleting")


class RemovalResult(BaseModel):
    """Result of removing a faulty address"""
    mint: str
    table_name: str
    rows_deleted: int
    error: Optional[str] = None


class RemoveFaultyAddressesOutput(BaseModel):
    """Output from removing faulty addresses"""
    success: bool
    dry_run: bool
    total_rows_deleted: int = 0
    tables_affected: List[str] = []
    removals: Optional[List[RemovalResult]] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: RemoveFaultyAddressesInput) -> RemoveFaultyAddressesOutput:
    """
    Remove faulty addresses from DuckDB database
    """
    try:
        # Get list of tables
        table_info = con.execute("SHOW TABLES").fetchall()
        table_names = [row[0] for row in table_info] if table_info else []
        
        removals: List[RemovalResult] = []
        total_rows_deleted = 0
        tables_affected = set()
        
        # First, identify all faulty addresses
        faulty_addresses = set()
        
        # Check user_calls_d table
        if 'user_calls_d' in table_names:
            query = """
                SELECT DISTINCT mint
                FROM user_calls_d
                WHERE mint IS NOT NULL
                  AND TRIM(CAST(mint AS VARCHAR)) != ''
            """
            result = con.execute(query).fetchall()
            
            for row in result:
                mint = str(row[0])
                is_valid, _ = is_valid_address(mint)
                if not is_valid:
                    faulty_addresses.add(('user_calls_d', mint))
        
        # Check caller_links_d table
        if 'caller_links_d' in table_names:
            query = """
                SELECT DISTINCT mint
                FROM caller_links_d
                WHERE mint IS NOT NULL
                  AND TRIM(CAST(mint AS VARCHAR)) != ''
            """
            result = con.execute(query).fetchall()
            
            for row in result:
                mint = str(row[0])
                is_valid, _ = is_valid_address(mint)
                if not is_valid:
                    faulty_addresses.add(('caller_links_d', mint))
        
        # Check calls_d or calls_list_d if they exist
        for table_name in ['calls_d', 'calls_list_d']:
            if table_name in table_names:
                query = f"""
                    SELECT DISTINCT mint
                    FROM {table_name}
                    WHERE mint IS NOT NULL
                      AND TRIM(CAST(mint AS VARCHAR)) != ''
                """
                result = con.execute(query).fetchall()
                
                for row in result:
                    mint = str(row[0])
                    is_valid, _ = is_valid_address(mint)
                    if not is_valid:
                        faulty_addresses.add((table_name, mint))
        
        # Now remove the faulty addresses
        for table_name, mint in faulty_addresses:
            try:
                # Count rows that will be deleted
                count_query = f"""
                    SELECT COUNT(*)
                    FROM {table_name}
                    WHERE mint = ?
                """
                count_result = con.execute(count_query, [mint]).fetchone()
                row_count = int(count_result[0]) if count_result else 0
                
                if row_count > 0:
                    if not input.dry_run:
                        # Delete the rows
                        delete_query = f"""
                            DELETE FROM {table_name}
                            WHERE mint = ?
                        """
                        con.execute(delete_query, [mint])
                    
                    removals.append(RemovalResult(
                        mint=mint,
                        table_name=table_name,
                        rows_deleted=row_count
                    ))
                    total_rows_deleted += row_count
                    tables_affected.add(table_name)
                    
            except Exception as e:
                removals.append(RemovalResult(
                    mint=mint,
                    table_name=table_name,
                    rows_deleted=0,
                    error=str(e)
                ))
        
        return RemoveFaultyAddressesOutput(
            success=True,
            dry_run=input.dry_run,
            total_rows_deleted=total_rows_deleted,
            tables_affected=sorted(list(tables_affected)),
            removals=removals if removals else None
        )
        
    except Exception as e:
        return RemoveFaultyAddressesOutput(
            success=False,
            dry_run=input.dry_run,
            error=str(e)
        )

