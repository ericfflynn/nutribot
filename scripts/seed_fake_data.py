from datetime import datetime, timedelta
import random

from nutribot_core.db import SessionLocal
from nutribot_core.models import Meal, MealItem
from nutribot_core.init_db import init_db


FOODS = [
    ("oatmeal", 150, 5, 27, 3),
    ("egg", 70, 6, 0.6, 5),
    ("banana", 105, 1.3, 27, 0.4),
    ("chicken breast", 165, 31, 0, 4),
    ("rice", 206, 4.2, 45, 0.4),
    ("salad", 80, 2, 10, 3),
    ("yogurt", 120, 10, 15, 3),
    ("almonds", 170, 6, 6, 15),
    ("apple", 95, 0.5, 25, 0.3),
    ("steak", 250, 26, 0, 17),
]


def infer_meal_type(dt: datetime) -> str:
    h = dt.hour
    if h < 12:
        return "breakfast"
    if 12 <= h <= 16:
        return "lunch"
    return "dinner"


def seed(days: int = 30, meals_per_day: tuple[int, int] = (2, 4)):
    init_db()
    db = SessionLocal()
    try:
        now = datetime.now()
        for d in range(days, 0, -1):
            date_base = now - timedelta(days=d)
            mcount = random.randint(*meals_per_day)
            for _ in range(mcount):
                # random meal time in the day
                hour = random.choice([8, 10, 13, 15, 18, 20])
                minute = random.randint(0, 59)
                dt = date_base.replace(hour=hour, minute=minute, second=0, microsecond=0)
                mt = infer_meal_type(dt)
                meal = Meal(meal_datetime=dt, meal_type=mt)

                # choose 1-3 foods
                for food_name, cals, pro, carb, fat in random.sample(FOODS, random.randint(1, 3)):
                    qty = random.choice([1, 1.5, 2])
                    meal.items.append(
                        MealItem(
                            food_name=food_name,
                            quantity=qty,
                            unit="serving",
                            calories=cals * qty,
                            protein=pro * qty,
                            carbs=carb * qty,
                            fat=fat * qty,
                        )
                    )
                db.add(meal)
        db.commit()
        print("Seeded fake data successfully.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
