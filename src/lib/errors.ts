// Turns raw backend errors into messages that are safe and useful to show.
export function friendlyError(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err && 'message' in err
        ? String((err as { message: unknown }).message)
        : '';
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email or password is incorrect.';
  if (m.includes('email not confirmed')) return 'Confirm your email address before signing in.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Cannot reach the server. Check your internet connection.';
  if (m.includes('permission denied') || m.includes('not allowed') || m.includes('only a super admin'))
    return 'You do not have permission to do that.';
  return 'Something went wrong. Please try again.';
}
