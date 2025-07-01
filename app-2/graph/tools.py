"""Nutrition tools for NutriBot: parsing and USDA macro lookup with kcal-specific extraction and realistic servings."""

import os
import json
import requests
from dotenv import load_dotenv
from openai import OpenAI
from graph.db import log_meal, init_db, query_meals
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

load_dotenv()
USDA_API_KEY = os.getenv("USDA_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
client = OpenAI(api_key=OPENAI_API_KEY)

parse_foods_fn = {
    "name": "parse_meal",
    "description": (
        "Extract only the meal_type and foods (with servings) from a free-form meal string. "
        "Do NOT infer or return any dates or times."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "meal_type": {
                "type": "string",
                "description": "Breakfast, lunch, dinner, snack, etc."
            },
            "foods": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name":     {"type": "string"},
                        "servings": {"type": "number"}
                    },
                    "required": ["name", "servings"]
                }
            }
        },
        "required": ["meal_type", "foods"]
    }
}

def parse_meal(meal_str: str) -> str:
    """
    Extract meal_type and foods with servings from a free-form meal string.

    Args:
      meal_str (str): e.g. "I had 3 eggs and toast for breakfast yesterday"

    Returns:
      JSON string: {
        "meal_type": "breakfast",
        "foods": [
          {"name":"eggs","servings":3},
          {"name":"toast","servings":1}
        ]
      }
    """
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0.0,
        max_tokens=150,
        messages=[
            {"role":"system","content":"You are a nutrition parser. Only extract meal_type and foods."},
            {"role":"user","content":meal_str}
        ],
        functions=[parse_foods_fn],
        function_call={"name":"parse_meal"}
    )
    parsed = json.loads(resp.choices[0].message.function_call.arguments)
    return json.dumps(parsed)


# --- Helper: dynamic portion estimation via LLM ---
def estimate_portion_grams(food_name: str) -> float:
    """
    Ask the LLM to estimate a typical serving weight in grams for the given food.
    """
    prompt = (
        f"You are a nutrition expert. What is the typical serving size in grams for '{food_name}'? "
        "Respond with a single number, no units."
    )
    resp = client.chat.completions.create(
        model="gpt-4o-mini", 
        messages=[{"role": "user", "content": prompt}]
    )
    try:
        grams = float(resp.choices[0].message.content.strip())
    except ValueError:
        grams = 100.0
    return grams

# --- Tool 2: usda_macro_lookup ---
def usda_macro_lookup(food_name: str) -> str:
    """
    Fetch nutrient summary for a single food. Tries multiple USDA data types: Foundation, SR Legacy, Branded.
    Determines portion weight with priority: USDA servingSize, then foodPortions, then LLM if needed.
    Extracts calories specifically in KCAL units and ignores KJ entries.
    Returns JSON string.
    """
    if not USDA_API_KEY:
        return json.dumps({"error": "USDA_API_KEY not set in .env"})

    # 1) Fetch food entry across data types
    data_types = ["Foundation", "SR Legacy", "Branded"]
    food = None
    dt_used = None
    for dt in data_types:
        params = {"query": food_name, "dataType": [dt], "pageSize": 1, "api_key": USDA_API_KEY}
        resp = requests.get(SEARCH_URL, params=params, timeout=5)
        if resp.status_code != 200:
            continue
        results = resp.json().get("foods", [])
        if results:
            food = results[0]
            dt_used = dt
            break
    if not food:
        # fallback unfiltered
        resp = requests.get(SEARCH_URL, params={"query": food_name, "api_key": USDA_API_KEY}, timeout=5)
        foods = resp.json().get("foods", [])
        if foods:
            food = foods[0]
            dt_used = "unfiltered"
    if not food:
        return json.dumps({"error": f"No food found for '{food_name}' across data types"})

    # 2) Determine portion weight
    portion_weight = None
    serv_size = food.get("servingSize")
    serv_unit = (food.get("servingSizeUnit") or "").lower()
    if serv_size and serv_unit:
        if serv_unit in ("g", "gram", "grams"):
            portion_weight = serv_size
        elif serv_unit in ("oz", "ounce", "ounces"):
            portion_weight = serv_size * 28.35
        elif serv_unit in ("ml", "milliliter", "millilitre"):
            portion_weight = serv_size
    if portion_weight is None:
        for p in food.get("foodPortions", []):
            desc = (p.get("portionDescription") or p.get("modifier") or "").lower()
            if any(k in desc for k in ["serving", "slice", "strip", "piece"]):
                portion_weight = p.get("gramWeight")
                break
    if portion_weight is None:
        portion_weight = estimate_portion_grams(food_name)

    # 3) Build raw nutrient summary per 100g, prioritizing KCAL
    raw = {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}
    for n in food.get("foodNutrients", []):
        name = n.get("nutrientName", "").lower()
        unit = n.get("unitName", "").lower()
        val  = n.get("value", 0)
        # pick energy in KCAL only
        if raw["calories"] == 0 and "energy" in name and "kcal" in unit:
            raw["calories"] = val
        elif name == "protein":
            raw["protein_g"] = val
        elif "carbohydrate" in name:
            raw["carbs_g"] = val
        elif "fat" in name or "lipid" in name:
            raw["fat_g"] = val

    # 4) Scale to typical portion
    factor = portion_weight / 100
    portion_summary = {k: round(v * factor, 2) for k, v in raw.items()}

    return json.dumps({
        "food": food.get("description", food_name),
        "portion_weight_g": portion_weight,
        "data_type_used": dt_used,
        "nutrients_summary": portion_summary
    })

