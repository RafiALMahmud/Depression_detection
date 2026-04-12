"""Development seed runner.

NOTE: Seeded default passwords are for demo/development only and must be changed in production.
"""

from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.services.seed import seed_initial_data


def run() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_initial_data(db)


if __name__ == "__main__":
    run()

