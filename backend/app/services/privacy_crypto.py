from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

_cipher = Fernet(settings.privacy_fernet_key)


def encrypt_text(value: str) -> str:
    payload = (value or "").strip()
    if not payload:
        return ""
    return _cipher.encrypt(payload.encode("utf-8")).decode("utf-8")


def decrypt_text(value: str | None) -> str:
    token = (value or "").strip()
    if not token:
        return ""
    try:
        return _cipher.decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return "[Encrypted content unavailable]"
