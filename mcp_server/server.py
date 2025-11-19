from mcp.server.fastmcp import FastMCP
from nutribot_core.meal_analyzer import MealAnalyzer
from whoop_sdk import Whoop
from datetime import date, datetime
from typing import Optional
import json

# Initialize FastMCP server
mcp = FastMCP("nutribot")

# Initialize services
meal_analyzer = MealAnalyzer()
whoop = Whoop()
whoop.login()


def _convert_date_to_iso(date_str: Optional[str], is_end_date: bool = False) -> Optional[str]:
    """Convert YYYY-MM-DD date string to ISO format required by Whoop API.
    
    Args:
        date_str: Date string in YYYY-MM-DD format
        is_end_date: If True, set time to end of day (23:59:59.999Z), 
                     otherwise start of day (00:00:00.000Z)
        
    Returns:
        ISO format date string (e.g., '2024-01-01T00:00:00.000Z') or None
    """
    if not date_str:
        return None
    try:
        # Parse YYYY-MM-DD and convert to ISO format
        d = date.fromisoformat(date_str)
        if is_end_date:
            # For end dates, use end of day
            dt = datetime.combine(d, datetime.max.time())
            # Replace microseconds with .999 for milliseconds
            return dt.strftime('%Y-%m-%dT23:59:59.999Z')
        else:
            # For start dates, use start of day
            dt = datetime.combine(d, datetime.min.time())
            return dt.strftime('%Y-%m-%dT%H:%M:%S.000Z')
    except ValueError:
        # If already in ISO format, return as-is
        return date_str

@mcp.tool()
async def analyze_meal(meal_description: str) -> str:
    """Analyze a meal description and return structured nutrition facts.
    
    This uses the MealAnalyzer to parse natural language meal descriptions
    and extract foods, quantities, and nutrition information.
    
    Args:
        meal_description: Natural language description of a meal (e.g., "2 eggs and toast")
    """
    # Route to MealAnalyzer
    result = meal_analyzer.analyze_meal(meal_description)
    
    # Return structured data as JSON
    return json.dumps(result.model_dump(), indent=2)

@mcp.tool()
def get_current_date() -> str:
    """Get the current date in YYYY-MM-DD format.
    
    Use this tool to get today's date when users ask about "today", 
    "last night", "yesterday", or other relative date queries.
    
    Returns:
        Current date as a string in YYYY-MM-DD format
    """
    today = date.today()
    return today.isoformat()

@mcp.tool()
def get_whoop_profile() -> str:
    """Get Whoop user profile information.
    
    Returns the authenticated user's profile including user_id, email, 
    first_name, and last_name.
    
    Returns:
        JSON string containing user profile data
    """
    try:
        profile = whoop.get_profile()
        return json.dumps(profile, indent=2, default=str)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)

@mcp.tool()
def get_whoop_recovery(
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: Optional[int] = None,
    max_pages: Optional[int] = 3
) -> str:
    """Get Whoop recovery data.
    
    Retrieves recovery metrics including recovery score, HRV, RHR, and more.
    
    Args:
        start: Start date in YYYY-MM-DD format (optional). If not provided, 
               returns most recent data. Can also accept ISO format.
        end: End date in YYYY-MM-DD format (optional). If not provided, 
             uses current date. Can also accept ISO format.
        limit: Page size per request (max 25, default 10)
        max_pages: Maximum number of pages to fetch (default 3). None = no page cap.
        
    Returns:
        JSON string containing recovery data (dict with 'records' key)
    """
    try:
        start_iso = _convert_date_to_iso(start, is_end_date=False)
        end_iso = _convert_date_to_iso(end, is_end_date=True)
        
        recovery = whoop.get_recovery(
            limit=limit,
            start=start_iso,
            end=end_iso,
            max_pages=max_pages
        )
        return json.dumps(recovery, indent=2, default=str)
    except ValueError as e:
        return json.dumps({
            "error": f"Invalid date format. Use YYYY-MM-DD or ISO format: {str(e)}"
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)

@mcp.tool()
def get_whoop_sleep(
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: Optional[int] = None,
    max_pages: Optional[int] = 3
) -> str:
    """Get Whoop sleep data.
    
    Retrieves sleep metrics including sleep score, duration, stages, and more.
    
    Args:
        start: Start date in YYYY-MM-DD format (optional). If not provided, 
               returns most recent data. Can also accept ISO format.
        end: End date in YYYY-MM-DD format (optional). If not provided, 
             uses current date. Can also accept ISO format.
        limit: Page size per request (max 25, default 10)
        max_pages: Maximum number of pages to fetch (default 3). None = no page cap.
        
    Returns:
        JSON string containing sleep data (dict with 'records' key)
    """
    try:
        start_iso = _convert_date_to_iso(start, is_end_date=False)
        end_iso = _convert_date_to_iso(end, is_end_date=True)
        
        sleep = whoop.get_sleep(
            limit=limit,
            start=start_iso,
            end=end_iso,
            max_pages=max_pages
        )
        return json.dumps(sleep, indent=2, default=str)
    except ValueError as e:
        return json.dumps({
            "error": f"Invalid date format. Use YYYY-MM-DD or ISO format: {str(e)}"
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)

@mcp.tool()
def get_whoop_workouts(
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: Optional[int] = None,
    max_pages: Optional[int] = 3
) -> str:
    """Get Whoop workout data.
    
    Retrieves workout metrics including strain, calories, heart rate zones, and more.
    
    Args:
        start: Start date in YYYY-MM-DD format (optional). If not provided, 
               returns most recent data. Can also accept ISO format.
        end: End date in YYYY-MM-DD format (optional). If not provided, 
             uses current date. Can also accept ISO format.
        limit: Page size per request (max 25, default 10)
        max_pages: Maximum number of pages to fetch (default 3). None = no page cap.
        
    Returns:
        JSON string containing workout data (dict with 'records' key)
    """
    try:
        start_iso = _convert_date_to_iso(start, is_end_date=False)
        end_iso = _convert_date_to_iso(end, is_end_date=True)
        
        workouts = whoop.get_workouts(
            limit=limit,
            start=start_iso,
            end=end_iso,
            max_pages=max_pages
        )
        return json.dumps(workouts, indent=2, default=str)
    except ValueError as e:
        return json.dumps({
            "error": f"Invalid date format. Use YYYY-MM-DD or ISO format: {str(e)}"
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)

def main():
    # Initialize and run the server
    mcp.run(transport='stdio')

if __name__ == "__main__":
    main()
