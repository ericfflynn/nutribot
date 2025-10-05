# init_db.py
from nutribot_core.db import Base, engine
from nutribot_core.models import Meal, MealItem
from sqlalchemy import inspect, text


def init_db():
    Base.metadata.create_all(bind=engine)
    # Idempotent migration: add meal_type column if missing
    with engine.begin() as conn:
        inspector = inspect(conn)
        columns = {col["name"] for col in inspector.get_columns("meals")}
        if "meal_type" not in columns:
            conn.execute(text("ALTER TABLE meals ADD COLUMN meal_type TEXT"))


if __name__ == "__main__":
    init_db()
