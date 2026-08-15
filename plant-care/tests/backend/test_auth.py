from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from plantcare.auth import CSRF_COOKIE, SESSION_COOKIE
from plantcare.config import Settings
from plantcare.main import create_app


@pytest.fixture
def auth_client(tmp_path: Path) -> TestClient:
    settings = Settings(
        environment="test",
        auth_mode="enabled",
        data_dir=tmp_path,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'auth.db'}",
        static_dir=tmp_path / "static",
    )
    with TestClient(create_app(settings), base_url="https://testserver") as client:
        yield client


def test_lan_password_can_only_be_created_from_ingress(auth_client: TestClient) -> None:
    denied = auth_client.post(
        "/api/v1/auth/password",
        headers={"x-plantcare-surface": "lan"},
        json={"password": "a secure household password"},
    )
    assert denied.status_code == 401

    created = auth_client.post(
        "/api/v1/auth/password",
        headers={"x-plantcare-surface": "ingress", "x-remote-user-name": "Test Owner"},
        json={"password": "a secure household password"},
    )
    assert created.status_code == 204


def test_lan_login_uses_server_session_and_csrf(auth_client: TestClient) -> None:
    auth_client.post(
        "/api/v1/auth/password",
        headers={"x-plantcare-surface": "ingress", "x-remote-user-name": "Test Owner"},
        json={"password": "a secure household password"},
    )
    response = auth_client.post(
        "/api/v1/auth/login",
        headers={"x-plantcare-surface": "lan"},
        json={"password": "a secure household password"},
    )
    assert response.status_code == 200
    assert response.json()["actor"] == "Household (LAN)"
    assert SESSION_COOKIE in response.cookies
    assert CSRF_COOKIE in response.cookies

    session = auth_client.get("/api/v1/auth/session", headers={"x-plantcare-surface": "lan"})
    assert session.status_code == 200
    assert session.json()["authenticated"] is True


def test_invalid_lan_password_is_rejected(auth_client: TestClient) -> None:
    auth_client.post(
        "/api/v1/auth/password",
        headers={"x-plantcare-surface": "ingress", "x-remote-user-name": "Test Owner"},
        json={"password": "a secure household password"},
    )
    rejected = auth_client.post(
        "/api/v1/auth/login",
        headers={"x-plantcare-surface": "lan"},
        json={"password": "incorrect password"},
    )
    assert rejected.status_code == 401


def test_ingress_password_change_revokes_existing_lan_session(auth_client: TestClient) -> None:
    ingress_headers = {"x-plantcare-surface": "ingress", "x-remote-user-name": "Second Test User"}
    auth_client.post(
        "/api/v1/auth/password",
        headers=ingress_headers,
        json={"password": "first secure household password"},
    )
    auth_client.post(
        "/api/v1/auth/login",
        headers={"x-plantcare-surface": "lan"},
        json={"password": "first secure household password"},
    )
    auth_client.post(
        "/api/v1/auth/password",
        headers=ingress_headers,
        json={"password": "second secure household password"},
    )
    response = auth_client.get("/api/v1/auth/session", headers={"x-plantcare-surface": "lan"})
    assert response.status_code == 401


def test_spoofed_identity_without_surface_is_rejected(auth_client: TestClient) -> None:
    response = auth_client.get(
        "/api/v1/plants", headers={"x-remote-user-name": "Spoofed administrator"}
    )
    assert response.status_code == 403
