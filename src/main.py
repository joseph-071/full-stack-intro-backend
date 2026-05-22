from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from src.config.database import Base, engine, SessionLocal
from src.models.note import Note
from src.models.user import User
from src.routes import images as images_routes
from src.routes import notes

STATIC_DIR = Path(__file__).resolve().parent / "static"
OBSIDIAN_PATH = Path("/app/obsidian")
OBSIDIAN_DIRS = ["papers", "daily-reviews", "sessions"]

# Create the FastAPI application
app = FastAPI(
    title="Digital Note API",
    description="Personal Cloud Notebook API",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins (development only)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def initialize_database() -> None:
    Base.metadata.create_all(bind=engine)


def sync_obsidian_notes() -> None:
    if not OBSIDIAN_PATH.exists():
        return

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.user_id == 1).first()
        if user is None:
            db.add(User(user_id=1, user_name="Google User 1", user_email="google-1@oauth.local"))
            db.commit()

        count = 0
        for dirname in OBSIDIAN_DIRS:
            subdir = OBSIDIAN_PATH / dirname
            if not subdir.exists():
                continue
            for md_file in sorted(subdir.glob("*.md")):
                lines = md_file.read_text(encoding="utf-8").splitlines()
                if not lines:
                    continue
                title = lines[0].lstrip("# ").strip()
                if not title:
                    continue
                content = "\n".join(lines[2:]).strip() if len(lines) > 2 else ""

                exists = db.query(Note).filter(
                    Note.user_id == 1, Note.title == title
                ).first()
                if exists:
                    continue

                db.add(Note(user_id=1, title=title, content=content))
                count += 1

        db.commit()
        print(f"[obsidian-sync] Imported {count} new note(s) from Obsidian vault.")
    finally:
        db.close()


@app.on_event("startup")
def on_startup() -> None:
    initialize_database()
    sync_obsidian_notes()


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def read_root():
    return FileResponse(STATIC_DIR / "index.html")

# Health check endpoint
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "message": "Notes API is running"
    }

# Include routers. Each router owns its own prefix and tags.
app.include_router(notes.router)
app.include_router(images_routes.router)

# Startup instruction
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)