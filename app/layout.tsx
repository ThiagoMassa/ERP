import type { Metadata } from "next";
import "./globals.css";
import "./operations.css";

export const metadata: Metadata = {
  title: "Fluxo · Seu negócio, por inteiro",
  description: "Gestão financeira, produtos, precificação e fornecedores para o seu negócio.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}


