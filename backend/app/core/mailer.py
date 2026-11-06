"""Pluggable mailer.

- SMTP_HOST set  -> real delivery over SMTP (STARTTLS by default).
- otherwise      -> console backend: the message is logged (dev only) and kept in OUTBOX so
                    tests can read the verification / reset links. Nothing is faked: in this mode
                    no email leaves the machine and the README says so.
"""
import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from urllib.parse import quote

from app.core.config import get_settings

log = logging.getLogger("researchforge.mail")


@dataclass
class Mail:
    to: str
    subject: str
    text: str
    html: str


OUTBOX: list[Mail] = []  # console backend only (capped)


def _deliver(mail: Mail) -> None:
    s = get_settings()
    if s.smtp_host:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = s.mail_from, mail.to, mail.subject
        msg.set_content(mail.text)
        msg.add_alternative(mail.html, subtype="html")
        try:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
                if s.smtp_starttls:
                    smtp.starttls()
                if s.smtp_user:
                    smtp.login(s.smtp_user, s.smtp_password)
                smtp.send_message(msg)
        except Exception:
            log.exception("SMTP delivery failed for %s", mail.to)
        return
    OUTBOX.append(mail)
    del OUTBOX[:-100]
    if s.environment == "production":
        log.warning("Email not sent: SMTP_HOST is not configured")
    else:
        log.info("[console mailer] To: %s | %s\n%s", mail.to, mail.subject, mail.text)


def _html(name: str, intro: str, cta: str, link: str, outro: str) -> str:
    return (
        '<div style="font-family:Inter,Arial,sans-serif;background:#050b1a;color:#dbe7ff;padding:32px">'
        '<div style="max-width:480px;margin:auto;background:#0b1630;border:1px solid #1c2c52;'
        'border-radius:16px;padding:32px">'
        '<h2 style="margin:0 0 16px;color:#fff">ResearchForge</h2>'
        f"<p>Hi {name},</p><p>{intro}</p>"
        f'<p style="margin:28px 0"><a href="{link}" style="background:#4cc9f0;color:#04101f;'
        f'padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">{cta}</a></p>'
        f'<p style="font-size:13px;color:#8aa0cc">{outro}</p></div></div>'
    )


def send_verification_email(to: str, name: str, token: str) -> None:
    link = f"{get_settings().frontend_url.rstrip('/')}/auth/callback?type=verify&token={quote(token)}"
    hours = get_settings().verification_hours
    _deliver(
        Mail(
            to,
            "Verify your ResearchForge email",
            f"Hi {name},\n\nConfirm your email to finish setting up ResearchForge:\n{link}\n\n"
            f"This link expires in {hours} hours. If you did not sign up, ignore this message.",
            _html(name, "Confirm your email address to finish setting up your account.",
                  "Verify email", link, f"This link expires in {hours} hours. Not you? Ignore this email."),
        )
    )


def send_password_reset_email(to: str, name: str, token: str) -> None:
    link = f"{get_settings().frontend_url.rstrip('/')}/reset-password?token={quote(token)}"
    minutes = get_settings().reset_minutes
    _deliver(
        Mail(
            to,
            "Reset your ResearchForge password",
            f"Hi {name},\n\nUse this link to choose a new password:\n{link}\n\n"
            f"It expires in {minutes} minutes and works once. If you did not ask for this, "
            "you can ignore it - your password has not changed.",
            _html(name, "We received a request to reset your password.", "Choose a new password",
                  link, f"This link expires in {minutes} minutes and works once. Not you? Ignore this email."),
        )
    )
