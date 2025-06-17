from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()

class Food(Base):
    __tablename__ = 'foods'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)  # e.g. "oatmeal"
    serving_size = Column(String, nullable=False)       # e.g. "1 cup"
    calories = Column(Float, nullable=False)            # per serving
    protein = Column(Float, nullable=False)             # g per serving
    fat = Column(Float, nullable=False)                 # g per serving
    carbs = Column(Float, nullable=False)               # g per serving

    # Optional: helpful to see linked meals
    meals = relationship("Meal", back_populates="food")

class Meal(Base):
    __tablename__ = 'meals'

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False)
    meal_type = Column(String, nullable=False)  # breakfast/lunch/etc.
    food_id = Column(Integer, ForeignKey('foods.id'), nullable=False)
    quantity = Column(String)                   # user-entered, e.g. "1 cup"
    servings = Column(Float, nullable=False)    # how many standard servings
    notes = Column(String)

    food = relationship("Food", back_populates="meals")