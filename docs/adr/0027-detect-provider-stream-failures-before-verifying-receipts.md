# Detect Provider stream failures before verifying receipts

Gateway Responses inference must treat SSE `response.failed`, `response.incomplete`, and `error` events as generation failures even when the HTTP status is 200. A nested failed/incomplete Response status is also terminal. The browser stops consumption and does not request a completion signature for that failed stream. These attempts use the existing `stream_failed` diagnostic, preserving current lifecycle and incomplete-answer policies.

An authorized synthetic Gemini probe reproduced a stream containing `response.created`, `response.in_progress`, and `response.failed` with `server_error`, without text output. A subsequent signature request returned 404. Cove previously ignored the failed event, requested that unavailable receipt, and reported `response_verification_failed`. Earlier records preserve only the generic failure and are not rewritten based on this reproduction.

Source bytes remain unchanged for cryptographic verification. SSE framing accepts LF/CRLF and consumes a final unterminated frame, while the request and response byte captures retain the exact original entities. Reader locks are released and failed streams are cancelled.

Known upstream error codes are translated to bounded explanations without copying arbitrary error messages, submitted content, headers, or response bodies into diagnostics. Recognized SDK HTTP receipt errors and signature mismatch codes retain safe classifications. The workspace persists these reasons and displays them in place of the generic generation failure message. Stream failures label the response proof as unavailable rather than claiming a cryptographic verification attempt failed.

This extends the Gateway presentation and bounded inference decisions in ADR-0022 and ADR-0023. It does not weaken receipt verification, change the Provider destination, resend historical content, or reinterpret prior saved evidence.
