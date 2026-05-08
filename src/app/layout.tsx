import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { IdleLogout } from "@/components/idle-logout";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hub",
  description: "A personal hub.",
};

// Inline script that runs before paint to apply the saved theme. Avoids the
// "flash of light theme" when a dark-mode user reloads the page.
const themeScript = `
(function() {
  try {
    var t = document.cookie.split('; ').find(function(c){return c.indexOf('theme=')===0;});
    var v = t ? t.split('=')[1] : '';
    var c = document.documentElement.classList;
    c.remove('light','dark');
    if (v === 'light') c.add('light');
    else if (v === 'dark') c.add('dark');
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches) c.add('dark');
  } catch (_) {}
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const initialClass =
    themeCookie === "dark" ? "dark" : themeCookie === "light" ? "light" : "";

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased ${initialClass}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <IdleLogout />
        {children}
      </body>
    </html>
  );
}
