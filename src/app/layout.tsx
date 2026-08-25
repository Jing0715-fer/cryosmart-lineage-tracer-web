import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "CryoSmart Lineage Tracer — Web",
  description:
    "Cross-browser reimplementation of the CryoSmart Lineage Tracer 3.0 Chrome extension. Trace particle & map lineage, build HTML/SVG/PPTX reports, download full bundles — no extension install required.",
  keywords: [
    "CryoSmart",
    "cryo-EM",
    "lineage tracer",
    "ChimeraX",
    "Next.js",
    "TypeScript",
  ],
  authors: [{ name: "CryoSmart Lineage Tracer Web" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "CryoSmart Lineage Tracer — Web",
    description:
      "Trace particle & map lineage for any CryoSmart job. Cross-browser, no install required.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CryoSmart Lineage Tracer — Web",
    description:
      "Trace particle & map lineage for any CryoSmart job. Cross-browser, no install required.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="antialiased bg-background text-foreground"
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
