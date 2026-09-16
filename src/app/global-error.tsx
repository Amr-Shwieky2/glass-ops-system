"use client";

/**
 * Last-resort boundary for an error thrown by the ROOT LAYOUT itself
 * (src/app/layout.tsx) — error.tsx alone can't catch that, since it
 * renders *inside* the layout it's a sibling of. Next.js requires this
 * file to render its own complete <html>/<body> (it replaces the layout
 * entirely when active), so it's deliberately minimal and dependency-free
 * — no shared UI components, no font import — since this is exactly the
 * path that runs when something more elaborate already failed.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          display: "flex",
          minHeight: "100svh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>حدث خطأ غير متوقع</h1>
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
          تعذّر تحميل التطبيق. حاول تحديث الصفحة.
        </p>
        <button
          onClick={() => reset()}
          style={{
            padding: "0.5rem 1.25rem",
            borderRadius: "0.375rem",
            backgroundColor: "#1e3a2f",
            color: "#fff",
            border: "none",
            cursor: "pointer",
          }}
        >
          حاول مرة أخرى
        </button>
      </body>
    </html>
  );
}
