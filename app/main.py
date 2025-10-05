import streamlit as st
import pandas as pd
from nutribot_core.bot import NutriBot
from nutribot_core.utils import compute_totals
from nutribot_core.db import SessionLocal
from nutribot_core.crud import save_meal_response
from nutribot_core.analytics import totals_by_day, macros_by_meal_type, top_foods_by
from datetime import datetime, timedelta
import altair as alt

st.set_page_config(page_title="NutriBot", page_icon="🥗", layout="wide")

st.title("🥗 NutriBot (Phase 1.3)")
st.subheader("Logging")
st.write("Enter your meal and get structured nutrition facts.")

if "parsed" not in st.session_state:
    st.session_state.parsed = None
if "meal_type_choice" not in st.session_state:
    st.session_state.meal_type_choice = "Auto (infer)"

user_input = st.text_input("What did you eat?", key="meal_input")
meal_type_choice = st.selectbox(
    "Meal type",
    options=["Auto (infer)", "breakfast", "lunch", "dinner", "snack"],
    index=["Auto (infer)", "breakfast", "lunch", "dinner", "snack"].index(
        st.session_state.meal_type_choice
    ),
    key="meal_type_choice",
)

col1, col2, col3 = st.columns([1, 1, 1])
with col1:
    analyze = st.button("Analyze")
with col2:
    save_meal = st.button("Save Meal")
with col3:
    reset = st.button("Reset")

if reset:
    st.session_state.clear()
    st.session_state.meal_input = ""
    st.rerun()

if analyze and user_input:
    with st.spinner("Analyzing..."):
        bot = NutriBot()
        parsed = bot.analyze_meal(user_input)
        st.session_state.parsed = parsed

if save_meal and st.session_state.parsed:
    with st.spinner("Saving to database..."):
        db = SessionLocal()
        # If user selected a specific meal type, attach it to the parsed object
        parsed = st.session_state.parsed
        if meal_type_choice != "Auto (infer)":
            parsed.meal_type = meal_type_choice
        save_meal_response(db, parsed)
        db.close()
    st.success("Meal saved!")

if st.session_state.parsed:
    parsed = st.session_state.parsed

    # Convert items → DataFrame
    rows = [item.model_dump() for item in parsed.items]
    df = pd.DataFrame(rows)
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

    # # --- Debug JSON ---
    # with st.expander("Raw JSON (debug)"):
    #     st.json(parsed.model_dump(), expanded=False)

# --- Analytics (basic, interactive) ---
st.markdown("---")
st.subheader("Analytics")

colf1, colf2 = st.columns(2)
with colf1:
    start_date = st.date_input("Start date", value=(datetime.now().date() - timedelta(days=14)))
with colf2:
    end_date = st.date_input("End date", value=datetime.now().date())

meal_filter = st.multiselect(
    "Filter by meal type",
    options=["breakfast", "lunch", "dinner", "snack"],
)

db = SessionLocal()
start_dt = datetime.combine(start_date, datetime.min.time())
end_dt = datetime.combine(end_date, datetime.max.time())

day_df = totals_by_day(db, start_dt, end_dt, meal_filter)
mt_df = macros_by_meal_type(db, start_dt, end_dt, meal_filter)
top_df = top_foods_by(db, start_dt, end_dt, metric="calories", n=10)
db.close()

if day_df is not None and not day_df.empty:
    st.markdown("Daily calories")
    day_plot_df = day_df[["date", "calories"]].copy()
    day_plot_df["date_str"] = day_plot_df["date"].astype(str)
    line = alt.Chart(day_plot_df).mark_line(point=True).encode(
        x=alt.X('date_str:N', title='Date'),
        y=alt.Y('calories:Q', title='Calories'),
        tooltip=[alt.Tooltip('date_str:N', title='Date'), alt.Tooltip('calories:Q', title='Calories')]
    ).properties(height=300)
    st.altair_chart(line, use_container_width=True)
else:
    st.info("No data for selected range.")

cols = st.columns(2)
with cols[0]:
    if mt_df is not None and not mt_df.empty:
        st.markdown("Macros by meal type")
        st.bar_chart(mt_df.set_index("meal_type")[['protein_g', 'carbs_g', 'fat_g']])
with cols[1]:
    if top_df is not None and not top_df.empty:
        st.markdown("Top foods by calories")
        # Altair bar chart with explicit descending sort
        top_sorted = top_df.sort_values("calories", ascending=False)
        bar = alt.Chart(top_sorted).mark_bar().encode(
            x=alt.X('calories:Q', title='Calories'),
            y=alt.Y('food:N', sort='-x', title='Food'),
            tooltip=[alt.Tooltip('food:N'), alt.Tooltip('calories:Q')]
        ).properties(height=300)
        st.altair_chart(bar, use_container_width=True)
