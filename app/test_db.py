from database import init_db, SessionLocal
from models import Food, Meal
from datetime import date

# Initialize DB + tables
init_db()

# Start a DB session
session = SessionLocal()

# Add a food
oatmeal = Food(
    name="oatmeal",
    serving_size="1 cup",
    calories=150,
    protein=5,
    fat=3,
    carbs=27
)
session.add(oatmeal)
session.commit()

# Add a meal linked to that food
meal = Meal(
    date=date.today(),
    meal_type="breakfast",
    food_id=oatmeal.id,
    quantity="1 cup",
    servings=1.0,
    notes="With honey"
)
session.add(meal)
session.commit()

# Query and print
for m in session.query(Meal).all():
    print(f"{m.date} {m.meal_type}: {m.servings} serving(s) of {m.food.name}")

session.close()
