# Code Review Standards

**Risk levels:**

- `critical`: immediate exploitation risk, hardcoded secrets, authentication bypass
- `high`: SQL injection, command injection, significant data exposure
- `medium`: missing input validation, unsafe deserialization, N+1 query patterns
- `low`: code style issues, minor inefficiencies, informational findings

**Finding format:**
Each entry in `findings` must name the affected function or line range first, then
state the issue in one sentence. Example: "`processPayment`: uses string interpolation
in SQL query — susceptible to SQL injection via `orderId`."

**Confidence:**
Set `confidence` between 0.0 (speculative) and 1.0 (certain). Use 0.9+ only when the
issue is unambiguous from code inspection alone, with no missing context.
