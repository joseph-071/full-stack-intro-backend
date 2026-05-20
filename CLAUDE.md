# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a FastAPI backend for a "Digital Note" / Personal Cloud Notebook application. It exposes a REST API for CRUD operations on notes, backed by PostgreSQL, and is fully containerised with Docker Compose.

## Running the Stack

The recommended way to run everything is via Docker Compose from `full-stack-intro-backend/`:

```bash
cd full-stack-intro-backend
docker compose up --build        # start all services (backend + postgres + pgadmin)
docker compose up --build -d     # same, detached
docker compose down              # stop and remove containers
docker compose logs -f backend   # tail backend logs
```

Services exposed:
- `http://localhost:8000` — FastAPI app (auto-reload enabled)
- `http://localhost:8000/docs` — Swagger UI
- `http://localhost:8000/` — Frontend (index.html)
- `http://localhost:5050` — pgAdmin (admin@example.com / password123)
- `localhost:5432` — PostgreSQL


## Architecture

```
src/
  main.py               # FastAPI app, CORS, static files mount, startup DB init, router registration
  config/
    database.py         # SQLAlchemy engine, SessionLocal, Base, get_db() dependency
  models/
    user.py             # User ORM model  (users table)
    note.py             # Note ORM model  (notes table, FK → users)
  schemas/
    note.py             # Pydantic schemas: NoteCreate, NoteRead, NoteUpdate, NoteListResponse
  routes/
    notes.py            # HTTP layer — OAuth dependency, thin handlers, delegates to services
  services/
    note_service.py     # Business logic and DB queries; raises HTTPException on 404/400
  static/
    index.html          # Single-page frontend, served at GET /
    app.js              # Fetch-based CRUD client; stores OAuth token in localStorage
    styles.css          # App layout and component styles
```

### Key design conventions

- **Routers are thin**: route handlers only parse HTTP inputs and call service functions.
- **Services own logic**: all DB queries and business rules live in `note_service.py`.
- **Authentication**: all note endpoints use `get_current_user_id` (in `routes/notes.py`) as a FastAPI dependency. Requests are authenticated via `Authorization: Bearer <token>`; the legacy `?user_id=<int>` query param is accepted as a fallback. Missing both returns `401`. Demo OAuth token formats: `user:<id>` (direct) or `<provider>:user:<id>` (Google / GitHub). A provider-scoped token auto-creates the user in the DB via `ensure_oauth_user` if they don't exist yet.
- **SQLAlchemy sessions** are injected via `Depends(get_db)` and closed automatically.
- **Pydantic v2** is in use (`model_config = ConfigDict(from_attributes=True)`, `model_dump(exclude_unset=True)`).

### Database schema

| Table   | Key columns |
|---------|-------------|
| `users` | `user_id` (PK), `user_name`, `user_email` (unique) |
| `notes` | `note_id` (PK), `user_id` (FK → users, CASCADE), `title`, `content`, `note_date`, `is_pinned`, `is_archived`, `emotion` |

Tables are **auto-created** on application startup via `Base.metadata.create_all` called in the `on_startup` event handler in `main.py`.

## API Endpoints

All note endpoints require authentication — either `Authorization: Bearer <token>` header or `?user_id=<int>` (legacy). Returns `401` if neither is provided, `404` if the user doesn't exist.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve frontend index.html |
| GET | `/health` | Status check |
| POST | `/notes` | Create note |
| GET | `/notes` | List user's notes; supports `?q=<keyword>` search and `?include_archived=true` |
| GET | `/notes/{note_id}` | Get single note |
| PATCH | `/notes/{note_id}` | Partial update (only provided fields) |
| DELETE | `/notes/{note_id}` | Delete note (204) |

## Planned Features

Features under consideration — not yet implemented. Design rationale in `docs/FEATURE_DESIGN.md`.

### Backend

| # | Feature | Description | Difficulty |
|---|---------|-------------|------------|
| 1 | **Pagination** | `GET /notes?page=1&page_size=20` — currently returns all notes at once | Low |
| 2 | **User CRUD API** | `/users` endpoints (create, read, update) — users are currently only auto-created via OAuth | Medium |
| 3 | **Note tags** | Many-to-many tags table; `GET /notes?tag=work` | Medium |
| 4 | **Alembic migrations** | Replace `metadata.create_all` with versioned schema migrations | Medium |
| 5 | **JWT auth** | Replace demo token strings with real JWT (`python-jose`) | High |

### Frontend

| # | Feature | Description |
|---|---------|-------------|
| 6 | **Markdown preview** | Render note content as Markdown (e.g. `marked.js`) |
| 7 | **Search bar** | Client-side real-time filter of the note list |
| 8 | **Keyboard shortcuts** | `Ctrl+S` to save, `Ctrl+N` for new note |
