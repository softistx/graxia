---
"@graxia/core": minor
---

A plugin may declare `csrfExempt(request)` to serve its own `GET` pages (a browser navigation cannot send the CSRF header). Core consults it for `GET` only and only for the CSRF header check; the request must be answered by a plugin's `onRequest`, or it is refused with the 403 `CSRF_HEADER_REQUIRED` as before, so an exempt request never executes an operation. `setup(api)` also receives `api.transports` (`{ sse, ws }`, read-only), the subscription transports the instance has on, so a plugin can pick one without a setting.
