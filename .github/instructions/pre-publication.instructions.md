---
applyTo: "**"
---

# Pre-Publication Checklist

Follow this checklist in order before merging any work into `main` or publishing a release.

## 1. Remove Dead Code

- Delete commented-out code blocks (not explanatory comments — actual dead code)
- Remove unused variables, imports, and functions
- Remove TODO/FIXME/HACK comments that reference incomplete work — either finish the work or delete the comment and its stub
- Remove development logging (debug prints, console.log, etc.) unless it is intentional production logging
- Remove broken or irrelevant test files

## 2. Naming Consistency

- File names follow a single consistent convention throughout the project (pick one: camelCase, kebab-case, snake_case)
- Types and classes are PascalCase
- Functions and variables are camelCase or snake_case — consistently, not mixed
- Constants are UPPER_SNAKE_CASE
- No single-letter variable names outside of loop indices and obvious lambda shorthand
- Equivalent concepts use the same name everywhere — no `opts` vs `options`, `handler` vs `callback` for the same pattern

## 3. Comments and Documentation

- Every exported function, class, or module has at least a one-sentence description
- Parameters and return values are documented for all public functions
- Comments explain **why**, not **what** — remove comments that just restate the code
- Non-obvious decisions, edge cases, and performance choices are explained inline
- Each file has a brief top-level comment stating what it contains

## 4. Code Consistency

- Consistent quote style (single or double — pick one)
- Consistent semicolons (all or none)
- Consistent indentation and spacing
- Consistent brace and bracket style
- Same patterns used for the same operations — no mixing paradigms without a documented reason
- Error handling follows a uniform pattern across all similar components

## 5. Public API Review

- Every publicly exported symbol is intentionally public — internals are clearly marked or unexported
- Similar operations have consistent signatures (options object vs positional args — pick one pattern)
- All documented configuration options are implemented and functional
- Default values are sensible and documented

## 6. Tests

- All tests pass (unit, integration, e2e — whatever applies to this project)
- Every public function or module has at least one test
- No skipped, pending, or commented-out tests — either implement them or delete them
- Edge cases flagged in comments are covered

## 7. README

- README accurately reflects the current state of the code
- Includes: what the project is, how to install/run it, a minimal working example, configuration reference, and how to run tests
- No references to features that don't exist or were removed

## 8. Repository Hygiene

- `.gitignore` covers all build artifacts, dependency directories, IDE files, OS files, local config, and secrets
- `package.json` / project manifest has accurate name, version, description, and entry points (if applicable)
- No files that shouldn't be public: credentials, local config, database files, logs, build output
- No hardcoded secrets, API keys, tokens, or environment-specific paths in source code
- License file is present if this is an open-source release

## 9. Final Verification

1. Run the full test suite — all tests must pass
2. Build the project cleanly from scratch — no warnings treated as errors left unresolved
3. Read through every changed file as if seeing it for the first time — does each file make sense on its own?
4. Confirm nothing private, internal, or unfinished is exposed in the public surface

## Rules

- Do **not** refactor architecture during a publication pass. Structure is intentional. This is a cleanup pass.
- Do **not** add new features. If you find something worth improving, note it but do not implement it.
- Do **not** change public API signatures without explicit instruction.
- If you find a genuine bug, fix it and document what you fixed and why.
