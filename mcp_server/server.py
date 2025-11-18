from mcp.server.fastmcp import FastMCP
from nutribot_core.meal_analyzer import MealAnalyzer
import json

# Initialize FastMCP server
mcp = FastMCP("nutribot")

# Initialize MealAnalyzer
meal_analyzer = MealAnalyzer()

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

def main():
    # Initialize and run the server
    mcp.run(transport='stdio')

if __name__ == "__main__":
    main()
