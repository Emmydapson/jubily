type AccountEmailInput = {
  name?: string | null;
  url: string;
};

function displayName(name?: string | null) {
  return String(name || 'there').trim() || 'there';
}

export function verificationEmailTemplate(input: AccountEmailInput) {
  return {
    subject: 'Verify your Jubily email',
    text: `Hi ${displayName(input.name)},\n\nVerify your email to finish setting up your Jubily account:\n${input.url}\n\nIf you did not create this account, you can ignore this email.`,
    html: `<p>Hi ${displayName(input.name)},</p><p>Verify your email to finish setting up your Jubily account:</p><p><a href="${input.url}">Verify email</a></p><p>If you did not create this account, you can ignore this email.</p>`,
  };
}

export function passwordResetEmailTemplate(input: AccountEmailInput) {
  return {
    subject: 'Reset your Jubily password',
    text: `Hi ${displayName(input.name)},\n\nReset your Jubily password here:\n${input.url}\n\nThis link expires soon. If you did not request it, you can ignore this email.`,
    html: `<p>Hi ${displayName(input.name)},</p><p>Reset your Jubily password here:</p><p><a href="${input.url}">Reset password</a></p><p>This link expires soon. If you did not request it, you can ignore this email.</p>`,
  };
}

export function passwordChangedEmailTemplate(name?: string | null) {
  return {
    subject: 'Your Jubily password was changed',
    text: `Hi ${displayName(name)},\n\nYour Jubily password was changed. If this was not you, reset your password immediately and contact support.`,
    html: `<p>Hi ${displayName(name)},</p><p>Your Jubily password was changed. If this was not you, reset your password immediately and contact support.</p>`,
  };
}
