"""Manages conversation state."""
from typing import List, Dict, Any, Optional


class Conversation:
    """Manages conversation state and messages."""
    
    def __init__(self, system_message: Optional[str] = None):
        """
        Initialize conversation.
        
        Args:
            system_message: System message to start conversation with
        """
        self.messages: List[Dict[str, Any]] = []
        
        if system_message:
            self.add_system_message(system_message)
    
    def add_system_message(self, content: str):
        """Add system message to conversation."""
        self.messages.append({
            "role": "system",
            "content": content
        })
    
    def add_user_message(self, content: str):
        """Add user message to conversation."""
        self.messages.append({
            "role": "user",
            "content": content
        })
    
    def add_assistant_message(self, message: Any):
        """
        Add assistant message to conversation.
        
        Args:
            message: OpenAI message object (can have content, tool_calls, etc.)
        """
        # Convert OpenAI message object to dict format
        message_dict = {
            "role": "assistant",
        }
        
        if hasattr(message, 'content') and message.content:
            message_dict["content"] = message.content
        
        if hasattr(message, 'tool_calls') and message.tool_calls:
            message_dict["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": tc.type,
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments
                    }
                }
                for tc in message.tool_calls
            ]
        
        self.messages.append(message_dict)
    
    def add_tool_results(self, tool_results: list):
        """
        Add multiple tool results to conversation.
        
        Args:
            tool_results: List of tool result dicts
        """
        self.messages.extend(tool_results)
    
    def add_tool_result(
        self,
        tool_call_id: str,
        name: str,
        content: str
    ):
        """Add tool result to conversation."""
        self.messages.append({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "name": name,
            "content": content
        })
    
    def get_messages(self) -> List[Dict[str, Any]]:
        """Get all conversation messages."""
        return self.messages.copy()
    
    def clear(self):
        """Clear conversation (keeps system message if present)."""
        system_msg = None
        if self.messages and self.messages[0].get("role") == "system":
            system_msg = self.messages[0]["content"]
        
        self.messages = []
        if system_msg:
            self.add_system_message(system_msg)
    
    def save_to_file(self, filename: str = None):
        """Save conversation to JSON file.
        
        Args:
            filename: Optional filename. If None, generates timestamped filename.
            
        Returns:
            The filename used.
        """
        import json
        from datetime import datetime
        from pathlib import Path
        
        # Create logs directory if it doesn't exist
        log_dir = Path("logs")
        log_dir.mkdir(exist_ok=True)
        
        if filename is None:
            filename = f"conversation_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        # Ensure filename is in logs directory
        if not filename.startswith("logs/"):
            filepath = log_dir / filename
        else:
            filepath = Path(filename)
        
        with open(filepath, 'w') as f:
            json.dump(self.messages, f, indent=2)
        
        return str(filepath)

