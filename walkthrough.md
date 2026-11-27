# Security Summary

**Reviewed Files**: 42
**Issues Resolved**: 4

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Unsanitized HTML | `desktop/parser_2gis/web/static/index.html` | 2605 | Plan titles, badges, descriptions, and IDs were inserted into the license plan grid without HTML escaping. | High | Fixed | Escaped all plan fields (`id`, `title`, `badge`, `description`, `price`, `days`) with `esc(...)` before rendering markup. |
| Missing Access Check | `server/appRoutes.ts` | 721 | `POST /api/app/demo` checked subscription status and features but skipped mandatory Telegram channel subscription verification. | Medium | Fixed | Added `checkChannelSubs(user.tgId)` enforcement returning `403 channels_required` when required channels are not joined, and stripped `system_fingerprint` from proxied AI replies. |
| Unsafe Object Key Lookup | `server/routes.ts` | 307 | `POST /api/search/maps/trial/start` read `req.body?.labels?.[url]` directly, allowing inherited prototype properties to be read if supplied. | Medium | Fixed | Validated `labels` is a plain object and guarded key reads with `Object.hasOwn(labelsMap, url)`. |
| Unvalidated Link Scheme | `server/routes.ts` | 372 | `POST /api/search/maps/trial/status` accepted arbitrary link strings returned by the worker without scheme validation. | Medium | Fixed | Restricted `url` values to `http://` or `https://` links and set non-matching values to `null`. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| API Keys & Model Masking | `server/appRoutes.ts`, `desktop/parser_2gis/web/ai_agent.py` | Provider keys (`OPENROUTER_API_KEY`, `COHERE_API_KEY`) stay strictly on the backend; clients see only the `fracs-ai` alias and never receive internal provider metadata. |
| Session & Admin Access Control | `server/auth.ts`, `server/webapp.ts`, `server/adminRoutes.ts` | Browser sessions use `HttpOnly` HMAC-SHA256 cookies (`SameSite=None; Secure`), one-time Telegram login tokens expire on first claim, and admin routes verify signed Telegram Mini App data against `ADMIN_TG_ID`. |
| Origin & Request Rate Checks | `server/security.ts`, `server/db.ts` | State-changing routes enforce same-origin checks (`csrfGuard`) and sliding-window rate limits with fail-closed behavior on sensitive endpoints. |
| Payment Webhooks & Grants | `server/payments.ts`, `server/bot.ts` | CryptoBot and xRocket webhooks verify HMAC/secret signatures and re-confirm invoice `paid` status directly with the provider API before activating plans or token packs. |
| Sandbox Isolation | `server/appRoutes.ts`, `desktop/parser_2gis/web/ai_agent.py` | Hosted demo review pages (`/v/:id`) and local desktop preview pages serve generated HTML inside sandboxed frames with restricted capabilities. |

---

## PoC Verification

### Unsanitized HTML in Desktop License Plan Grid

#### Summary
| Field | Value |
|---|---|
| Issue Type | Unsanitized HTML Rendering |
| Impact | High |
| Affected File | `desktop/parser_2gis/web/static/index.html:2595-2612` |
| Test Scenario | Plan payload containing `title: "<img src=x onerror=alert(1)>"` rendered in `renderPlans(plans, current)` |

#### How It Was Fixed
Added a local `esc` helper inside the license overlay script and wrapped every dynamic attribute and text field (`p.id`, `p.title`, `p.badge`, `p.description`, `price`, `days`) before writing into `grid.innerHTML`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `loadPlans()` fetches `/api/plans` and calls `renderPlans(d.plans, lic)`. | Payload enters renderer |
| 2 | At `desktop/parser_2gis/web/static/index.html:2605-2608`, `esc(...)` encodes `<`, `>`, `"`, `'`, and `&` into HTML entities. | Markup characters neutralized |
| 3 | `grid.innerHTML` receives escaped strings only. | **Handled Safely** |

#### Conclusion
**Fix Verified** - Any HTML or script characters in plan metadata render strictly as plain text and cannot execute in the desktop view.

---

### Missing Channel Subscription Check on Demo Publishing

#### Summary
| Field | Value |
|---|---|
| Issue Type | Missing Access Check |
| Impact | Medium |
| Affected File | `server/appRoutes.ts:714-725` |
| Test Scenario | `POST /api/app/demo` called with a valid Ultra license key while `checkChannelSubs(user.tgId)` returns `false` |

#### How It Was Fixed
Added `await checkChannelSubs(user.tgId)` immediately after the subscription expiry check in `POST /api/app/demo`, matching all other licensed `/api/app/*` endpoints.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `POST /api/app/demo` receives a bearer license key and resolves the Ultra user (`server/appRoutes.ts:718-721`). | Request enters handler |
| 2 | Line `721` executes `if (!(await checkChannelSubs(user.tgId)))` and receives `false`. | Access denied early |
| 3 | Server responds with HTTP `403` (`{ ok: false, error: 'channels_required' }`) without storing demo HTML. | **Handled Safely** |

#### Conclusion
**Fix Verified** - Users who leave required Telegram channels can no longer publish public demo pages until they re-subscribe.

---

### Unsafe Prototype Key Lookup in Trial Maps Start

#### Summary
| Field | Value |
|---|---|
| Issue Type | Unsafe Object Key Lookup |
| Impact | Medium |
| Affected File | `server/routes.ts:297-310` |
| Test Scenario | `POST /api/search/maps/trial/start` with `labels: { "toString": "polluted", "https://2gis.ru/moscow/search/...": "Москва" }` |

#### How It Was Fixed
Validated that `req.body?.labels` is a non-array plain object and replaced direct bracket lookup with `Object.hasOwn(labelsMap, url)`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Trial search payload arrives at `POST /api/search/maps/trial/start`. | Payload enters handler |
| 2 | At `server/routes.ts:297-309`, `labelsMap` only resolves keys where `Object.hasOwn(labelsMap, url)` is true. | Inherited keys ignored |
| 3 | Forwarded worker payload receives only explicitly supplied own label values or `""`. | **Handled Safely** |

#### Conclusion
**Fix Verified** - Dynamic key indexing on `labels` can never read inherited prototype properties.

---

### Unvalidated Link Scheme in Trial Maps Status

#### Summary
| Field | Value |
|---|---|
| Issue Type | Unvalidated External Link Scheme |
| Impact | Medium |
| Affected File | `server/routes.ts:365-374` |
| Test Scenario | Worker status response containing `record.url = "javascript:alert(1)"` alongside `"https://2gis.ru/moscow/firm/123"` |

#### How It Was Fixed
Trimmed incoming `record.url` values and accepted only links matching `/^https?:\/\//i`, normalizing all other strings to `null`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `POST /api/search/maps/trial/status` maps worker records into `MapsRow` items. | Worker row parsed |
| 2 | At `server/routes.ts:365-372`, `/^https?:\/\//i.test(rawUrl)` rejects `"javascript:alert(1)"` and accepts `"https://2gis.ru/moscow/firm/123"`. | Unsafe scheme blocked |
| 3 | Response `trialRows[0].url` is `null` while `trialRows[1].url` remains `"https://2gis.ru/moscow/firm/123"`. | **Handled Safely** |

#### Conclusion
**Fix Verified** - Non-HTTP(S) links cannot be saved in search history or passed to client result cards.
