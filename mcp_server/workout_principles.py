"""Load workout principles configuration from the JSON source of truth."""

import json
from pathlib import Path
from typing import Any


def load_workout_principles() -> dict[str, Any]:
    path = Path(__file__).parent / "config" / "workout_principles.json"
    if not path.exists():
        raise FileNotFoundError(f"Missing principles file: {path}")
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError("workout_principles.json must contain a JSON object at top level.")
    return data
