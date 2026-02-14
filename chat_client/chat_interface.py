"""Chat interface - orchestrates everything."""
import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List, Dict, Any, Optional
from .mcp_client import MCPClient
from .openai_client import OpenAIClient
from .tool_router import ToolRouter
from .conversation import Conversation


class ChatInterface:
    """Main chat interface that orchestrates MCP, OpenAI, and conversation."""
    
    def __init__(
        self,
        system_message: Optional[str] = None,
        model: str = "gpt-4o-mini",
        mcp_server_command: str = "uv",
        mcp_server_args: Optional[List[str]] = None
    ):
        """
        Initialize chat interface.
        
        Args:
            system_message: System message for the assistant
            model: OpenAI model to use
            mcp_server_command: Command to run MCP server
            mcp_server_args: Arguments for MCP server command
        """
        self.mcp_client = MCPClient(mcp_server_command, mcp_server_args)
        self.openai_client = OpenAIClient(model)
        self.tool_router = ToolRouter(self.mcp_client)
        
        # Get current date and time in Eastern timezone
        eastern_tz = ZoneInfo("America/New_York")
        now_eastern = datetime.now(eastern_tz)
        current_date = now_eastern.strftime("%Y-%m-%d")
        current_time = now_eastern.strftime("%H:%M:%S %Z")
        day_of_week = now_eastern.strftime("%A")  # Full day name (Monday, Tuesday, etc.)
        
        # Build system message with date/time context
        base_system_message = system_message or """
            You are a helpful nutrition and training assistant.
            You have tools for journaling, recommendation, feedback capture, and Whoop data.
            Tool-use behavior:
            - When the user asks to save/log what happened today, call the journal save tool.
            - When the user asks for a next workout recommendation, call the recommendation tool.
            - When the user gives feedback about a recommendation (e.g. 'that was helpful', 'bad recommendation', 'not aligned'),
              call submit_recommendation_feedback.
            - Infer helpful=true/false from user sentiment when possible and pass the note text.
            - If recommendation text is available in context, include it in the feedback tool call."""
        
        full_system_message = f"""{base_system_message}
            IMPORTANT: Today is {day_of_week}, {current_date} and the current time is {current_time} (Eastern Time)."""
        self.conversation = Conversation(full_system_message)
        self.tools: Optional[List[Dict[str, Any]]] = None
    
    async def _initialize_tools(self):
        """Initialize tools from MCP server (establishes persistent connection)."""
        if self.tools is None:
            # This will establish the persistent connection and fetch tools
            self.tools = await self.mcp_client.get_tools()
    
    def _display_response(self, message: Any):
        """Display assistant response."""
        if message.content:
            print(f"\nAssistant: {message.content}\n")
        else:
            print(f"\nAssistant: [No content in response]\n")
        print("---\n")
    
    async def _process_user_input(self, user_input: str) -> Any:
        """
        Process user input with ReAct pattern (Reasoning + Acting loop).
        
        This implements the ReAct pattern where the LLM can:
        1. Reason about what it needs
        2. Act by calling tools
        3. Observe tool results
        4. Repeat until it has enough information to answer
        
        Args:
            user_input: User's message
            
        Returns:
            Final assistant message (no more tool calls)
        """
        # Step 1: Add user message to conversation state
        self.conversation.add_user_message(user_input)
        
        # Step 2: Ensure tools are loaded (lazy initialization)
        await self._initialize_tools()
        
        # Step 3: ReAct Loop - continue until LLM has final answer
        max_iterations = 10  # Safety limit to prevent infinite loops
        iteration = 0
        
        while iteration < max_iterations:
            iteration += 1
            print(f"\n🤖 ReAct iteration {iteration}...")
            
            # Step 3a: LLM REASONING - send conversation + tools
            response = self.openai_client.chat(
                messages=self.conversation.get_messages(),  # Full conversation history
                tools=self.tools,                           # ✅ Always include tools
                tool_choice="auto"                          # ✅ Let LLM decide
            )
            
            message = self.openai_client.get_message_from_response(response)
            self.conversation.add_assistant_message(message)
            
            # Step 3b: Check if LLM wants to ACT (call tools)
            if message.tool_calls:
                print(f"🔧 LLM wants to call {len(message.tool_calls)} tool(s)")
                
                # Step 3c: ACT - Execute tool calls
                tool_results = await self.tool_router.handle_tool_calls(
                    message.tool_calls
                )
                
                # Step 3d: OBSERVE - Add tool results to conversation
                self.conversation.add_tool_results(tool_results)
                
                # Step 3e: Continue loop - LLM will reason about tool results
                # and potentially make more tool calls
                continue
            else:
                # Step 4: No more tool calls = final answer
                print("✅ LLM has final answer (no more tool calls)")
                return message
        
        # Safety: if we hit max iterations, return last message
        print(f"⚠️  Reached max iterations ({max_iterations}), returning last response")
        return message
    
    async def _run_async(self):
        """Async version of run() - maintains single event loop for persistent connection."""
        print("\n🥗 NutriBot Chat Interface")
        print("Type 'quit' to exit\n")
        
        try:
            while True:
                # Get user input (blocking is fine for user input)
                # We're in a single event loop, so persistent connection is maintained
                user_input = input("You: ")
                if user_input.lower().strip() == 'quit':
                    break
                
                # Process and display response (reuses same event loop and connection)
                message = await self._process_user_input(user_input)
                self._display_response(message)
        finally:
            # Always disconnect MCP server when chat ends
            # This ensures the server process is properly terminated
            print("\n🔌 Cleaning up MCP connection...")
            await self.mcp_client.disconnect()
        
        # Prompt to save
        save = input("\n💾 Save conversation? (y/n): ").lower().strip()
        if save == 'y':
            filename = self.conversation.save_to_file()
            print(f"✅ Saved to {filename}")
    
    def run(self):
        """Run the chat interface (creates single event loop for entire session)."""
        # Use asyncio.run() once at the top level to maintain persistent connection
        asyncio.run(self._run_async())
