# Parser `exported` semantics

Every chunk emitted by a language parser carries an `exported: boolean` field. Downstream tools (dashboard filters, "find exports" queries, relation builders) assume consistent meaning across languages. This document defines what `exported = true` means per language.

## Rule

**`exported = true`** means *"reachable by name from outside the declaring scope"*. It approximates "is this part of the module's public API?".

When the language has explicit visibility keywords (`public`, `pub`, `export`), those rule. When the language uses a naming convention instead, the convention rules. The goal is a consistent mental model: "can someone else see this?"

## Per-language rules

| Language | Rule | Source |
|---|---|---|
| **C#** | `public` or `internal` modifier on member | `IsExported()` in CSharpParser/Program.cs |
| **VB.NET** | `Public` modifier on member | `IsExported()` in VbNetParser/Program.cs |
| **Java** | `public` modifier on member | `hasPublicModifier()` in java-treesitter.mjs |
| **Rust** | `pub` visibility modifier on declaration | `isRustPublic()` in rust-treesitter.mjs |
| **Go** | Name starts with uppercase letter | `isExported()` in go-treesitter.mjs |
| **Python** | Name does not start with underscore | `isExported()` in python-treesitter.mjs |
| **Ruby** | Name does not start with underscore (*) | inline check in ruby-treesitter.mjs |
| **Bash** | Function name does not start with underscore | inline check in bash-treesitter.mjs |
| **C / C++** | At namespace scope, or nested inside `public:` block | `isCppVisible()` in cpp-treesitter.mjs |
| **JavaScript / TypeScript** | Has `export` keyword or is in `module.exports` / `exports.foo` | `chunks.mjs` in javascript/ |
| **VB6** | `Public` keyword (explicit or implied by `Attribute`) | regex-based in vb6.mjs |
| **SQL** | Always `true` (all schema objects are externally referenceable) | sql.mjs |
| **Config / Resources** | Always `true` (config entries are by definition public surface) | config.mjs, resources.mjs |

(*) Ruby's `private`/`protected` keywords could override this but require scope tracking we don't yet implement. The underscore convention is an acceptable approximation that matches Python; track [future work](#future-work) below.

## What this means downstream

- **Dashboard "public API" counts** rely on this field being consistent.
- **Graph "EXPORTS" edges** are emitted only when `exported === true`.
- **Search filters** like "public methods only" use the same field.
- A parser that hard-codes `exported: true` (as C++ did before) produces misleading data.

## Testing

Per the parser-parity project rule, every parser must have at least one test asserting `exported = true` for a visibly-public declaration and `exported = false` for a non-public one. See `tests/<lang>-treesitter-parser.test.mjs` and `tests/<lang>-parser.test.mjs`.

## Future work

- **Ruby**: track `private`/`protected` keywords via scope traversal for full fidelity.
- **C++**: protected members are currently treated the same as private (both `exported: false`). If callers need to distinguish, extend the field to a tri-state.
- **TypeScript declaration merging**: ambient declarations (`declare module`) are not currently annotated; they're functionally public but the parser doesn't mark them.
