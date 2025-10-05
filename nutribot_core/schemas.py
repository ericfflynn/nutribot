from pydantic import BaseModel
from typing import List, Literal, Optional


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
    meal_type: Optional[Literal["breakfast", "lunch", "dinner", "snack"]] = None
