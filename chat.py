#!/usr/bin/env python3
"""
Chat interface entry point - now using modular architecture.

This is a thin entry point that uses the modular chat_client package.
"""
from chat_client import ChatInterface


def main():
    """Main entry point."""
    interface = ChatInterface()
    interface.run()


if __name__ == "__main__":
    main()

