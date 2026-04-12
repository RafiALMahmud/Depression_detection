from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.schemas.common import PaginationMeta


def paginate(db: Session, query: Select[Any], page: int, page_size: int) -> tuple[list[Any], PaginationMeta]:
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0
    offset = (page - 1) * page_size
    items = list(db.scalars(query.offset(offset).limit(page_size)).all())
    return items, PaginationMeta.create(page=page, page_size=page_size, total=total)

