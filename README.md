# NutriBot - AI-Powered Health Assistant with MCP Integration

A conversational AI assistant powered by GPT-4o-mini that combines nutrition analysis with fitness data from Whoop, built using the Model Context Protocol (MCP) to create a modular, extensible architecture.

## Key Features

### **MCP Server Architecture**
- **Modular Tool System**: Built with FastMCP, exposing tools as reusable functions
- **Persistent Connections**: Maintains a single stdio connection to the MCP server for the entire chat session, enabling state persistence and efficient resource usage
- **ReAct Pattern**: Implements Reasoning + Acting loop, allowing the LLM to chain multiple tool calls intelligently
- **Whoop SDK Integration**: Seamlessly integrates with `whoop-sdk` (PyPI) for real-time fitness data access

### **AI Capabilities (Powered by GPT-4o-mini)**
- **Natural Language Nutrition Analysis**: Parse free-form meal descriptions and extract structured nutrition data
- **Multi-Step Reasoning**: Automatically determines when to fetch current date, then use it for date-based queries
- **Context-Aware Responses**: Maintains conversation history and uses appropriate tools based on user intent

### **Data Sources**
- **Nutrition Data**: AI-powered meal parsing with macro breakdowns
- **Whoop Fitness Data**: Access to sleep, recovery, workouts, and user profile
- **Date-Aware Queries**: Automatically handles relative dates ("last night", "this week") by fetching current date first

## Architecture

```
┌─────────────────────────────────────┐
│      ChatInterface (Orchestrator)   │
│  - ReAct Loop (Reasoning + Acting)  │
│  - Single Event Loop Management     │
└─────────────────────────────────────┘
           │
           ├──► Conversation (State Management)
           ├──► OpenAIClient (LLM Communication)
           ├──► ToolRouter (Tool Call Routing)
           └──► MCPClient (Persistent Connection)
                    │
                    └──► MCP Server (stdio)
                         ├──► MealAnalyzer
                         └──► Whoop SDK
```

### **Key Design Decisions**

1. **Persistent MCP Connection**: The MCP server stays alive for the entire chat session, allowing:
   - Server-side state to persist (e.g., `whoop.login()` authentication)
   - Faster tool calls (no startup overhead)
   - Efficient resource usage (one process vs. many)

2. **ReAct Pattern Implementation**: The LLM can reason about what it needs, act by calling tools, observe results, and repeat until it has enough information:

3. **Modular Architecture**: Each component has a single responsibility:
   - `Conversation`: Manages message history
   - `OpenAIClient`: Handles LLM API calls
   - `ToolRouter`: Routes tool calls to MCP
   - `MCPClient`: Manages persistent stdio connection
   - `ChatInterface`: Orchestrates the flow

## Example Interactions


**User:** "How many workouts have I hit so far this week. Give me a summary"

**System Response:**
```
 ReAct iteration 1...
🔧 LLM wants to call 1 tool(s)

🔧 Calling 'get_current_date' on MCP server with args: {}
Processing request of type CallToolRequest
✅ MCP server returned: 2025-11-19...

🤖 ReAct iteration 2...
🔧 LLM wants to call 1 tool(s)


🔧 Calling 'get_whoop_workouts' on MCP server with args: {'start': '2025-11-13', 'end': '2025-11-19'}
Processing request of type CallToolRequest
✅ MCP server returned: {
  "records": [
    {
      "id": "fafa41e0-53cd-46ea-be2e-1c7ed8b5590c",
      "v1_id": null,
    ...

🤖 ReAct iteration 3...
✅ LLM has final answer (no more tool calls)

Assistant: So far this week (from November 13 to November 19, 2025), you have completed **8 workouts**. Here's a summary of each workout:

1. **November 13, 2025** - Weightlifting
   - Duration: ~50 minutes
   - Strain: 7.60
   - Average Heart Rate: 117 bpm
   - Max Heart Rate: 157 bpm
   - Calories Burned: 1208.53 kJ

2. **November 14, 2025** - Table Tennis
   - Duration: ~37 minutes
   - Strain: 5.44
   - Average Heart Rate: 106 bpm
   - Max Heart Rate: 142 bpm
   - Calories Burned: 527.62 kJ

3. **November 14, 2025** - Weightlifting
   - Duration: ~52 minutes
   - Strain: 7.91
   - Average Heart Rate: 117 bpm
   - Max Heart Rate: 169 bpm
   - Calories Burned: 1257.06 kJ

[... continues with all 8 workouts ...]"

```

**User:** "I wanna have a big bowl of oatmeal (1 cup) with 2 tablespoons of almond butter, some blueberries, and walnuts for breakfast what are the macros for this?"

