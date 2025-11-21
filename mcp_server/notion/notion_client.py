"""Notion API client for fetching fitness benchmarks."""
import os
import requests
import json
from typing import List, Dict, Any
from dotenv import load_dotenv

load_dotenv()


class NotionClient:
    """Simple Notion API client for querying databases."""
    
    def __init__(self):
        """Initialize Notion client with API key from environment."""
        self.api_key = os.getenv("NOTION_API_KEY")
        self.data_source_id = "2b17c360-d675-8010-b582-000b65946f88"
        self.headers = {
            "accept": "application/json",
            "Notion-Version": "2025-09-03",
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
    
    def query_data_source(self, data_source_id: str) -> List[Dict]:
        """Query a data source and return raw pages."""
        url = f"https://api.notion.com/v1/data_sources/{data_source_id}/query"
        
        response = requests.post(url, headers=self.headers)
        response.raise_for_status()
        
        data = response.json()
        return data.get("results", [])


def _safe_text(prop: Dict, key: str = "title") -> str:
    """Safely extract text from title or rich_text property."""
    arr = prop.get(key, [])
    return arr[0]["plain_text"] if arr else None


def _safe_select(prop: Dict) -> str:
    """Safely extract select value."""
    select_obj = prop.get("select")
    return select_obj.get("name") if select_obj else None


def _safe_date(prop: Dict) -> str:
    """Safely extract date value."""
    date_obj = prop.get("date")
    return date_obj.get("start") if date_obj else None


def parse_fitness_benchmarks(pages: List[Dict]) -> List[Dict]:
    """Parse Notion pages into minimal fitness benchmark data.
    
    Args:
        pages: List of Notion page objects from API
        
    Returns:
        List of parsed benchmark dictionaries
    """
    benchmarks = []
    for page in pages:
        props = page.get("properties", {})
        benchmarks.append({
            "benchmark": _safe_text(props.get("Benchmark", {}), "title"),
            "category": _safe_select(props.get("Category", {})),
            "target": _safe_text(props.get("Target", {}), "rich_text"),
            "latest": _safe_text(props.get("Latest Test", {}), "rich_text"),
            "date": _safe_date(props.get("Test Date", {})),
            "units": _safe_text(props.get("Units", {}), "rich_text"),
        })
    return benchmarks


def get_fitness_benchmarks() -> str:
    """Get fitness benchmarks from Notion and return as JSON string.
    
    Returns:
        JSON string containing parsed fitness benchmarks
    """
    try:
        client = NotionClient()
        
        if not client.api_key:
            return json.dumps({"error": "NOTION_API_KEY not configured"})
        
        if not client.data_source_id:
            return json.dumps({"error": "Notion data source ID not configured"})
        
        # Get data source and query
        pages = client.query_data_source(client.data_source_id)
        
        # Parse to minimal structure
        benchmarks = parse_fitness_benchmarks(pages)
        
        # Return as compact JSON
        return json.dumps(benchmarks, separators=(',', ':'))
        
    except requests.exceptions.RequestException as e:
        return json.dumps({"error": f"Notion API error: {str(e)}"})
    except Exception as e:
        return json.dumps({"error": str(e)})

