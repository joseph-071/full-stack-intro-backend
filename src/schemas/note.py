from datetime import date
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class EmotionType(str, Enum):
    happy   = "happy"
    sad     = "sad"
    neutral = "neutral"
    excited = "excited"
    angry   = "angry"


# Pydantic schemas define the HTTP request and response shapes.
class NoteCreate(BaseModel):
    title:       str = Field(..., min_length=1, max_length=200)
    content:     str = Field(..., min_length=1)
    is_pinned:   bool = False
    is_archived: bool = False
    emotion:     EmotionType | None = None


class NoteRead(BaseModel):
    note_id:     int = Field(..., gt=0)
    user_id:     int
    title:       str
    content:     str
    note_date:   date
    is_pinned:   bool
    is_archived: bool
    emotion:     EmotionType | None

    model_config = ConfigDict(from_attributes=True)


class NoteUpdate(BaseModel):
    title:       str | None = Field(default=None, min_length=1, max_length=200)
    content:     str | None = Field(default=None, min_length=1)
    is_pinned:   bool | None = None
    is_archived: bool | None = None
    emotion:     EmotionType | None = None


class NoteListResponse(BaseModel):
    items: list[NoteRead]