**System Response:**
```
ReAct iteration 1...
LLM wants to call 1 tool(s)

Calling 'analyze_meal' on MCP server with args: {'meal_description': '1 cup of oatmeal, 2 tablespoons of almond butter, blueberries, and walnuts'}
Processing request of type CallToolRequest
HTTP Request: POST https://api.openai.com/v1/chat/completions "HTTP/1.1 200 OK"
✅ MCP server returned: {
  "items": [
    {
      "food": "oatmeal",
      "quantity": 1.0,
      "unit": "cup",
      "cal...

🤖 ReAct iteration 2...
✅ LLM has final answer (no more tool calls)

Assistant: Here's the macro breakdown for your breakfast of 1 cup of oatmeal with 2 tablespoons of almond butter, blueberries, and walnuts:

### **Nutrition Summary:**
1. **Oatmeal (1 cup)**
   - **Calories**: 154
   - **Protein**: 6.0 g
   - **Carbs**: 27.0 g
   - **Fat**: 3.0 g

2. **Almond Butter (2 tablespoons)**
   - **Calories**: 196
   - **Protein**: 5.0 g
   - **Carbs**: 6.0 g
   - **Fat**: 18.0 g

3. **Blueberries (0.5 cup)**
   - **Calories**: 42
   - **Protein**: 0.5 g
   - **Carbs**: 11.0 g
   - **Fat**: 0.2 g

4. **Walnuts (1 ounce)**
   - **Calories**: 185
   - **Protein**: 4.3 g
   - **Carbs**: 4.0 g
   - **Fat**: 18.5 g

### **Total for the Meal:**
- **Total Calories**: 577
- **Total Protein**: 15.8 g
- **Total Carbs**: 48.0 g
- **Total Fat**: 39.7 g

If you have any more questions or need further assistance, feel free to ask!
```

## Technical Implementation

### **MCP Tools Exposed**

1. **`analyze_meal(meal_description: str)`** - Parses natural language meal descriptions into structured nutrition data
2. **`get_current_date()`** - Returns current date in YYYY-MM-DD format (enables date-aware queries)
3. **`get_whoop_profile()`** - Retrieves user profile information
4. **`get_whoop_recovery(start, end, limit, max_pages)`** - Gets recovery metrics (HRV, RHR, recovery score)
5. **`get_whoop_sleep(start, end, limit, max_pages)`** - Gets sleep data (duration, stages, sleep score)
6. **`get_whoop_workouts(start, end, limit, max_pages)`** - Gets workout data (strain, heart rate zones, calories)

### **Connection Management**

The system uses a single persistent stdio connection to the MCP server:
- Connection established on first tool call
- Maintained for entire chat session
- Properly cleaned up on exit
- Enables state persistence (e.g., Whoop authentication)

### **Date Handling**

Intelligent date conversion for Whoop API:
- Accepts `YYYY-MM-DD` format from LLM
- Converts to ISO format (`2025-11-19T00:00:00.000Z`)
- Handles end dates correctly (sets to `23:59:59.999Z` for full-day queries)
- Supports relative date queries via `get_current_date()` tool

## What This Demonstrates

This project showcases:

- **MCP Integration**: Building production-ready MCP servers with persistent connections
- **AI Tool Orchestration**: Implementing ReAct pattern for multi-step reasoning
- **SDK Integration**: Wrapping third-party SDKs (whoop-sdk) into MCP tools
- **Async Architecture**: Proper event loop management for persistent connections
- **Modular Design**: Clean separation of concerns with testable components
- **Real-World Application**: Combining multiple data sources (nutrition + fitness) in a unified interface

## Project Structure

```
nutribot/
├── mcp_server/          # MCP server implementation
│   └── server.py        # FastMCP server with tool definitions
├── chat_client/         # Client-side orchestration
│   ├── chat_interface.py    # Main ReAct loop
│   ├── mcp_client.py        # Persistent MCP connection
│   ├── tool_router.py       # Routes tool calls
│   ├── openai_client.py     # LLM communication
│   └── conversation.py     # State management
├── nutribot_core/       # Core business logic
│   └── meal_analyzer.py    # Nutrition parsing
└── logs/                # Conversation history
```

## Conversation Flow

1. User sends message
2. `ChatInterface` adds to conversation history
3. ReAct loop begins:
   - LLM reasons about what tools to use
   - LLM calls tools (via MCP)
   - Tool results added to conversation
   - LLM reasons again (can chain multiple tool calls)
   - Returns final answer when no more tools needed
4. Response displayed to user

The system maintains full conversation context, allowing follow-up questions and multi-turn interactions.
