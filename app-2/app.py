import streamlit as st
from dotenv import load_dotenv
from uuid import uuid4
from graph.agent import build_agent
from langchain_core.messages import HumanMessage

load_dotenv()
st.set_page_config(page_title="NutriBot", page_icon="🥑")
st.title("🥑 NutriBot")

# initialize
if "agent" not in st.session_state:
    st.session_state.agent = build_agent()
if "thread_id" not in st.session_state:
    st.session_state.thread_id = str(uuid4())
if "history" not in st.session_state:
    st.session_state.history = []

def run_agent(user_text: str) -> str:
    run = st.session_state.agent.invoke(
        {"messages": [{"role": "user", "content": user_text}]},
        {"configurable": {"thread_id": st.session_state.thread_id}}
    )
    return run["messages"][-1].content

# handle input
prompt = st.chat_input("Ask me about nutrition…")
if prompt:
    st.session_state.history.append(("user", prompt))
    reply = run_agent(prompt)
    st.session_state.history.append(("assistant", reply))

# render full conversation
for role, msg in st.session_state.history:
    st.chat_message(role).write(msg)