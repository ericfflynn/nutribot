# NutriBot (Phase 1)

Phase 1 of NutriBot is a self-contained, Streamlit-based nutrition assistant. It runs entirely on your local machine, storing data in a lightweight SQLite database, with no external APIs or user profiles.

## Features

- Natural-language meal logging (e.g., “3 eggs and bacon and cheese”).
- Automatic extraction of each food item and its serving count.
- Macro breakdown: calories, protein, carbs, fat.
- Local persistence via SQLite.

## Project Structure

```plain
nutribot/
├── app.py             # Streamlit application entry point
├── nutribot/          # Core module
│   ├── __init__.py
│   ├── parser.py      # Ingredient parsing logic
│   ├── macros.py      # Macro calculation functions
│   └── db.py          # SQLite interface
├── requirements.txt   # Python dependencies
├── .gitignore         # Files and folders to ignore
└── README.md          # Project overview
