import chromadb
from chromadb.config import Settings

# Set up ChromaDB client (local persistent storage)
client = chromadb.Client(Settings(
    persist_directory="app/chroma_data"  # Chroma will save data here
))

# Get or create collection
collection = client.get_or_create_collection(name="foods")

def add_food_to_chroma(food_name):
    """Add food name to ChromaDB."""
    collection.add(
        documents=[food_name],
        ids=[food_name]
    )
    print(f"Added '{food_name}' to ChromaDB.")

def query_food_in_chroma(food_name, n_results=1):
    """Query for closest matching food name."""
    results = collection.query(
        query_texts=[food_name],
        n_results=n_results
    )
    if results['documents']:
        return results['documents'][0][0]  # Return best match
    return None