# --- Tool 3: log_meal_tool ---
def log_meal_tool(meal_json: str) -> str:
    """
    Log the meal into the DB. Expects JSON:
      { meal_type: str, foods: [ {name,servings,nutrients_summary}, ... ] }
    Returns {"meal_id": ...}.
    """
    data      = json.loads(meal_json)
    meal_type = data["meal_type"]
    items     = data["foods"]
    eaten_at  = data.get("eaten_at")  # full ISO if parser gave one

    # If parser omitted it, fall back to now
    if not eaten_at:
        eastern = ZoneInfo("America/New_York")
        eaten_at = datetime.now(eastern).isoformat()

    meal_id = log_meal(meal_type, items, eaten_at)
    return json.dumps({"meal_id": meal_id})

# --- Eastern‐aware date & time helpers ---

def get_today_date() -> str:
    """
    Returns today's date in Eastern Time (YYYY-MM-DD).
    """
    eastern = ZoneInfo("America/New_York")
    return datetime.now(eastern).date().isoformat()

def get_date_n_days_ago(days: int) -> str:
    """
    Returns the date N days ago in Eastern Time (YYYY-MM-DD).
    """
    eastern = ZoneInfo("America/New_York")
    return (datetime.now(eastern).date() - timedelta(days=days)).isoformat()

def get_current_datetime() -> str:
    """
    Returns the current date and time in Eastern Time as an ISO 8601 string.
    """
    eastern = ZoneInfo("America/New_York")
    return datetime.now(eastern).isoformat()

def query_meals_tool(
    start_date: str = None,
    end_date:   str = None,
    meal_type:  str = None,
    limit:      int    = 50
) -> str:
    """
    Retrieve full meals (with every item and per-meal totals) from the database.

    Args:
      start_date (str, optional): lower bound date (YYYY-MM-DD). If omitted, no lower bound.
      end_date   (str, optional): upper bound date (YYYY-MM-DD). If omitted, no upper bound.
      meal_type  (str, optional): filter by meal_type ('breakfast', 'lunch', etc.). If omitted, all types.
      limit      (int, optional): max number of meals to return (default: 50).
    """
    result = query_meals(start_date, end_date, meal_type, limit)
    return json.dumps(result)

def combine_date_and_meal_time(
    iso_date: str,
    meal_type: str
) -> str:
    """
    Given a date 'YYYY-MM-DD' and meal_type, returns an ISO datetime
    in America/New_York by attaching a default time:
      breakfast → 08:00, lunch → 12:00, dinner → 18:00, snack → 15:00
    """
    tz = ZoneInfo("America/New_York")
    date_part = datetime.fromisoformat(iso_date).date()
    defaults = {
        "breakfast": time(8,0),
        "lunch":     time(12,0),
        "dinner":    time(18,0),
        "snack":     time(15,0)
    }
    t = defaults.get(meal_type.lower(), datetime.now(tz).time())
    return datetime.combine(date_part, t, tzinfo=tz).isoformat()

TOOLS = [parse_meal, usda_macro_lookup, log_meal_tool, get_today_date, get_date_n_days_ago, get_current_datetime, query_meals_tool, combine_date_and_meal_time]