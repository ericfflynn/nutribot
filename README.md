# 🥗 NutriBot

NutriBot is an interactive nutrition assistant powered by OpenAI and Streamlit.  
It takes free-form meal descriptions (e.g. *“I ate 2 eggs and a banana”*) and returns structured nutrition facts in a clean UI with both table and totals view.

---

## 🚀 Features (Phase 1.3)

- Enter any meal in natural language.
- AI parses foods, quantities, and estimates nutrition values.
- Results displayed as:
  - **Totals cards** (Calories, Protein, Carbs, Fat).
  - **Breakdown table** by food item.
  - **Raw JSON output** (for debugging).
- **Reset button** clears input and results for a fresh start.
- Rounded values for consistent display:
  - Calories → whole numbers.
  - Protein/Carbs/Fat → 1 decimal.
