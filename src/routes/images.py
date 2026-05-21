import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from .notes import get_current_user_id

router = APIRouter(prefix="/images", tags=["images"])

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "static" / "uploads"
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
}
MAX_BYTES = 5 * 1024 * 1024  # 5 MB


@router.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    user_id: int = Depends(get_current_user_id),
):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 5 MB)")

    suffix = Path(file.filename or "").suffix.lower() or ".bin"
    filename = f"{uuid.uuid4().hex}{suffix}"

    user_dir = UPLOADS_DIR / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    (user_dir / filename).write_bytes(data)

    return {"filename": filename, "url": f"/static/uploads/{user_id}/{filename}"}
