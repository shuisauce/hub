'use client'

import type { ReactNode } from 'react'

/**
 * Wraps a server-action <form> with a native confirm() dialog. If the user
 * cancels the prompt, the submission is prevented before the action fires.
 */
export function ConfirmForm({
  action,
  message,
  className,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>
  message: string
  className?: string
  children: ReactNode
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!window.confirm(message)) e.preventDefault()
      }}
    >
      {children}
    </form>
  )
}
