"""
NutriBot – minimal graph, LLM-only intent classification
HUMAN → ANALYZE → (ACT_MACRO | FINALIZE) → END
"""

# ── imports ─────────────────────────────────────────────────────────────
import os, json, streamlit as st
from dotenv import load_dotenv
from typing import Literal
from pydantic import BaseModel, Extra
from langgraph.graph import StateGraph, END
from langchain_google_genai import ChatGoogleGenerativeAI

# ── env & llm ───────────────────────────────────────────────────────────
load_dotenv()
llm = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash",
    google_api_key=os.getenv("GEMINI_API_KEY"),
)
def ask_llm(prompt: str) -> str:
    r = llm.invoke(prompt)
    return r.content.strip() if r and r.content else ""

# ── state schema ────────────────────────────────────────────────────────
class S(BaseModel, extra=Extra.forbid):
    input: str
    intent: Literal["macro", "unknown"] | None = None
    observation: str | None = None
    output: str | None = None

# ── nodes ───────────────────────────────────────────────────────────────
def human(state: S) -> S:
    print("[HUMAN]", state.input)
    return state

def analyze(state: S) -> S:
    prompt = (
      "You are NutriBot's intent classifier.\n"
      "Decide whether the user message describes food they recently ate.\n"
      "If yes, respond ONLY with the single word: macro\n"
      "If not, respond ONLY with: unknown\n"
      f"Message: {state.input}\n"
      "Intent:"
    )
    intent_raw = ask_llm(prompt).split()[0].lower()
    state.intent = "macro" if intent_raw == "macro" else "unknown"
    print("[ANALYZE] intent →", state.intent)
    return state

def act_macro(state: S) -> S:
    prompt = (
        "You are a nutrition expert. Break down this meal into a JSON array "
        "with food, calories, protein_g, carbs_g, fat_g.\nMeal: " + state.input
    )
    state.observation = ask_llm(prompt)
    print("[ACT_MACRO]", state.observation)
    return state

def finalize(state: S) -> S:
    if state.intent == "macro" and state.observation:
        state.output = state.observation
    else:
        # Let Gemini answer any non-macro nutrition question naturally
        prompt = (
            "You are NutriBot, a professional nutrition coach. "
            "Answer the user's question helpfully, briefly, and accurately:\n\n"
            f"User: {state.input}"
        )
        state.output = ask_llm(prompt)
    print("[FINALIZE]", state.output)
    return state

# ── build graph ─────────────────────────────────────────────────────────
g = StateGraph(state_schema=S)
g.add_node("human", human)
g.add_node("analyze", analyze)
g.add_node("act_macro", act_macro)
g.add_node("finalize", finalize)

g.set_entry_point("human")
g.add_edge("human", "analyze")
g.add_conditional_edges("analyze", lambda s: s.intent,
                        {"macro": "act_macro", "unknown": "finalize"})
g.add_edge("act_macro", "finalize")
g.add_edge("finalize", END)
graph = g.compile()

# ── streamlit chat ui ───────────────────────────────────────────────────
st.set_page_config(page_title="NutriBot", layout="wide", initial_sidebar_state="collapsed")
debug = st.sidebar.checkbox("Debug: show state dict", False)

if "chat_history" not in st.session_state:
    st.session_state.chat_history = [
        ("ai", "👋 **Hi, I’m NutriBot.**  \nTell me what you ate and I’ll break down the macros!")
    ]

for role, msg in st.session_state.chat_history:
    with st.chat_message(role):
        try:
            st.json(json.loads(msg))
        except Exception:
            st.markdown(msg)

if user_input := st.chat_input("Your message…"):
    st.session_state.chat_history.append(("user", user_input))
    with st.chat_message("user"):
        st.markdown(user_input)

    state_out = graph.invoke({"input": user_input})
    reply = state_out["output"] or "⚠️ Sorry, I’m unsure."
    st.session_state.chat_history.append(("ai", reply))

    with st.chat_message("ai"):
        try:
            st.json(json.loads(reply))
        except Exception:
            st.markdown(reply)

    if debug:
        st.sidebar.code(json.dumps(state_out, indent=2))