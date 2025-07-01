from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent 
from langgraph.checkpoint.memory import InMemorySaver
from .tools import TOOLS
from graph.db import init_db

init_db()
load_dotenv()

SYSTEM_PROMPT = (
    "You are NutriBot, an evidence-based nutrition assistant. "
    "When unsure, say so briefly."
)

llm = ChatOpenAI(model="gpt-4o", temperature=0.0)

saver = InMemorySaver()

agent = create_react_agent(
    model=llm,
    tools=TOOLS,
    prompt=SYSTEM_PROMPT,
    checkpointer=saver,
)

def build_agent():
    """Return the prebuilt ReAct agent ready for invocation."""
    return agent