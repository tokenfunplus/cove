# Use Tailwind recipes and shadcn primitives

Cove uses MedBox's Tailwind 4 and editable shadcn/Radix component pattern for the Chat Surface. Shared controls live in `components/ui`; Button and Select follow the local MedBox implementations. Input, Textarea, Badge, and controlled Dialog primitives use the same semantic tokens and `cn` utility. `components.json` records the shadcn configuration.

## Presentation ownership

- Tailwind utilities express layout, spacing, typography, states, and responsive behavior. Related slot recipes live in `src/styles/*.ts` so domain components remain readable. `String.raw` preserves escaped selector markers in the few recipes that style nested legacy markup.
- Component styles use semantic tokens such as `bg-card`, `text-foreground`, `border-border`, and `bg-primary`. Palette values, the base radius, elevation, and motion timing live in `theme/tokens.css`. Light and dark themes share the same component recipes.
- CSS is reserved for theme tokens, Tailwind theme registration, base typography/accessibility rules, and shared keyframes/reduced-motion handling. New component-specific CSS selectors are avoided.
- Existing Headless UI menus and searchable Combobox behavior remain behind their current adapters. Their fields and triggers use shared controls. Standard Select and all modal mechanics use Radix. This keeps keyboard/search behavior within the visual refactor's scope. The Dialog adapter accommodates the retained Combobox portal without treating a model choice as an outside dismissal.
- Dialogs preserve controlled open state, accessible titles, Escape handling, focus containment, and focus restoration. Settings tabs retain their existing mounted forms and support arrow/Home/End navigation.

## Skin extension

A new palette can override semantic variables under a skin selector while continuing to supply light and dark values. Components do not need palette-specific branches. Change `--radius` to scale rounded surfaces and controls, and the elevation variables to tune shadows. Add new semantic roles to the token file and Tailwind theme registration before using them in components; avoid literal palette colors in recipes.

Motion is limited to surface entrances, hover/press feedback, sidebar changes, and status indicators. Streaming answer text remains stable. Reduced motion disables repeated and entrance animation and removes smooth scrolling.

## Consequences

This replaces the legacy global component stylesheet referenced in ADR-0019. API hooks, persistence formats, inference protocols, and generation ownership remain governed by their existing decisions. Visual acceptance and the final capability regression gate are separate from this architectural decision.
