"""MCP client wrapper - handles all MCP server communication."""
import asyncio
from typing import List, Dict, Any
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class MCPClient:
    """Wrapper for MCP server communication."""
    
    def __init__(self, server_command: str = "uv", server_args: List[str] = None):
        """
        Initialize MCP client.
        
        Args:
            server_command: Command to run the server (e.g., "uv", "python")
            server_args: Arguments to pass to server command
        """
        self.server_command = server_command
        self.server_args = server_args or ["run", "python", "-m", "mcp_server.server"]
        self._server_params = StdioServerParameters(
            command=self.server_command,
            args=self.server_args,
            env=None
        )
    
    async def get_tools(self) -> List[Dict[str, Any]]:
        """
        Connect to MCP server and get tool definitions.
        
        Returns:
            List of tools in OpenAI function format
        """
        print("🔌 Connecting to MCP server...")
        
        async with stdio_client(self._server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                
                # Get list of tools from MCP server
                tools_result = await session.list_tools()
                print(f"✅ Found {len(tools_result.tools)} tool(s) from MCP server")
                
                # Convert MCP Tool format to OpenAI function format
                functions = []
                for tool in tools_result.tools:
                    functions.append({
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description or "",
                            "parameters": tool.inputSchema
                        }
                    })
                    print(f"   - {tool.name}: {tool.description}")
                
                return functions
    
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """
        Call a tool on the MCP server.
        
        Args:
            tool_name: Name of the tool to call
            arguments: Arguments to pass to the tool
            
        Returns:
            Tool response as string
        """
        print(f"\n🔧 Routing '{tool_name}' to MCP server with args: {arguments}")
        
        async with stdio_client(self._server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                
                # Actually call the tool on MCP server
                result = await session.call_tool(tool_name, arguments=arguments)
                
                # Extract text response
                text_parts = []
                for content in result.content:
                    if hasattr(content, 'text'):
                        text_parts.append(content.text)
                    else:
                        text_parts.append(str(content))
                
                response = "\n".join(text_parts)
                print(f"✅ MCP server returned: {response[:100]}...")
                return response

