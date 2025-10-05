# db.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = "sqlite:///./nutribot.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={
        "check_same_thread": False
    },  # SQLite thread-safety tweak for Streamlit
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
