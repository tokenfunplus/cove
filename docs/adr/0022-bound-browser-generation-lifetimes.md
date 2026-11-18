# Bound browser Generation lifetimes and isolate slow event subscribers

Chat owns a deadline for every browser-driven NearAI Generation, including retries. The default deadline is two minutes plus thirty seconds of grace, allowing the browser's existing two-minute inference timeout to settle its result and verification evidence first. Phase commands do not renew this deadline. If the browser disappears without settlement, Chat records a failed Generation with the `timeout` diagnostic, preserves no partial assistant content, and releases the active Batch slot.

Settlement, cancellation, deadline expiry, and subsequent Generation creation are serialized so that a terminal result is published once before a retry can reactivate the Batch. A late browser settlement cannot replace an existing terminal result. Completed and explicitly stopped Generations release their timers, and clearing chat data cancels browser Generations as well as ordinary Provider workers. A transient storage failure retries expiry rather than abandoning the deadline.

Deadline expiry carries failed verification lanes. Without a browser receipt, the Local Service does not infer successful verification from a reported phase or a timeout diagnostic.

Both Generation and Batch event hubs disconnect subscribers whose bounded event buffers fill. Provider workers never wait for a browser while holding the hub mutex. The browser continues using the existing `Last-Event-ID` reconnection and persisted-state reconciliation. Replay remains bounded to the latest 256 events and 256 KiB of combined answer/reasoning text; completed content in SQLite is authoritative, as established in [ADR-0011](0011-separate-generation-command-and-event-stream.md).

This extends the lifecycle ownership in [ADR-0012](0012-make-chat-the-local-service-application-facade.md) and the single-active-Batch rule in [ADR-0014](0014-model-submissions-as-generation-batches.md). It does not change Provider context, comparison selection, cryptographic verification, or the API shape.
