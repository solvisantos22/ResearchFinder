import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research Finder",
  description: "Personalized research paper inbox and viability sprint platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-rf-black text-rf-white antialiased">{children}</body>
    </html>
  );
}
