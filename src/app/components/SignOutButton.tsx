'use client';

export function SignOutButton() {
  async function handleSignOut() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
    >
      Sign out
    </button>
  );
}