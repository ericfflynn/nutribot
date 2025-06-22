"""Nutrition lookup tools for NutriBot (using USDA FoodData Central)."""

import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()  # reads USDA_API_KEY from .env

USDA_API_KEY = os.getenv("USDA_API_KEY")
SEARCH_URL   = "https://api.nal.usda.gov/fdc/v1/foods/search"

def usda_macro_lookup(food_name: str) -> str:
    """Fetch full nutrient list and macro summary for a food from USDA."""
    if not USDA_API_KEY:
        return json.dumps({"error": "USDA_API_KEY not set in .env"})

    params = {
        "query": food_name,
        "dataType": ["Foundation"],
        "pageSize": 1,
        "api_key": USDA_API_KEY
    }
    resp = requests.get(SEARCH_URL, params=params, timeout=5)
    if resp.status_code != 200:
        return json.dumps({"error": f"Search API error: {resp.status_code} {resp.text}"})

    foods = resp.json().get("foods", [])
    if not foods:
        return json.dumps({"error": f"No Foundation food found for '{food_name}'"})

    food = foods[0]
    all_nutrients = []
    for n in food.get("foodNutrients", []):
        # skip any malformed entries
        if not all(k in n for k in ("nutrientName", "value", "unitName")):
            continue
        all_nutrients.append({
            "name":  n["nutrientName"],
            "value": n["value"],
            "unit":  n["unitName"]
        })

    # build the macro summary
    summary = {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}
    for n in all_nutrients:
        name = n["name"].lower()
        val  = n["value"]
        if "energy" in name and summary["calories"] == 0:
            summary["calories"] = val
        elif name == "protein":
            summary["protein_g"] = val
        elif "carbohydrate" in name:
            summary["carbs_g"] = val
        elif "fat" in name or "lipid" in name:
            summary["fat_g"] = val

    output = {
        "food":             food.get("description", food_name),
        "nutrients_summary": summary,
        "all_nutrients":     all_nutrients
    }
    return json.dumps(output)

# register it as your sole tool; your prebuilt ReAct agent will pick it up automatically
TOOLS = [usda_macro_lookup]