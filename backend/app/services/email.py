import smtplib
from email.message import EmailMessage

from app.core.config import settings
from app.models.enums import UserRole


def role_label(role: UserRole) -> str:
    mapping = {
        UserRole.COMPANY_HEAD: "Company Head",
        UserRole.DEPARTMENT_MANAGER: "Department Manager",
        UserRole.EMPLOYEE: "Employee",
        UserRole.SYSTEM_ADMIN: "System Admin",
        UserRole.SUPER_ADMIN: "Super Admin",
    }
    return mapping.get(role, role.value.replace("_", " ").title())


def build_invitation_email_html(
    *,
    full_name: str,
    company_name: str,
    role: UserRole,
    signup_url: str,
    invitation_code: str,
) -> str:
    assigned_role = role_label(role)
    return f"""\
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#faf8f3;font-family:'DM Sans',Arial,sans-serif;color:#1a2b3c;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf8f3;padding:28px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:18px;border:1px solid rgba(26,43,60,0.08);overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg,#1a2b3c,#2c4560);padding:26px 30px;">
                <div style="font-family:'DM Serif Display',Georgia,serif;font-size:30px;line-height:1;color:#ffffff;letter-spacing:-0.4px;">
                  Mind<span style="font-style:italic;color:#a8d8b4;">Well</span>
                </div>
                <p style="margin:10px 0 0;color:rgba(255,255,255,0.78);font-size:13px;">
                  Premium workplace wellness onboarding
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px;">
                <p style="margin:0 0 14px;font-size:15px;">Hello {full_name},</p>
                <h1 style="margin:0 0 14px;font-family:'DM Serif Display',Georgia,serif;font-size:30px;line-height:1.2;color:#1a2b3c;">
                  You are invited to join <span style="font-style:italic;color:#3a8f55;">MindWell</span>
                </h1>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#5a6a7a;">
                  Welcome to MindWell. You have been invited to join <strong>{company_name}</strong> as
                  <strong>{assigned_role}</strong>. To complete your onboarding, use the invitation code below and
                  finish signup.
                </p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background:#eaf5ee;border:1px solid #a8d8b4;border-radius:14px;">
                  <tr>
                    <td style="padding:18px 20px;">
                      <p style="margin:0 0 6px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#1f5e36;">Invitation Code</p>
                      <p style="margin:0;font-family:'DM Serif Display',Georgia,serif;font-size:34px;letter-spacing:2px;color:#1f5e36;">{invitation_code}</p>
                      <p style="margin:8px 0 0;font-size:12px;color:#1f5e36;">This 9-digit code is required to complete signup.</p>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 20px;">
                  <a href="{signup_url}" style="display:inline-block;background:#1a2b3c;color:#ffffff;text-decoration:none;border-radius:999px;padding:12px 24px;font-weight:600;font-size:14px;">
                    Complete Signup
                  </a>
                </p>
                <p style="margin:0 0 8px;font-size:13px;color:#5a6a7a;">
                  Signup link: <a href="{signup_url}" style="color:#1a2b3c;">{signup_url}</a>
                </p>
                <p style="margin:0;font-size:12px;color:#5a6a7a;">
                  If you did not expect this invitation, please ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 30px;border-top:1px solid rgba(26,43,60,0.08);background:#faf8f3;">
                <p style="margin:0;font-size:11px;color:#5a6a7a;">
                  MindWell • AI-powered employee wellness platform
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def send_email(*, to_email: str, subject: str, html_body: str, text_body: str | None = None) -> None:
    if not settings.mail_host or not settings.mail_username or not settings.mail_password:
        raise ValueError("SMTP email credentials are missing. Configure MAIL_* environment variables.")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{settings.mail_from_name} <{settings.mail_from_address}>"
    message["To"] = to_email
    message.set_content(text_body or "Please view this message in an HTML-capable email client.")
    message.add_alternative(html_body, subtype="html")

    encryption = settings.mail_encryption.lower().strip()
    if encryption == "ssl":
        with smtplib.SMTP_SSL(settings.mail_host, settings.mail_port, timeout=20) as server:
            server.login(settings.mail_username, settings.mail_password)
            server.send_message(message)
        return

    with smtplib.SMTP(settings.mail_host, settings.mail_port, timeout=20) as server:
        server.ehlo()
        if encryption in {"tls", "starttls"}:
            server.starttls()
            server.ehlo()
        server.login(settings.mail_username, settings.mail_password)
        server.send_message(message)

