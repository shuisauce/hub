import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in' }

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <h1 className="text-2xl font-semibold tracking-tight">Hub</h1>
        <LoginForm />
      </div>
    </main>
  )
}
