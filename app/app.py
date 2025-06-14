import streamlit as st
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain.chains import ConversationChain
from langchain.memory import ConversationBufferMemory
from langchain.prompts import PromptTemplate
from dotenv import load_dotenv
import os

# Load env vars
load_dotenv()

# Set Streamlit config
st.set_page_config(page_title="NutriBot", layout="wide")

# NutriBot system prompt
instructions = PromptTemplate.from_template(
    """
    You are NutriBot, an expert nutrition assistant that gives personalized, practical advice.
    Use clear, concise responses and assume the user is asking about healthy eating unless otherwise stated.

    Current conversation:
    {history}
    Human: {input}
    AI:
    """
)

# Set up LangChain
llm = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash",
    google_api_key=os.getenv("GEMINI_API_KEY"),
)

conversation = ConversationChain(
    llm=llm,
    memory=ConversationBufferMemory(),
    prompt=instructions,
)

# Initialize chat history
if "chat_history" not in st.session_state:
    st.session_state.chat_history = []
    # Add greeting on first load
    greeting = "Hi, I’m NutriBot. How can I help you with your nutrition today?"
    st.session_state.chat_history.append(("NutriBot", greeting))

# Display chat history
for speaker, text in st.session_state.chat_history:
    st.markdown(f"**{speaker}:** {text}")

# Input box and button
user_input = st.text_input("Type your message:", key="input", placeholder="Ask me anything about nutrition...", on_change=None)

# Handle input submission
if user_input:
    response = conversation.run(user_input)
    st.session_state.chat_history.append(("You", user_input))
    st.session_state.chat_history.append(("NutriBot", response))
    # Clear input (force rerun)
    st.experimental_rerun()