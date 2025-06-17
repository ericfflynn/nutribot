from database import init_db, SessionLocal, add_food, log_meal, get_meals_for_date
from datetime import date

init_db()
session = SessionLocal()

# Add food
add_food(session, "oatmeal", "1 cup", 150, 5, 3, 27)
add_food(session, "banana", "1 medium", 105, 1.3, 0.4, 27)

# Log meals
log_meal(session, date.today(), "breakfast", "oatmeal", "1 cup", 1.0)
log_meal(session, date.today(), "breakfast", "banana", "1 medium", 1.0)

# Query meals
get_meals_for_date(session, date.today())

session.close()
