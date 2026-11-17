# Show Provider model catalog details and local brand icons

Model selectors show the model's advertised display name and identifier, input/output USD rates per million tokens, context and output limits, and supported modality, tools, structured-output, and reasoning labels when available. The closed control keeps a compact icon/name/privacy presentation. Search includes identifiers, display names, publishers, and capability labels. Setup connection tests retain the same returned metadata for their model selector.

The existing authenticated Provider catalog is the source; no separate catalog service or pricing request is added. OpenRouter-shaped `prompt`/`completion` rates are converted from per-token units. NearAI's `input`/`output` fallback is already per million and is recognized only for that preset. Missing, invalid, and negative values remain absent; zero is a valid advertised price. Catalog rates are indicative and do not replace the explicit user pricing preferences used by Generation Metrics. Limits and descriptions are bounded. Capability labels describe Provider support, while Cove continues sending text and extracted document text through its current transports.

Selected brand SVGs from LobeHub Icons 1.103.0 are bundled locally with their MIT notice. A model family or publisher selects an icon; an unknown identity uses the existing generic CPU glyph. Logos are presentation only, never transport or verification evidence. No remote image request or full icon-library runtime dependency is introduced.

This extends the catalog authority in ADR-0004 and presentation boundaries in ADR-0019/0020 without changing model availability, privacy classification, or generation routing.
