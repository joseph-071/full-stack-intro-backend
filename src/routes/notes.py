from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from src.config.database import get_db
from src.models.user import User
from src.schemas.note import NoteCreate, NoteListResponse, NoteRead, NoteUpdate
from src.services import note_service


# Routers define HTTP details and delegate all CRUD work to services.
router = APIRouter(prefix="/notes", tags=["notes"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token", auto_error=False)
OAUTH_PROVIDERS = {"google", "github"}


def parse_demo_oauth_identity(token: str) -> tuple[str | None, int] | None:
    if token.startswith("user:"):
        token_value = token.removeprefix("user:")
        return (None, int(token_value)) if token_value.isdigit() else None

    provider, separator, provider_token = token.partition(":")
    if provider in OAUTH_PROVIDERS and separator and provider_token.startswith("user:"):
        token_value = provider_token.removeprefix("user:")
        return (provider, int(token_value)) if token_value.isdigit() else None

    return None


def ensure_oauth_user(db: Session, provider: str, user_id: int) -> None:
    user = db.query(User).filter(User.user_id == user_id).first()
    if user is not None:
        return

    db.add(
        User(
            user_id=user_id,
            user_name=f"{provider.title()} User {user_id}",
            user_email=f"{provider}-{user_id}@oauth.local",
        )
    )
    db.commit()


def get_current_user_id(
    db: Session = Depends(get_db),
    token: str | None = Depends(oauth2_scheme),
    fallback_user_id: int | None = Query(
        None,
        alias="user_id",
        description="Legacy simulated current user ID",
    ),
) -> int:
    if token:
        identity = parse_demo_oauth_identity(token)
        if identity is not None:
            provider, user_id = identity
            if provider is not None:
                ensure_oauth_user(db, provider=provider, user_id=user_id)
            return user_id

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid OAuth bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if fallback_user_id is not None:
        return fallback_user_id

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing OAuth bearer token",
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post("", response_model=NoteRead, status_code=status.HTTP_201_CREATED)
def create_note(
    payload: NoteCreate,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return note_service.create_note(db=db, user_id=user_id, payload=payload)


@router.get("", response_model=NoteListResponse)
def list_notes(
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    notes = note_service.list_notes(db=db, user_id=user_id)
    return NoteListResponse(items=notes)


@router.get("/{note_id}", response_model=NoteRead)
def get_note(
    note_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return note_service.get_note(db=db, note_id=note_id, user_id=user_id)


@router.patch("/{note_id}", response_model=NoteRead)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return note_service.update_note(
        db=db,
        note_id=note_id,
        user_id=user_id,
        payload=payload,
    )


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    note_service.delete_note(db=db, note_id=note_id, user_id=user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
