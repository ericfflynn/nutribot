from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from nutribot_core.db import Base


class Meal(Base):
    __tablename__ = "meals"

    meal_id = Column(Integer, primary_key=True, index=True)
    meal_datetime = Column(DateTime, default=datetime.now())
    # Nullable to preserve existing rows; constrained via application logic
    meal_type = Column(String, nullable=True, index=True)

    items = relationship(
        "MealItem", back_populates="meal", cascade="all, delete-orphan"
    )


class MealItem(Base):
    __tablename__ = "meal_items"

    item_id = Column(Integer, primary_key=True, index=True)
    meal_id = Column(Integer, ForeignKey("meals.meal_id"))
    food_name = Column(String)
    quantity = Column(Float)
    unit = Column(String)
    calories = Column(Float)
    protein = Column(Float)
    carbs = Column(Float)
    fat = Column(Float)

    meal = relationship("Meal", back_populates="items")
