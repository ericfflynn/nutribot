"""MCP server bootstrap and tool registration."""

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

from .tools.journal_tools import register_journal_tools
from .tools.whoop_tools import register_whoop_tools

load_dotenv()

mcp = FastMCP("nutribot")
register_whoop_tools(mcp)
register_journal_tools(mcp)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
