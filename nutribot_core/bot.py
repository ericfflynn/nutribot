from openai import OpenAI
from .schemas import MealResponse


class NutriBot:
    def __init__(self, model="gpt-4.1-mini"):
        self.client = OpenAI()
        self.model = model

    def analyze_meal(self, user_input: str) -> MealResponse:
        """Take a user meal description and return structured nutrition facts."""
        resp = self.client.chat.completions.parse(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are NutriBot, a nutrition assistant. "
                        "The user will describe a meal in natural language. "
                        "Extract each food, quantity, and unit, and estimate "
                        "calories, protein_g, carbs_g, and fat_g. "
                        "Always return JSON that matches the MealResponse schema."
                    ),
                },
                {"role": "user", "content": user_input},
            ],
            response_format=MealResponse,
        )
        return resp.choices[0].message.parsed
