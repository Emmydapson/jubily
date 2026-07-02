type AccountEmailInput = {
  name?: string | null;
  url: string;
};

const DEFAULT_SUPPORT_EMAIL = 'info@joinjubily.com';
const PALETTE = {
  background: '#FFFDF7',
  card: '#FFFFFF',
  text: '#2B211D',
  muted: '#5F4A3F',
  cta: '#D99A29',
  border: '#E8D8C6',
  accent: '#1F766E',
};

function displayName(name?: string | null) {
  return String(name || 'there').trim() || 'there';
}

function supportEmail() {
  return String(process.env.SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL).trim() || DEFAULT_SUPPORT_EMAIL;
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
  const contact = escapeHtml(supportEmail());
  const cta = ctaUrl
    ? `
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 28px auto 18px;">
                <tr>
                  <td align="center" bgcolor="${PALETTE.cta}" style="border-radius: 10px;">
                    <a href="${ctaUrl}" style="display: inline-block; padding: 14px 24px; color: ${PALETTE.text}; font-family: Arial, Helvetica, sans-serif; font-size: 16px; font-weight: 700; line-height: 20px; text-decoration: none; background: ${PALETTE.cta}; border: 1px solid ${PALETTE.cta}; border-radius: 10px;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 6px; color: ${PALETTE.muted}; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 20px;">If the button does not work, paste this link into your browser:</p>
              <p style="margin: 0; word-break: break-all; color: ${PALETTE.muted}; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 20px;"><a href="${ctaUrl}" style="color: ${PALETTE.accent}; text-decoration: underline;">${ctaUrl}</a></p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${title}</title>
  </head>
  <body style="margin: 0; padding: 0; background: ${PALETTE.background};">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">${preheader}</div>
    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background: ${PALETTE.background}; margin: 0; padding: 28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 560px;">
            <tr>
              <td align="center" style="padding: 10px 0 18px;">
                <div style="font-family: Arial, Helvetica, sans-serif; color: ${PALETTE.text}; font-size: 24px; line-height: 30px; font-weight: 800; letter-spacing: 0;">Jubily</div>
                <div style="width: 42px; height: 4px; margin: 8px auto 0; background: ${PALETTE.accent}; border-radius: 999px;"></div>
              </td>
            </tr>
            <tr>
              <td style="background: ${PALETTE.card}; border: 1px solid ${PALETTE.border}; border-radius: 14px; padding: 32px 28px; box-shadow: 0 12px 30px rgba(43, 33, 29, 0.06);">
                <h1 style="margin: 0 0 14px; color: ${PALETTE.text}; font-family: Arial, Helvetica, sans-serif; font-size: 28px; line-height: 34px; font-weight: 800; text-align: center;">${title}</h1>
                <p style="margin: 0 0 12px; color: ${PALETTE.text}; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 24px;">Hi ${name},</p>
                <p style="margin: 0; color: ${PALETTE.text}; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 24px;">${body}</p>
                ${cta}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 18px 8px 0;">
                <p style="margin: 0; color: ${PALETTE.muted}; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 18px;">Jubily by Oneverse Technologies</p>
                <p style="margin: 4px 0 0; color: ${PALETTE.muted}; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 18px;">Contact: <a href="mailto:${contact}" style="color: ${PALETTE.accent}; text-decoration: underline;">${contact}</a></p>
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
    text: `Hi ${displayName(input.name)},\n\nVerify your email to finish setting up your Jubily account:\n${input.url}\n\nIf you did not create this account, you can ignore this email.\n\nJubily by Oneverse Technologies\nContact: ${supportEmail()}`,
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
    text: `Hi ${displayName(input.name)},\n\nReset your Jubily password here:\n${input.url}\n\nThis link expires soon. If you did not request it, you can ignore this email.\n\nJubily by Oneverse Technologies\nContact: ${supportEmail()}`,
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
    text: `Hi ${displayName(name)},\n\nYour Jubily password was changed. If this was not you, reset your password immediately and contact support.\n\nJubily by Oneverse Technologies\nContact: ${supportEmail()}`,
    html: brandedEmail({
      preheader: 'Your Jubily password was changed.',
      title: 'Password changed',
      greetingName: name,
      body: 'Your Jubily password was changed. If this was not you, reset your password immediately and contact support.',
    }),
  };
}
