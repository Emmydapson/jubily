type AccountEmailInput = {
  name?: string | null;
  url: string;
};

function displayName(name?: string | null) {
  return String(name || 'there').trim() || 'there';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function brandedEmail(input: {
  preheader: string;
  title: string;
  greetingName?: string | null;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}) {
  const name = escapeHtml(displayName(input.greetingName));
  const body = escapeHtml(input.body);
  const preheader = escapeHtml(input.preheader);
  const title = escapeHtml(input.title);
  const ctaLabel = input.ctaLabel ? escapeHtml(input.ctaLabel) : '';
  const ctaUrl = input.ctaUrl ? escapeHtml(input.ctaUrl) : '';
  const cta = ctaUrl
    ? `
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 28px auto 18px;">
                <tr>
                  <td align="center" bgcolor="#FF5A3D" style="border-radius: 10px;">
                    <a href="${ctaUrl}" style="display: inline-block; padding: 14px 24px; color: #FFFFFF; font-family: Arial, Helvetica, sans-serif; font-size: 16px; font-weight: 700; line-height: 20px; text-decoration: none; background: #FF5A3D; border: 1px solid #FF7A59; border-radius: 10px;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 6px; color: #8A6A5B; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 20px;">If the button does not work, paste this link into your browser:</p>
              <p style="margin: 0; word-break: break-all; color: #8A6A5B; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 20px;"><a href="${ctaUrl}" style="color: #FF5A3D; text-decoration: underline;">${ctaUrl}</a></p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${title}</title>
  </head>
  <body style="margin: 0; padding: 0; background: #FFF8F0;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">${preheader}</div>
    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background: #FFF8F0; margin: 0; padding: 28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 560px;">
            <tr>
              <td align="center" style="padding: 10px 0 18px;">
                <div style="font-family: Arial, Helvetica, sans-serif; color: #241915; font-size: 24px; line-height: 30px; font-weight: 800; letter-spacing: 0;">Jubily</div>
                <div style="width: 42px; height: 4px; margin: 8px auto 0; background: #FFB84D; border-radius: 999px;"></div>
              </td>
            </tr>
            <tr>
              <td style="background: #FFFFFF; border: 1px solid #EAD8C8; border-radius: 18px; padding: 32px 28px; box-shadow: 0 12px 30px rgba(36, 25, 21, 0.06);">
                <h1 style="margin: 0 0 14px; color: #241915; font-family: Arial, Helvetica, sans-serif; font-size: 28px; line-height: 34px; font-weight: 800; text-align: center;">${title}</h1>
                <p style="margin: 0 0 12px; color: #241915; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 24px;">Hi ${name},</p>
                <p style="margin: 0; color: #241915; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 24px;">${body}</p>
                ${cta}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 18px 8px 0;">
                <p style="margin: 0; color: #8A6A5B; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 18px;">Jubily</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function verificationEmailTemplate(input: AccountEmailInput) {
  return {
    subject: 'Verify your Jubily email',
    text: `Hi ${displayName(input.name)},\n\nVerify your email to finish setting up your Jubily account:\n${input.url}\n\nIf you did not create this account, you can ignore this email.`,
    html: brandedEmail({
      preheader: 'Verify your email to finish setting up Jubily.',
      title: 'Verify your email',
      greetingName: input.name,
      body: 'Confirm your email address to finish setting up your creator studio and unlock your workspace.',
      ctaLabel: 'Verify email',
      ctaUrl: input.url,
    }),
  };
}

export function passwordResetEmailTemplate(input: AccountEmailInput) {
  return {
    subject: 'Reset your Jubily password',
    text: `Hi ${displayName(input.name)},\n\nReset your Jubily password here:\n${input.url}\n\nThis link expires soon. If you did not request it, you can ignore this email.`,
    html: brandedEmail({
      preheader: 'Reset your Jubily password.',
      title: 'Reset your password',
      greetingName: input.name,
      body: 'Use this secure link to choose a new password. The link expires soon, so request a new one if it no longer works.',
      ctaLabel: 'Reset password',
      ctaUrl: input.url,
    }),
  };
}

export function passwordChangedEmailTemplate(name?: string | null) {
  return {
    subject: 'Your Jubily password was changed',
    text: `Hi ${displayName(name)},\n\nYour Jubily password was changed. If this was not you, reset your password immediately and contact support.`,
    html: brandedEmail({
      preheader: 'Your Jubily password was changed.',
      title: 'Password changed',
      greetingName: name,
      body: 'Your Jubily password was changed. If this was not you, reset your password immediately and contact support.',
    }),
  };
}
