# Stop active Generations before clearing chat history

When the user clears all chat data while a Generation is streaming, Secure Chat first cancels every affected upstream request and waits for each to reach a single `stopped` terminal state. Only then, after confirmation, does it delete Conversation History; this prevents an orphaned Provider request from continuing after the local record is gone. Deleting an individual Conversation follows the same cancel-and-wait protocol; if cancellation does not settle, deletion is refused and the Conversation remains intact.
