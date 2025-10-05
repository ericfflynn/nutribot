# 🥗 NutriBot

NutriBot is an interactive nutrition assistant powered by OpenAI and Streamlit.  
It takes free-form meal descriptions (e.g. *“I ate 2 eggs and a banana”*) and returns structured nutrition facts in a clean UI with both table and totals view.

---

## 🚀 Features (Current)

- Enter any meal in natural language.
- AI parses foods, quantities, and estimates nutrition values (FoodItem list).
- Save meals to SQLite (`nutribot.db`) with `meal_type` (auto-infer or manual).
- Results displayed as:
  - **Totals cards** (Calories, Protein, Carbs, Fat)
  - **Breakdown table** by food item
- Basic analytics (on main page):
  - Date range and meal-type filter
  - **Daily calories** line chart (date-only axis)
  - **Top foods by calories** bar chart (descending)
- Streamlit wide layout
- One-click seeding script for fake historical data

---

## ⚡ Quickstart
Sync the environment (installs deps from `pyproject.toml`/`uv.lock`) and run the app:
```bash
uv sync
uv run streamlit run app/main.py
```
Optional: set your OpenAI key in a `.env` file at repo root:
```bash
echo "OPENAI_API_KEY=sk-..." >> .env
```
## 🌱 Seeding Data (optional)

Generate ~30 days of random meals/items:
```bash
uv run python scripts/seed_fake_data.py
```

Notes:
- Run from the repo root so `sqlite:///./nutribot.db` resolves correctly.
- Close the Streamlit app during seeding to avoid SQLite locks.

---

## 🗄️ Database

- SQLite database at `nutribot.db` (path: `sqlite:///./nutribot.db`).
- Tables are created and columns ensured by an idempotent initializer at startup.
- You can also run it manually:
```bash
python -m nutribot_core.init_db
```

---

## 🧭 Project Plan

See `plan.md` for the full roadmap. Highlights:

- North Star: unified health timeline (meals, activities, recovery) + conversational analytics
- Phases:
  - Solidify core and service boundaries
  - Multi-source foundations (Whoop-ready) with normalized DataFrames
  - Analytics services and cross-domain features
  - Conversational layer (pre-MCP), then MCP when tool boundaries stabilize
  - Personalization, policies, and programmatic actions
- Cross-cutting: privacy, provenance, eval/QA, cost control
