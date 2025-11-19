"""MCP client wrapper - handles all MCP server communication with persistent connection."""
import asyncio
from typing import List, Dict, Any, Optional
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class MCPClient:
    """Wrapper for MCP server communication with persistent connection.
    
    This client maintains a single persistent connection to the MCP server
    for the lifetime of the chat session, rather than creating a new
    connection for each tool call. This is more efficient and allows
    server-side state to persist.
    """
    
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
        
        # Persistent connection state
        self._stdio_context: Optional[Any] = None
        self._read: Optional[Any] = None
        self._write: Optional[Any] = None
        self._session: Optional[ClientSession] = None
        self._connected: bool = False
    
    async def connect(self):
        """
        Establish persistent connection to MCP server.
        
        This creates a single stdio connection and session that will
        be reused for all tool calls. The server process will stay
        alive as long as this connection is open.
        """
        if self._connected:
            return
        
        print("🔌 Connecting to MCP server (persistent connection)...")
        
        # Create stdio client context manager but don't use 'async with'
        # We'll manage the lifecycle manually
        self._stdio_context = stdio_client(self._server_params)
        self._read, self._write = await self._stdio_context.__aenter__()
        
        # Create and initialize session
        self._session = ClientSession(self._read, self._write)
        await self._session.__aenter__()
        await self._session.initialize()
        
        self._connected = True
        print("✅ MCP server connected (persistent connection established)")
    
    async def disconnect(self):
        """
        Close persistent connection to MCP server.
        
        This will close the session and stdio connection, which will
        cause the MCP server process to terminate.
        """
        if not self._connected:
            return
        
        print("🔌 Disconnecting from MCP server...")
        
        # Clean up session
        if self._session:
            try:
                await self._session.__aexit__(None, None, None)
            except Exception as e:
                print(f"⚠️  Error closing session: {e}")
            self._session = None
        
        # Clean up stdio connection
        if self._stdio_context:
            try:
                await self._stdio_context.__aexit__(None, None, None)
            except Exception as e:
                print(f"⚠️  Error closing stdio connection: {e}")
            self._stdio_context = None
            self._read = None
            self._write = None
        
        self._connected = False
        print("✅ MCP server disconnected")
    
    async def get_tools(self) -> List[Dict[str, Any]]:
        """
        Get tool definitions from MCP server.
        
        Uses the persistent connection. Will automatically connect
        if not already connected.
        
        Returns:
            List of tools in OpenAI function format
        """
        await self.connect()  # Ensure we're connected
        
        # Get list of tools from MCP server using persistent session
        tools_result = await self._session.list_tools()
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
        
        return functions
    
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """
        Call a tool on the MCP server using persistent connection.
        
        Reuses the existing connection rather than creating a new one.
        This is much faster and allows server state to persist.
        
        Args:
            tool_name: Name of the tool to call
            arguments: Arguments to pass to the tool
            
        Returns:
            Tool response as string
        """
        await self.connect()  # Ensure we're connected
        
        print(f"\n🔧 Calling '{tool_name}' on MCP server with args: {arguments}")
        
        # Call tool using persistent session
        result = await self._session.call_tool(tool_name, arguments=arguments)
        
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
    
    @property
    def is_connected(self) -> bool:
        """Check if client is currently connected to MCP server."""
        return self._connected

