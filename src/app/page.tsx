import { SignOutButton } from './components/SignOutButton';

export default function Home() {
  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-semibold">Hub</h1>
        <SignOutButton />
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="p-6 border rounded-lg dark:border-gray-800">
          <h2 className="font-medium mb-2">Notes</h2>
          <p className="text-sm text-gray-500">Coming in Phase 2</p>
        </section>

        <section className="p-6 border rounded-lg dark:border-gray-800">
          <h2 className="font-medium mb-2">Planner</h2>
          <p className="text-sm text-gray-500">Link coming soon</p>
        </section>

        <section className="p-6 border rounded-lg dark:border-gray-800 sm:col-span-2">
          <h2 className="font-medium mb-2">Drive</h2>
          <p className="text-sm text-gray-500">Coming in Phase 3</p>
        </section>
      </div>
    </main>
  );
}