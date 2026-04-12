from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.base import Base
from app.db.session import engine
from app.services.seed import seed_initial_data


def initialize_database(db: Session) -> None:
    Base.metadata.create_all(bind=engine)
    if settings.auto_seed:
        seed_initial_data(db)

