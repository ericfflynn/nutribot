# graph/agent.py

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import InMemorySaver

from graph.models import init_database    # <-- raw initializer
from graph.tools  import TOOLS

# 1) Create your SQLite DB & tables now (only once)
_engine, _SessionLocal = init_database()

# 2) Load env vars (USDA_API_KEY, etc.)
load_dotenv()

# 3) System prompt
SYSTEM_PROMPT = """
You are NutriBot, an evidence-based nutrition assistant.
You help users track their meals, suggest foods, and answer nutrition questions.
When told what a user ate, you:
1. Identify the food and its macros (calories, fat, carbs, protein).
2. Store the meal in the database, along with the food and its macros.
3. If the food is not recognized, ask the user for more details.
"""

# 4) LLM & memory
llm = ChatOpenAI(model="gpt-4o", temperature=0.0)
saver = InMemorySaver()

# 5) Build the agent
agent = create_react_agent(
    model=llm,
    tools=TOOLS,
    prompt=SYSTEM_PROMPT,
    checkpointer=saver,
)

def build_agent():
    return agent
