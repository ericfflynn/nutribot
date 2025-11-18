"""OpenAI client wrapper - handles LLM calls."""
from typing import List, Dict, Any, Optional
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()


class OpenAIClient:
    """Wrapper for OpenAI API calls."""
    
    def __init__(self, model: str = "gpt-4o-mini"):
        """
        Initialize OpenAI client.
        
        Args:
            model: OpenAI model to use
        """
        self.client = OpenAI()
        self.model = model
    
    def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: str = "auto"
    ):
        """
        Send chat completion request to OpenAI.
        
        Args:
            messages: Conversation messages
            tools: Available tools (optional)
            tool_choice: Tool choice strategy ("auto", "none", "required", or tool dict)
            
        Returns:
            OpenAI response object
        """
        kwargs = {
            "model": self.model,
            "messages": messages,
        }
        
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice
        
        return self.client.chat.completions.create(**kwargs)
    
    def get_message_from_response(self, response) -> Any:
        """Extract message from OpenAI response."""
        return response.choices[0].message

