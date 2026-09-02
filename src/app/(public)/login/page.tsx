import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "تسجيل الدخول | نظام إدارة عمليات الزجاج",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">
            ز
          </div>
          <h1 className="text-xl font-bold text-foreground">
            نظام إدارة عمليات الزجاج
          </h1>
          <p className="text-sm text-muted-foreground">
            سجّل الدخول للمتابعة إلى حسابك
          </p>
        </div>
        <LoginForm redirectTo={params.redirect} />
      </div>
      <p className="text-xs text-muted-foreground">
        © {new Date().getFullYear()} جميع الحقوق محفوظة
      </p>
    </div>
  );
}
