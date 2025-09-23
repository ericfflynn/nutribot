import streamlit as st
import pandas as pd
from nutribot_core.bot import NutriBot
from nutribot_core.utils import compute_totals

st.set_page_config(page_title="NutriBot", page_icon="🥗")

st.title("🥗 NutriBot (Phase 1.3)")
st.write("Enter your meal and get structured nutrition facts.")

# --- Session state to hold results ---
if "parsed" not in st.session_state:
    st.session_state.parsed = None

# --- Input box ---
user_input = st.text_input("What did you eat?", key="meal_input")

col1, col2 = st.columns([3, 1])
with col1:
    analyze = st.button("Analyze")
with col2:
    reset = st.button("Reset")

# --- Reset button clears state ---
if reset:
    st.session_state.clear()
    st.session_state.meal_input = "" 
    st.rerun()

# --- Analyze button triggers NutriBot ---
if analyze and user_input:
    with st.spinner("Analyzing..."):
        bot = NutriBot()
        parsed = bot.analyze_meal(user_input)
        st.session_state.parsed = parsed

# --- Show results if available ---
if st.session_state.parsed:
    parsed = st.session_state.parsed

    # Convert items → DataFrame
    rows = [item.model_dump() for item in parsed.items]
    df = pd.DataFrame(rows)

    # Round values
    df = df.round({"calories": 0, "protein_g": 1, "carbs_g": 1, "fat_g": 1})

    # --- Totals as cards ---
    totals = compute_totals(df)
    st.subheader("Meal Totals")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Calories", f"{int(totals['calories'])} kcal")
    c2.metric("Protein", f"{totals['protein_g']} g")
    c3.metric("Carbs", f"{totals['carbs_g']} g")
    c4.metric("Fat", f"{totals['fat_g']} g")

    # --- Table view ---
    st.subheader("Breakdown by Food")
    st.dataframe(df)

    # --- Debug JSON ---
    with st.expander("Raw JSON (debug)"):
        st.json(parsed.model_dump(), expanded=False)
