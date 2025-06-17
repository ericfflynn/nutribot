import streamlit as st
from dotenv import load_dotenv
import os
import json
from pydantic import BaseModel
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, END

# === Load env ===
load_dotenv()

# === LLM ===
llm = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash",
    google_api_key=os.getenv("GEMINI_API_KEY"),
)

# === State ===
class NutriBotState(BaseModel):
    input: str
    thought: str | None = None
    action: str | None = None
    observation: str | None = None
    output: str | None = None

# === Nodes ===
def input_node(state: NutriBotState) -> NutriBotState:
    print(f"[INPUT NODE] User input: {state.input}")
    return state

def thought_node(state: NutriBotState) -> NutriBotState:
    prompt = (
        f"You are NutriBot. The user said: {state.input}\n"
        f"Decide what they want. If they describe food, plan to provide a macro breakdown. "
        f"If it's something else, plan an appropriate response. Reply as: 'Thought: ...'"
    )
    response = llm.invoke(prompt)
    state.thought = response.content if response and response.content else "No thought generated."
    print(f"[THOUGHT NODE] {state.thought}")
    return state

def action_node(state: NutriBotState) -> NutriBotState:
    if "macro" in (state.thought or "").lower() or "breakdown" in (state.thought or "").lower():
        state.action = "Provide macro breakdown"
    else:
        state.action = "Respond without macro breakdown"
    print(f"[ACTION NODE] {state.action}")
    return state

def observation_node(state: NutriBotState) -> NutriBotState:
    if state.action == "Provide macro breakdown":
        prompt = (
            f"You are a nutrition expert. Break down this meal: {state.input}\n"
            f"Provide a JSON array where each item includes food, calories, protein (g), carbs (g), and fat (g)."
        )
        response = llm.invoke(prompt)
        state.observation = response.content if response and response.content else "No observation generated."
    else:
        state.observation = state.thought
    print(f"[OBSERVATION NODE] {state.observation}")
    return state

def finalize_node(state: NutriBotState) -> NutriBotState:
    state.output = state.observation or "I'm not sure how to respond."
    print(f"[FINALIZE NODE] {state.output}")
    return state

# === Build graph ===
graph = StateGraph(state_schema=NutriBotState)
graph.add_node("input_node", input_node)
graph.add_node("thought_node", thought_node)
graph.add_node("action_node", action_node)
graph.add_node("observation_node", observation_node)
graph.add_node("finalize_node", finalize_node)

graph.set_entry_point("input_node")
graph.add_edge("input_node", "thought_node")
graph.add_edge("thought_node", "action_node")
graph.add_edge("action_node", "observation_node")
graph.add_edge("observation_node", "finalize_node")
graph.add_edge("finalize_node", END)

compiled_graph = graph.compile()

# === Streamlit ===
st.set_page_config(page_title="NutriBot", layout="wide", initial_sidebar_state="collapsed")

if "chat_history" not in st.session_state:
    st.session_state.chat_history = []
    st.session_state.chat_history.append(("ai", "Hi, I’m NutriBot. Tell me what you ate, and I’ll break it down for you!"))

for role, msg in st.session_state.chat_history:
    with st.chat_message(role):
        st.markdown(msg)

if user_input := st.chat_input("What did you eat?"):
    st.session_state.chat_history.append(("user", user_input))
    with st.chat_message("user"):
        st.markdown(user_input)

    result = compiled_graph.invoke({"input": user_input})
    output = result.get("output", "Sorry, I couldn’t process that.")
    st.session_state.chat_history.append(("ai", output))

    with st.chat_message("ai"):
        try:
            parsed = json.loads(output)
            st.json(parsed)
        except:
            st.markdown(output)