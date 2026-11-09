"""Mail delivery modes: Brevo HTTPS API, SMTP (STARTTLS / SSL), console; failures never break signup."""
import logging
import smtplib

import httpx
import pytest

from app.core import mailer
from tests.helpers import register


class Resp:
    def __init__(self, code=201, text=""):
        self.status_code, self.text = code, text


@pytest.fixture()
def brevo(settings, monkeypatch):
    monkeypatch.setattr(settings, "brevo_api_key", "BREVO-SECRET")
    monkeypatch.setattr(settings, "mail_from", "ResearchForge <me@gmail.com>")
    sent = []
    monkeypatch.setattr(httpx, "post", lambda url, **kw: (sent.append((url, kw)), Resp())[1])
    return sent


def test_mode_priority(settings, monkeypatch):
    assert mailer.mail_mode() == "console"
    monkeypatch.setattr(settings, "smtp_host", "smtp.gmail.com")
    assert mailer.mail_mode() == "smtp"
    monkeypatch.setattr(settings, "brevo_api_key", "k")
    assert mailer.mail_mode() == "brevo"


def test_signup_sends_verification_through_brevo_https_api(client, brevo):
    assert register(client).status_code == 201
    (url, kw), = brevo
    assert url == "https://api.brevo.com/v3/smtp/email" and kw["headers"]["api-key"] == "BREVO-SECRET"
    body = kw["json"]
    assert body["sender"] == {"name": "ResearchForge", "email": "me@gmail.com"}
    assert body["to"] == [{"email": "ada@example.com"}] and "auth/callback?type=verify&token=" in body["textContent"]
    assert not mailer.OUTBOX  # nothing was only logged


def test_brevo_failure_is_logged_without_the_key_and_does_not_break_signup(client, brevo, monkeypatch, caplog):
    monkeypatch.setattr(httpx, "post", lambda url, **kw: Resp(400, '{"message":"sender not verified"}'))
    with caplog.at_level(logging.ERROR):
        assert register(client).status_code == 201
    assert "EMAIL DELIVERY FAILED via brevo" in caplog.text and "sender not verified" in caplog.text
    assert "BREVO-SECRET" not in caplog.text


def test_network_error_to_brevo_is_contained(client, brevo, monkeypatch, caplog):
    def boom(url, **kw):
        raise httpx.ConnectTimeout("timeout")
    monkeypatch.setattr(httpx, "post", boom)
    assert register(client).status_code == 201


@pytest.mark.parametrize("ssl,cls", [(True, "SMTP_SSL"), (False, "SMTP")])
def test_smtp_uses_ssl_or_starttls(settings, monkeypatch, ssl, cls):
    monkeypatch.setattr(settings, "smtp_host", "smtp.gmail.com")
    monkeypatch.setattr(settings, "smtp_port", 465 if ssl else 587)
    monkeypatch.setattr(settings, "smtp_ssl", ssl)
    monkeypatch.setattr(settings, "smtp_user", "me@gmail.com")
    monkeypatch.setattr(settings, "smtp_password", "app-pass")
    log = []

    class Fake:
        def __init__(self, host, port, timeout=None):
            log.append((cls_name, host, port))
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self): log.append("starttls")
        def login(self, u, p): log.append(("login", u))
        def send_message(self, m): log.append("sent")

    cls_name = cls
    monkeypatch.setattr(smtplib, cls, Fake)
    mailer.send_verification_email("x@example.com", "X", "tok")
    assert log[0][:2] == (cls, "smtp.gmail.com") and ("login", "me@gmail.com") in log and log[-1] == "sent"
    assert ("starttls" in log) is (not ssl)


def test_health_reports_mail_mode_and_keyed_providers_but_no_secrets(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "brevo_api_key", "BREVO-SECRET")
    monkeypatch.setattr(settings, "springer_api_key", "SPR-SECRET")
    r = client.get("/api/health")
    assert r.json()["email"] == "brevo" and r.json()["literature_keys"] == ["springer"] and r.json()["database"] == "connected"
    assert "SECRET" not in r.text
