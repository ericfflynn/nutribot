"""Compile and return the NutriBot ReAct agent (tools + memory + prompt)."""

import os
from dotenv import load_dotenv

load_dotenv()
if not os.getenv("OPENAI_API_KEY"):
    raise RuntimeError("OPENAI_API_KEY missing—add it to .env")

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent               # :contentReference[oaicite:0]{index=0}
from langgraph.checkpoint.memory import InMemorySaver
from .tools import TOOLS

SYSTEM_PROMPT = (
    "You are NutriBot, an evidence-based nutrition assistant. "
    "When unsure, say so briefly."
)

# 1. init your LLM (pass in any kwargs you like: temperature, etc.)
llm = ChatOpenAI(model="gpt-4o", temperature=0.0)

# 2. choose a checkpointer for short-term memory
saver = InMemorySaver()

# 3. create the ReAct‐style agent in one call
agent = create_react_agent(
    model=llm,
    tools=TOOLS,
    prompt=SYSTEM_PROMPT,
    checkpointer=saver,
)

def build_agent():
    """Return the prebuilt ReAct agent ready for invocation."""
    return agent

