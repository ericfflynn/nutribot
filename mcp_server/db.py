"""Database helpers for journal persistence."""

import os
from datetime import date, datetime, timedelta
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Integer, String, Text, create_engine, text
from sqlalchemy.orm import Mapped, declarative_base, mapped_column, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL and DATABASE_URL.startswith("postgresql://") and "+psycopg" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

Base = declarative_base()
engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False) if DATABASE_URL else None
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine) if engine else None


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_date: Mapped[date] = mapped_column(Date, index=True)
    raw_text: Mapped[str] = mapped_column(Text)
    parse_status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    parse_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True
    )


class JournalEvent(Base):
    __tablename__ = "journal_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(32), index=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    confidence: Mapped[float] = mapped_column(Float, default=0.6)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class RecommendationFeedback(Base):
    __tablename__ = "recommendation_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recommendation: Mapped[str] = mapped_column(Text)
    helpful: Mapped[bool]
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    context_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


def db_available() -> bool:
    return engine is not None and SessionLocal is not None


def init_db() -> bool:
    if not db_available():
        return False
    Base.metadata.create_all(bind=engine)
    return True


def test_connection() -> bool:
    if not db_available():
        print("⚠️ DATABASE_URL not configured")
        return False
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1")).fetchone()
        print("✅ Database connection successful")
        return True
    except Exception as exc:
        print(f"❌ Database connection failed: {exc}")
        return False


def create_journal_entry(raw_text: str, entry_date: date) -> dict[str, Any]:
    with SessionLocal() as db:
        row = JournalEntry(entry_date=entry_date, raw_text=raw_text, parse_status="queued")
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"entry_id": row.id, "entry_date": row.entry_date.isoformat(), "parse_status": row.parse_status}


def set_parse_status(entry_id: int, status: str, parse_error: str | None = None) -> None:
    with SessionLocal() as db:
        row = db.query(JournalEntry).filter(JournalEntry.id == entry_id).first()
        if not row:
            return
        row.parse_status = status
        row.parse_error = parse_error
        db.commit()


def replace_journal_events(entry_id: int, events: list[dict[str, Any]]) -> int:
    with SessionLocal() as db:
        db.query(JournalEvent).filter(JournalEvent.entry_id == entry_id).delete()
        for evt in events:
            db.add(
                JournalEvent(
                    entry_id=entry_id,
                    event_type=str(evt.get("event_type", "other")),
                    payload_json=evt.get("payload", {}),
                    confidence=float(evt.get("confidence", 0.6)),
                )
            )
        db.commit()
        return len(events)


def get_parse_status(entry_id: int) -> dict[str, Any] | None:
    with SessionLocal() as db:
        row = db.query(JournalEntry).filter(JournalEntry.id == entry_id).first()
        if not row:
            return None
        return {
            "entry_id": row.id,
            "entry_date": row.entry_date.isoformat(),
            "parse_status": row.parse_status,
            "parse_error": row.parse_error,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }


def get_recent_entries(days: int = 7, limit: int = 20) -> list[dict[str, Any]]:
    start_date = date.today() - timedelta(days=max(days, 0))
    with SessionLocal() as db:
        rows = (
            db.query(JournalEntry)
            .filter(JournalEntry.entry_date >= start_date)
            .order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc())
            .limit(max(limit, 1))
            .all()
        )
        return [
            {
                "entry_id": row.id,
                "entry_date": row.entry_date.isoformat(),
                "raw_text": row.raw_text,
                "parse_status": row.parse_status,
            }
            for row in rows
        ]


def search_entries(query: str, limit: int = 10) -> list[dict[str, Any]]:
    with SessionLocal() as db:
        sql = text(
            """
            SELECT
              id,
              entry_date,
              raw_text,
              parse_status,
              ts_rank(to_tsvector('english', coalesce(raw_text,'')), plainto_tsquery('english', :q)) AS rank
            FROM journal_entries
            WHERE to_tsvector('english', coalesce(raw_text,'')) @@ plainto_tsquery('english', :q)
            ORDER BY rank DESC, entry_date DESC
            LIMIT :lim
            """
        )
        rows = db.execute(sql, {"q": query, "lim": max(limit, 1)}).fetchall()
        return [
            {
                "entry_id": row.id,
                "entry_date": row.entry_date.isoformat() if hasattr(row.entry_date, "isoformat") else str(row.entry_date),
                "raw_text": row.raw_text,
                "parse_status": row.parse_status,
                "rank": float(row.rank) if row.rank is not None else 0.0,
            }
            for row in rows
        ]


def get_journal_events(entry_id: int) -> list[dict[str, Any]]:
    with SessionLocal() as db:
        rows = (
            db.query(JournalEvent)
            .filter(JournalEvent.entry_id == entry_id)
            .order_by(JournalEvent.id.asc())
            .all()
        )
        return [
            {
                "id": row.id,
                "entry_id": row.entry_id,
                "event_type": row.event_type,
                "payload": row.payload_json,
                "confidence": row.confidence,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]


def get_recent_events(days: int = 7, limit: int = 200) -> list[dict[str, Any]]:
    start_date = date.today() - timedelta(days=max(days, 0))
    with SessionLocal() as db:
        sql = text(
            """
            SELECT
              e.id AS event_id,
              e.entry_id AS entry_id,
              je.entry_date AS entry_date,
              e.event_type AS event_type,
              e.payload_json AS payload_json,
              e.confidence AS confidence,
              e.created_at AS created_at
            FROM journal_events e
            JOIN journal_entries je ON je.id = e.entry_id
            WHERE je.entry_date >= :start_date
            ORDER BY je.entry_date DESC, e.id DESC
            LIMIT :lim
            """
        )
        rows = db.execute(sql, {"start_date": start_date, "lim": max(limit, 1)}).fetchall()
        return [
            {
                "event_id": row.event_id,
                "entry_id": row.entry_id,
                "entry_date": row.entry_date.isoformat() if hasattr(row.entry_date, "isoformat") else str(row.entry_date),
                "event_type": row.event_type,
                "payload": row.payload_json or {},
                "confidence": float(row.confidence) if row.confidence is not None else 0.0,
                "created_at": row.created_at.isoformat() if hasattr(row.created_at, "isoformat") else str(row.created_at),
            }
            for row in rows
        ]


def get_entries_with_empty_event_payload(limit: int = 50) -> list[dict[str, Any]]:
    with SessionLocal() as db:
        sql = text(
            """
            SELECT DISTINCT je.id AS entry_id, je.raw_text AS raw_text
            FROM journal_entries je
            JOIN journal_events e ON e.entry_id = je.id
            WHERE e.payload_json::text = '{}'
            ORDER BY je.id ASC
            LIMIT :lim
            """
        )
        rows = db.execute(sql, {"lim": max(limit, 1)}).fetchall()
        return [{"entry_id": row.entry_id, "raw_text": row.raw_text} for row in rows]


def save_recommendation_feedback(
    recommendation: str,
    helpful: bool,
    note: str | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with SessionLocal() as db:
        row = RecommendationFeedback(
            recommendation=recommendation,
            helpful=helpful,
            note=note,
            context_json=context,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {
            "id": row.id,
            "helpful": row.helpful,
            "note": row.note,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
