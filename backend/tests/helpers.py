import re

from app.core import mailer

VALID = {
    "research_question": "Can T1-weighted MRI improve early Alzheimer's detection using interpretable regional biomarkers?",
    "modality": "T1-weighted MRI",
    "disease": "Alzheimer's Disease",
    "objectives": ["Early Detection", "Biomarker Identification"],
}

PASSWORD = "correct-horse-42"


def register_payload(email="ada@example.com", **over):
    body = {
        "full_name": "Ada Lovelace",
        "email": email,
        "password": PASSWORD,
        "confirm_password": PASSWORD,
        "accept_terms": True,
    }
    body.update(over)
    return body


def register(client, email="ada@example.com", **over):
    return client.post("/api/auth/register", json=register_payload(email, **over))


def login(client, email="ada@example.com", password=PASSWORD, remember_me=False):
    return client.post(
        "/api/auth/login", json={"email": email, "password": password, "remember_me": remember_me}
    )


def last_token(to: str, kind: str) -> str:
    """Pull the token out of the most recent email to `to` (kind: 'verify' | 'reset')."""
    marker = "type=verify" if kind == "verify" else "reset-password"
    for mail in reversed(mailer.OUTBOX):
        if mail.to == to and marker in mail.text:
            return re.search(r"token=([^\s&]+)", mail.text).group(1)
    raise AssertionError(f"no {kind} email for {to}; outbox={[m.to for m in mailer.OUTBOX]}")


def error_code(response) -> str:
    return response.json()["detail"]["code"]
