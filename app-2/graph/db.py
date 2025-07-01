import sqlite3
import json
from typing import List, Dict

DB_PATH = "nutribot.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
      CREATE TABLE IF NOT EXISTS meals (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        eaten_at   DATE    NOT NULL,
        meal_type  TEXT    NOT NULL
      )
    """)
    cur.execute("""
      CREATE TABLE IF NOT EXISTS meal_items (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        meal_id   INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
        name      TEXT    NOT NULL,
        servings  REAL    NOT NULL,
        calories  REAL    NOT NULL,
        protein_g REAL    NOT NULL,
        carbs_g   REAL    NOT NULL,
        fat_g     REAL    NOT NULL
      )
    """)
    conn.commit()
    conn.close()

def log_meal(
    meal_type: str,
    items: List[Dict],
    eaten_at:  str = None
) -> int:
    """
    Insert a meal with an explicit ISO eaten_at or use default CURRENT_TIMESTAMP.
    Returns the new meal_id.
    """
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    if eaten_at:
        # Use provided timestamp
        cur.execute(
            "INSERT INTO meals(eaten_at, meal_type) VALUES (?, ?)",
            (eaten_at, meal_type)
        )
    else:
        # Use default timestamp in SQLite
        cur.execute(
            "INSERT INTO meals(meal_type) VALUES (?)",
            (meal_type,)
        )

    meal_id = cur.lastrowid

    for it in items:
        ns    = it["nutrients_summary"]
        cal   = ns.get("calories", 0) * it["servings"]
        prot  = ns.get("protein_g", 0) * it["servings"]
        carbs = ns.get("carbs_g", 0)   * it["servings"]
        fat   = ns.get("fat_g", 0)     * it["servings"]

        cur.execute("""
          INSERT INTO meal_items(
            meal_id, name, servings, calories, protein_g, carbs_g, fat_g
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (meal_id, it["name"], it["servings"], cal, prot, carbs, fat))

    conn.commit()
    conn.close()
    return meal_id

def query_meals(
    start_date: str = None,
    end_date:   str = None,
    meal_type:  str = None,
    limit:      int    = 50
) -> List[Dict]:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 1) pick up to `limit` meals
    meal_sql = ["SELECT id, eaten_at, meal_type FROM meals WHERE 1=1"]
    params = []
    if start_date:
        meal_sql.append("AND DATE(eaten_at) >= ?"); params.append(start_date)
    if end_date:
        meal_sql.append("AND DATE(eaten_at) <= ?"); params.append(end_date)
    if meal_type:
        meal_sql.append("AND meal_type = ?"); params.append(meal_type)
    meal_sql.append("ORDER BY eaten_at DESC LIMIT ?"); params.append(limit)

    cur.execute(" ".join(meal_sql), params)
    meal_rows = cur.fetchall()
    if not meal_rows:
        conn.close()
        return []

    meals = {
        mid: {
            "meal_id":  mid,
            "eaten_at": eaten_at,
            "meal_type": mtype,
            "items":    [],
            "totals":   {"calories":0, "protein_g":0, "carbs_g":0, "fat_g":0}
        }
        for mid, eaten_at, mtype in meal_rows
    }

    # 2) fetch all items for those meals
    placeholders = ",".join("?" for _ in meals)
    cur.execute(f"""
      SELECT meal_id, name, servings, calories, protein_g, carbs_g, fat_g
      FROM meal_items
      WHERE meal_id IN ({placeholders})
    """, list(meals.keys()))
    item_rows = cur.fetchall()
    conn.close()

    # assemble items + totals
    for mid, name, srv, cal, pr, cb, ft in item_rows:
        meals[mid]["items"].append({
            "name":       name,
            "servings":   srv,
            "calories":   cal,
            "protein_g":  pr,
            "carbs_g":    cb,
            "fat_g":      ft
        })
        meals[mid]["totals"]["calories"]  += cal
        meals[mid]["totals"]["protein_g"] += pr
        meals[mid]["totals"]["carbs_g"]   += cb
        meals[mid]["totals"]["fat_g"]     += ft

    return list(meals.values())