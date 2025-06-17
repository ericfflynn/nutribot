import streamlit as st
from datetime import date
from database import init_db, SessionLocal, add_food, log_meal, get_meals_for_date

# Initialize DB
init_db()
session = SessionLocal()

st.set_page_config(page_title="NutriBot Meal Logger", layout="wide")
st.title("NutriBot Meal Logger (Test / Debug)")

# --- Add Food Form ---
st.header("Add a New Food")

with st.form("add_food_form"):
    food_name = st.text_input("Food name")
    serving_size = st.text_input("Serving size (e.g. '1 cup')")
    calories = st.number_input("Calories per serving", min_value=0.0)
    protein = st.number_input("Protein (g per serving)", min_value=0.0)
    fat = st.number_input("Fat (g per serving)", min_value=0.0)
    carbs = st.number_input("Carbs (g per serving)", min_value=0.0)
    submitted_food = st.form_submit_button("Add Food")

if submitted_food:
    add_food(session, food_name, serving_size, calories, protein, fat, carbs)

# --- Log Meal Form ---
st.header("Log a Meal")

with st.form("log_meal_form"):
    meal_type = st.selectbox("Meal type", ["breakfast", "lunch", "dinner", "snack"])
    meal_food_name = st.text_input("Food name (must match an existing food)")
    quantity = st.text_input("Quantity (as entered)")
    servings = st.number_input("Servings", min_value=0.0, value=1.0)
    notes = st.text_input("Notes (optional)")
    submitted_meal = st.form_submit_button("Log Meal")

if submitted_meal:
    log_meal(session, date.today(), meal_type, meal_food_name, quantity, servings, notes)

# --- Show today's meals ---
st.header("Today's Meals")
get_meals_for_date(session, date.today())

session.close()