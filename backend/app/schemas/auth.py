from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

# Tiny deny-list of the most common passwords that still satisfy length + letter + digit rules.
_COMMON = {
    "password123", "password1234", "passw0rd123", "qwerty12345", "qwertyuiop1", "1234567890a",
    "a1234567890", "iloveyou123", "welcome1234", "admin123456", "letmein1234", "abc1234567",
    "researchforge1", "researchforge123",
}


def validate_password_strength(password: str, *, email: str | None = None) -> str:
    if len(password) < 10:
        raise ValueError("Password must be at least 10 characters.")
    if len(password) > 128:
        raise ValueError("Password must be at most 128 characters.")
    if not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
        raise ValueError("Password must contain at least one letter and one number.")
    low = password.lower()
    if low in _COMMON:
        raise ValueError("That password is too common. Choose something less guessable.")
    if email and (low == email.lower() or low == email.lower().split("@")[0]):
        raise ValueError("Password must not be the same as your email.")
    return password


class RegisterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(max_length=256)
    confirm_password: str = Field(max_length=256)
    accept_terms: bool

    @field_validator("full_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("Please enter your full name.")
        return v

    @model_validator(mode="after")
    def _check(self) -> "RegisterIn":
        if not self.accept_terms:
            raise ValueError("You must accept the terms and conditions.")
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match.")
        validate_password_strength(self.password, email=str(self.email))
        return self


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    remember_me: bool = False


class EmailIn(BaseModel):
    email: EmailStr


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class ResetPasswordIn(TokenIn):
    password: str = Field(max_length=256)

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return validate_password_strength(v)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: str
    is_verified: bool
    created_at: datetime


class TrialStatus(BaseModel):
    limit: int = 1
    used: int
    remaining: int
    exhausted: bool


class SessionRead(BaseModel):
    """What the UI renders from. Always derived from the server, never hardcoded."""

    state: Literal["anonymous", "guest", "user"]
    user: UserRead | None = None
    trial: TrialStatus | None = None
    claimed_projects: int = 0
    verification_required: bool = False


class MessageOut(BaseModel):
    message: str
