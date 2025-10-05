from sqlalchemy.orm import Session
from nutribot_core.models import Meal, MealItem
from datetime import datetime


def _infer_meal_type(dt: datetime) -> str:
    hour = dt.hour
    if hour < 12:
        return "breakfast"
    if 12 <= hour <= 16:
        return "lunch"
    return "dinner"


def save_meal_response(db: Session, meal_response):
    now = datetime.now()
    inferred_type = _infer_meal_type(now)
    meal_type = getattr(meal_response, "meal_type", None) or inferred_type
    meal = Meal(meal_datetime=now, meal_type=meal_type)

    for item in meal_response.items:
        meal_item = MealItem(
            food_name=item.food,
            quantity=item.quantity,
            unit=item.unit,
            calories=item.calories,
            protein=item.protein_g,
            carbs=item.carbs_g,
            fat=item.fat_g,
        )
        meal.items.append(meal_item)

    db.add(meal)
    db.commit()
    db.refresh(meal)
    return meal
