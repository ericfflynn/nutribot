import streamlit as st
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain.chains import ConversationChain
from langchain.memory import ConversationBufferMemory
from langchain.prompts import PromptTemplate
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

# Set up Streamlit page
st.set_page_config(
    page_title="NutriBot",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# LangChain prompt template
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

# LangChain setup
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
    st.session_state.chat_history.append(("ai", "Hi, I’m NutriBot. How can I help you with your nutrition today?"))

# Render chat history
for role, msg in st.session_state.chat_history:
    with st.chat_message(role):
        st.markdown(msg)

# Chat input
if user_input := st.chat_input("Type your question and hit Enter..."):
    # Add user message
    st.session_state.chat_history.append(("user", user_input))
    with st.chat_message("user"):
        st.markdown(user_input)

    # Get AI response
    response = conversation.run(user_input)
    st.session_state.chat_history.append(("ai", response))
    with st.chat_message("ai"):
        st.markdown(response)
