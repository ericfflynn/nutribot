"""Chat interface - orchestrates everything."""
import asyncio
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
        self.conversation = Conversation(
            system_message or "You are a helpful nutrition assistant. Use the calculate_macros tool when users ask about nutrition."
        )
        self.tools: Optional[List[Dict[str, Any]]] = None
    
    async def _initialize_tools(self):
        """Initialize tools from MCP server."""
        if self.tools is None:
            print("\n📋 Fetching tools from MCP server...")
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
        Process user input and return assistant response.
        
        Args:
            user_input: User's message
            
        Returns:
            Final assistant message
        """
        # Add user message
        self.conversation.add_user_message(user_input)
        
        # Ensure tools are loaded
        await self._initialize_tools()
        
        # Send to OpenAI with tool definitions
        print("\n🤖 Sending to OpenAI (with tool definitions)...")
        response = self.openai_client.chat(
            messages=self.conversation.get_messages(),
            tools=self.tools,
            tool_choice="auto"
        )
        
        message = self.openai_client.get_message_from_response(response)
        self.conversation.add_assistant_message(message)
        
        # Check if OpenAI wants to use a tool
        if message.tool_calls:
            # Route tool calls to MCP server
            tool_results = await self.tool_router.handle_tool_calls(
                message.tool_calls
            )
            
            # Add tool results to conversation
            self.conversation.add_tool_results(tool_results)
            
            # Get final response from OpenAI
            print("\n🤖 Sending tool results back to OpenAI for final answer...")
            response = self.openai_client.chat(
                messages=self.conversation.get_messages()
            )
            message = self.openai_client.get_message_from_response(response)
            self.conversation.add_assistant_message(message)
        
        return message
    
    def run(self):
        """Run the chat interface."""
        print("\n🥗 NutriBot Chat Interface")
        print("Type 'quit' to exit\n")
        
        while True:
            # Get user input
            user_input = input("You: ")
            if user_input.lower().strip() == 'quit':
                break
            
            # Process and display response
            message = asyncio.run(self._process_user_input(user_input))
            self._display_response(message)
        
        # Prompt to save
        save = input("\n💾 Save conversation? (y/n): ").lower().strip()
        if save == 'y':
            filename = self.conversation.save_to_file()
            print(f"✅ Saved to {filename}")

