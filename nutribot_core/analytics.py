from datetime import datetime
from typing import Iterable, Optional

import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import func

from .models import Meal, MealItem


def meals_df(
    db: Session,
    start: datetime,
    end: datetime,
    meal_types: Optional[Iterable[str]] = None,
) -> pd.DataFrame:
    q = (
        db.query(
            Meal.meal_id,
            Meal.meal_datetime,
            Meal.meal_type,
            MealItem.calories,
            MealItem.protein,
            MealItem.carbs,
            MealItem.fat,
        )
        .join(MealItem, Meal.meal_id == MealItem.meal_id)
        .filter(Meal.meal_datetime >= start, Meal.meal_datetime <= end)
    )
    if meal_types:
        q = q.filter(Meal.meal_type.in_(list(meal_types)))

    rows = q.all()
    if not rows:
        return pd.DataFrame(
            columns=[
                "meal_id",
                "meal_datetime",
                "meal_type",
                "calories",
                "protein_g",
                "carbs_g",
                "fat_g",
            ]
        )

    df = pd.DataFrame(
        rows,
        columns=[
            "meal_id",
            "meal_datetime",
            "meal_type",
            "calories",
            "protein_g",
            "carbs_g",
            "fat_g",
        ],
    )

    # Aggregate item rows into meal-level totals
    agg = df.groupby(["meal_id", "meal_datetime", "meal_type"], as_index=False).sum(numeric_only=True)
    return agg


def totals_by_day(
    db: Session,
    start: datetime,
    end: datetime,
    meal_types: Optional[Iterable[str]] = None,
) -> pd.DataFrame:
    df = meals_df(db, start, end, meal_types)
    if df.empty:
        return df
    df["date"] = df["meal_datetime"].dt.date
    day = (
        df.groupby("date", as_index=False)[["calories", "protein_g", "carbs_g", "fat_g"]]
        .sum(numeric_only=True)
        .sort_values("date")
    )
    return day


def macros_by_meal_type(
    db: Session,
    start: datetime,
    end: datetime,
    meal_types: Optional[Iterable[str]] = None,
) -> pd.DataFrame:
    df = meals_df(db, start, end, meal_types)
    if df.empty:
        return df
    mt = df.groupby("meal_type", as_index=False)[["calories", "protein_g", "carbs_g", "fat_g"]].sum(numeric_only=True)
    return mt


def top_foods_by(
    db: Session,
    start: datetime,
    end: datetime,
    metric: str = "calories",
    n: int = 10,
) -> pd.DataFrame:
    metric_col = {
        "calories": MealItem.calories,
        "protein_g": MealItem.protein,
        "carbs_g": MealItem.carbs,
        "fat_g": MealItem.fat,
    }.get(metric, MealItem.calories)

    q = (
        db.query(
            MealItem.food_name.label("food"),
            func.sum(metric_col).label(metric),
        )
        .join(Meal, Meal.meal_id == MealItem.meal_id)
        .filter(Meal.meal_datetime >= start, Meal.meal_datetime <= end)
        .group_by(MealItem.food_name)
        .order_by(func.sum(metric_col).desc())
        .limit(n)
    )
    rows = q.all()
    if not rows:
        return pd.DataFrame(columns=["food", metric])
    return pd.DataFrame(rows, columns=["food", metric])


