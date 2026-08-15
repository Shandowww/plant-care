import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings
from .models import AppSetting, AuditEvent

SESSION_COOKIE = "plantcare_session"
CSRF_COOKIE = "plantcare_csrf"
PASSWORD_HASH_KEY = "auth.lan_password_hash"  # noqa: S105 - database key, not a secret
SESSION_VERSION_KEY = "auth.session_version"
MAX_SESSION_AGE_SECONDS = 60 * 60 * 24 * 14
TRUSTED_SURFACES = {"ingress", "lan"}


@dataclass(frozen=True)
class Identity:
    actor: str
    surface: str


class AuthService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.password_hasher = PasswordHasher()
        self.serializer = URLSafeTimedSerializer(self._load_or_create_secret(), salt="lan-session")
        self.failures: dict[str, tuple[int, float]] = {}

    def _load_or_create_secret(self) -> str:
        secret_dir = self.settings.data_dir / "secrets"
        secret_path = secret_dir / "session-signing-key"
        secret_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        if secret_path.exists():
            return secret_path.read_text(encoding="utf-8").strip()
        value = secrets.token_urlsafe(64)
        file_descriptor = os.open(secret_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as secret_file:
            secret_file.write(value)
        return value

    @staticmethod
    def surface(request: Request) -> str:
        value = request.headers.get("x-plantcare-surface", "")
        if value not in TRUSTED_SURFACES:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Untrusted surface")
        return value

    @staticmethod
    async def _setting(session: AsyncSession, key: str) -> AppSetting | None:
        return await session.scalar(select(AppSetting).where(AppSetting.key == key))

    async def session_version(self, session: AsyncSession) -> int:
        setting = await self._setting(session, SESSION_VERSION_KEY)
        return int(setting.typed_value) if setting else 1

    async def set_password(self, session: AsyncSession, password: str, actor: str) -> None:
        password_hash = self.password_hasher.hash(password)
        hash_setting = await self._setting(session, PASSWORD_HASH_KEY)
        version_setting = await self._setting(session, SESSION_VERSION_KEY)
        if hash_setting:
            hash_setting.typed_value = password_hash
        else:
            session.add(AppSetting(key=PASSWORD_HASH_KEY, typed_value=password_hash))
        if version_setting:
            version_setting.typed_value = int(version_setting.typed_value) + 1
        else:
            session.add(AppSetting(key=SESSION_VERSION_KEY, typed_value=2))
        session.add(
            AuditEvent(
                actor=actor,
                event_type="lan_password_changed",
                object_type="app_setting",
                object_id=PASSWORD_HASH_KEY,
            )
        )
        await session.commit()

    async def verify_password(self, session: AsyncSession, password: str) -> bool:
        setting = await self._setting(session, PASSWORD_HASH_KEY)
        if not setting or not isinstance(setting.typed_value, str):
            return False
        try:
            return bool(self.password_hasher.verify(setting.typed_value, password))
        except (VerifyMismatchError, InvalidHashError):
            return False

    def rate_limit_key(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for", "")
        remote = forwarded.split(",", 1)[0].strip() if forwarded else "unknown"
        return hashlib.sha256(remote.encode()).hexdigest()

    def check_login_delay(self, key: str) -> None:
        count, last_failure = self.failures.get(key, (0, 0.0))
        delay = min(30.0, 2 ** max(0, count - 1)) if count else 0.0
        retry_after = last_failure + delay - time.monotonic()
        if retry_after > 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Try again shortly",
                headers={"Retry-After": str(max(1, int(retry_after)))},
            )

    def record_failure(self, key: str) -> None:
        count, _ = self.failures.get(key, (0, 0.0))
        self.failures[key] = (min(10, count + 1), time.monotonic())

    def create_session(self, response: Response, version: int) -> str:
        csrf = secrets.token_urlsafe(32)
        token = self.serializer.dumps({"version": version, "nonce": secrets.token_urlsafe(16)})
        response.set_cookie(
            SESSION_COOKIE,
            token,
            httponly=True,
            samesite="lax",
            secure=self.settings.environment == "production",
            max_age=MAX_SESSION_AGE_SECONDS,
            path="/",
        )
        response.set_cookie(
            CSRF_COOKIE,
            csrf,
            httponly=False,
            samesite="lax",
            secure=self.settings.environment == "production",
            max_age=MAX_SESSION_AGE_SECONDS,
            path="/",
        )
        return csrf

    def clear_session(self, response: Response) -> None:
        response.delete_cookie(SESSION_COOKIE, path="/")
        response.delete_cookie(CSRF_COOKIE, path="/")

    async def identity(self, request: Request, session: AsyncSession) -> Identity:
        if self.settings.auth_mode == "disabled" and self.settings.environment != "production":
            return Identity(actor="Developer", surface="development")
        surface = self.surface(request)
        if surface == "ingress":
            actor = request.headers.get("x-remote-user-name") or request.headers.get(
                "x-remote-user-display-name"
            )
            return Identity(actor=(actor or "Home Assistant user")[:120], surface=surface)

        token = request.cookies.get(SESSION_COOKIE)
        if not token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login required")
        try:
            payload = self.serializer.loads(token, max_age=MAX_SESSION_AGE_SECONDS)
        except (BadSignature, SignatureExpired) as error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired"
            ) from error
        expected_version = await self.session_version(session)
        if not hmac.compare_digest(str(payload.get("version")), str(expected_version)):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked")
        return Identity(actor="Household (LAN)", surface=surface)

    @staticmethod
    def require_csrf(request: Request, identity: Identity) -> None:
        if identity.surface != "lan" or request.method in {"GET", "HEAD", "OPTIONS"}:
            return
        cookie = request.cookies.get(CSRF_COOKIE, "")
        header = request.headers.get("x-csrf-token", "")
        if not cookie or not header or not hmac.compare_digest(cookie, header):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF check failed")


def ensure_ingress(identity: Identity) -> None:
    if identity.surface not in {"ingress", "development"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This setting can only be changed through Home Assistant ingress",
        )
