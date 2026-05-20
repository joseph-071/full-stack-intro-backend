""" from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from src.config.database import Base

class Note(Base):
    __tablename__ = "notes"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
 """

from sqlalchemy import BigInteger, Boolean, Column, Date, ForeignKey, String, Text, text
from src.config.database import Base


# SQLAlchemy models map Python classes to the existing database tables.
class Note(Base):
    __tablename__ = "notes"

    note_id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(
        BigInteger,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    note_date   = Column(Date, nullable=False, server_default=text("CURRENT_DATE"))
    is_pinned   = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    is_archived = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    emotion     = Column(String(50), nullable=True)