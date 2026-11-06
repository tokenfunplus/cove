# Use local deterministic Conversation Titles

Secure Chat derives a new Conversation Title from the first user message (truncated to a fixed display length) and lets the user rename it locally. It does not make a separate model request to summarize or title a conversation, avoiding extra Provider traffic, latency, and disclosure of content beyond the requested Generation.
