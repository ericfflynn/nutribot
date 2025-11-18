"""Routes tool calls between OpenAI and MCP."""
import json
import asyncio
from typing import List, Dict, Any
from .mcp_client import MCPClient


class ToolRouter:
    """Routes tool calls from OpenAI to MCP server."""
    
    def __init__(self, mcp_client: MCPClient):
        """
        Initialize tool router.
        
        Args:
            mcp_client: MCP client instance for calling tools
        """
        self.mcp_client = mcp_client
    
    async def handle_tool_calls(
        self,
        tool_calls: List[Any]
    ) -> List[Dict[str, Any]]:
        """
        Handle tool calls from OpenAI by routing to MCP server.
        
        Args:
            tool_calls: List of tool call objects from OpenAI
            
        Returns:
            List of tool result messages to add to conversation
        """
        print(f"\n🛠️  OpenAI wants to call {len(tool_calls)} tool(s)")
        
        tool_results = []
        
        for tool_call in tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)
            
            # Route to MCP server (the actual implementation)
            function_response = await self.mcp_client.call_tool(
                function_name,
                function_args
            )
            
            # Format as tool result message
            tool_results.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "name": function_name,
                "content": function_response
            })
        
        return tool_results

