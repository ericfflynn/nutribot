from sqlalchemy import (
    create_engine, Column, Integer, Float, String, Date, ForeignKey
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

Base = declarative_base()

class Meal(Base):
    __tablename__ = "meals"
    meal_id    = Column(Integer, primary_key=True, autoincrement=True)
    date       = Column(Date, nullable=False)
    meal_type  = Column(String, nullable=False)
    # rename relationship to match new child model
    details    = relationship("MealDetail", back_populates="meal")

class Macro(Base):
    __tablename__ = "macros"
    food_id              = Column(Integer, primary_key=True)
    food_name            = Column(String,  nullable=False)
    default_serving_amt  = Column(Float,   nullable=False)
    default_serving_unit = Column(String,  nullable=False)
    calories             = Column(Float,   nullable=False)
    fat_g                = Column(Float,   nullable=False)
    carbs_g              = Column(Float,   nullable=False)
    protein_g            = Column(Float,   nullable=False)
    # backref to details
    details              = relationship("MealDetail", back_populates="macro")

class MealDetail(Base):
    __tablename__ = "meal_details"
    id        = Column(Integer, primary_key=True, autoincrement=True)
    meal_id   = Column(Integer, ForeignKey("meals.meal_id"), nullable=False)
    food_id   = Column(Integer, ForeignKey("macros.food_id"), nullable=False)
    servings  = Column(Float, nullable=False)

    meal      = relationship("Meal",  back_populates="details")
    macro     = relationship("Macro", back_populates="details")

def init_database(db_url: str = "sqlite:///nutribot.db"):
    """
    Create (if needed) the SQLite database and tables.
    Returns: (engine, SessionLocal)
    """
    engine = create_engine(db_url, echo=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    return engine, SessionLocal
