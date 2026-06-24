# API URL Convention

Web REST endpoints are mounted directly under `/api`.

Examples:

- `GET /api/creators`
- `GET /api/creators/:id`
- `GET /api/bounties/:id`
- `POST /api/reviews`
- `POST /api/escrow/:id/release`

Do not add a `/v1` segment to Web client requests unless matching route files
are added under `app/api/v1`. The typed Web API client in `lib/api-client.ts`
uses `API_BASE = "/api"` and intentionally omits the `Accept-Version` header.
