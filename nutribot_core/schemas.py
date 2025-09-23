from pydantic import BaseModel
from typing import List

class FoodItem(BaseModel):
    food: str
    quantity: float
    unit: str
    calories: int
    protein_g: float
    carbs_g: float
    fat_g: float

class MealResponse(BaseModel):
    items: List[FoodItem]
