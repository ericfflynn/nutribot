import pandas as pd


def compute_totals(df: pd.DataFrame) -> dict:
    """Compute nutrition totals from the dataframe."""
    totals = df[["calories", "protein_g", "carbs_g", "fat_g"]].sum()
    return {
        "calories": round(totals["calories"], 0),
        "protein_g": round(totals["protein_g"], 1),
        "carbs_g": round(totals["carbs_g"], 1),
        "fat_g": round(totals["fat_g"], 1),
    }
