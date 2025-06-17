from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base, Food, Meal
from datetime import date
from memory.chroma_memory import add_food_to_chroma

engine = create_engine("sqlite:///nutribot.db")
SessionLocal = sessionmaker(bind=engine)

def init_db():
    Base.metadata.create_all(engine)

def add_food(session, name, serving_size, calories, protein, fat, carbs):
    existing = session.query(Food).filter(Food.name == name).first()
    if existing:
        print(f"Food '{name}' already exists in the database.")
        return existing
    food = Food(
        name=name,
        serving_size=serving_size,
        calories=calories,
        protein=protein,
        fat=fat,
        carbs=carbs
    )
    session.add(food)
    session.commit()
    add_food_to_chroma(name) 
    print(f"Added food: {name}")
    return food

def log_meal(session, meal_date, meal_type, food_name, quantity, servings, notes=None):
    """Log a meal by linking to existing food (or warn if food not found)."""
    food = session.query(Food).filter(Food.name == food_name).first()
    if not food:
        print(f"Food '{food_name}' not found. Please add it first.")
        return None
    meal = Meal(
        date=meal_date,
        meal_type=meal_type,
        food_id=food.id,
        quantity=quantity,
        servings=servings,
        notes=notes
    )
    session.add(meal)
    session.commit()
    print(f"Logged meal: {meal_type} - {servings} serving(s) of {food_name}")
    return meal

def get_meals_for_date(session, meal_date):
    """Retrieve meals for a given date."""
    meals = session.query(Meal).filter(Meal.date == meal_date).all()
    for meal in meals:
        total_cal = meal.servings * meal.food.calories
        print(f"{meal.date} {meal.meal_type}: {meal.servings} serving(s) of {meal.food.name} ({total_cal} kcal)")
    return meals
