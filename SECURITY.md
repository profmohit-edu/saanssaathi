# Security

SaansSaathi is a static, client-only web app. There is no backend and no database.

## Threat model and mitigations

| Risk | Mitigation |
|---|---|
| XSS from model output, place names or user input | Everything is rendered as text nodes through `src/dom.js`. `innerHTML` is never used with dynamic data, and inline event handlers are refused. |
| Script injection | A strict CSP with `script-src 'self'` and no inline scripts or styles; `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. |
| Data exfiltration | `connect-src` allows only Open-Meteo and the Gemini API. `referrerPolicy: no-referrer` is set on every request. |
| API key leakage | The user brings their own key. It stays in `sessionStorage` by default (opt-in `localStorage`), is sent only in the `x-goog-api-key` header (never a URL), and never appears in the repo. |
| Prompt injection via names or chat | The system instruction tells the model to ignore rule changes. Model output is length-capped, schema-validated (`parsePlan`) and rendered as text only. |
| Tampered local storage | `sanitizeState` whitelists every enum, clamps numbers, strips control characters and caps list sizes. |
| Hanging requests | `AbortController` timeouts (12 s for air data, 30 s for Gemini) and a 10-minute response cache. |

## Reporting

Please open a private security advisory on this repository.
