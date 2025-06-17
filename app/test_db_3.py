from database import init_db, SessionLocal
from memory.chroma_memory import add_food_to_chroma, query_food_in_chroma

init_db()
session = SessionLocal()

# Force add to Chroma (skip SQLite insert logic for now)
add_food_to_chroma("oatmeal")
add_food_to_chroma("banana")
add_food_to_chroma("chicken breast")

# Now query Chroma
match1 = query_food_in_chroma("oats")
print(f"Best match for 'oats': {match1}")

match2 = query_food_in_chroma("chikn")
print(f"Best match for 'chikn': {match2}")

session.close()
