import streamlit as st
from app.agent import create_agent

st.set_page_config(page_title="NutriBot", page_icon="🍎")
st.title("🍎 NutriBot — Your AI Nutrition Assistant")

# Initialize agent
if "agent" not in st.session_state:
    st.session_state.agent = create_agent()

# Chat input
user_input = st.text_input("Ask me anything about food, diet, or macros:")

if user_input:
    with st.spinner("Thinking..."):
        response = st.session_state.agent.run(user_input)
    st.markdown(f"**NutriBot:** {response}")
