from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.company import Company
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.company import CompanyCreate, CompanyListResponse, CompanyOption, CompanyRead, CompanyUpdate
from app.services.audit import log_audit
from app.services.pagination import paginate

router = APIRouter(prefix="/companies", tags=["Companies"])


def _get_company_or_404(db: Session, company_id: int) -> Company:
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return company


@router.get("", response_model=CompanyListResponse)
def list_companies(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> CompanyListResponse:
    query = select(Company)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(or_(Company.name.ilike(pattern), Company.code.ilike(pattern)))
    query = query.order_by(Company.created_at.desc())
    items, meta = paginate(db, query, page, page_size)
    return CompanyListResponse(items=[CompanyRead.model_validate(item) for item in items], meta=meta)


@router.get("/options", response_model=list[CompanyOption])
def list_company_options(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> list[CompanyOption]:
    companies = db.scalars(select(Company).order_by(Company.name.asc())).all()
    return [CompanyOption.model_validate(company) for company in companies]


@router.post("", response_model=CompanyRead, status_code=status.HTTP_201_CREATED)
def create_company(
    payload: CompanyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> CompanyRead:
    company = Company(
        name=payload.name.strip(),
        code=payload.code.strip().upper(),
        description=payload.description,
        is_active=payload.is_active,
        created_by_user_id=current_user.id,
    )
    db.add(company)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Company code already exists") from exc
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="create_company",
        entity_type="company",
        entity_id=company.id,
        metadata_json={"code": company.code},
    )
    db.commit()
    db.refresh(company)
    return CompanyRead.model_validate(company)


@router.get("/{company_id}", response_model=CompanyRead)
def get_company(
    company_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> CompanyRead:
    return CompanyRead.model_validate(_get_company_or_404(db, company_id))


@router.put("/{company_id}", response_model=CompanyRead)
def update_company(
    company_id: int,
    payload: CompanyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> CompanyRead:
    company = _get_company_or_404(db, company_id)
    if payload.name is not None:
        company.name = payload.name.strip()
    if payload.code is not None:
        company.code = payload.code.strip().upper()
    if payload.description is not None:
        company.description = payload.description
    if payload.is_active is not None:
        company.is_active = payload.is_active

    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Company code already exists") from exc

    log_audit(
        db,
        actor_user_id=current_user.id,
        action="update_company",
        entity_type="company",
        entity_id=company.id,
    )
    db.commit()
    db.refresh(company)
    return CompanyRead.model_validate(company)


@router.delete("/{company_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_company(
    company_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> None:
    company = _get_company_or_404(db, company_id)
    db.delete(company)
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="delete_company",
        entity_type="company",
        entity_id=company_id,
    )
    db.commit()
