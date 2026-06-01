import { useState } from "react";
import { Form, useNavigation, useActionData, redirect } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { getSession, loginAdmin, logoutAdmin } from "../session.server";

// Page metadata
export function meta() {
  return [
    { title: "Secure Login - Dreamline Logistics" },
    { name: "description", content: "Super secure administrative console gateway." },
  ];
}

// Redirect authenticated users away from the login page
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const isAuthenticated = session.get("isAuthenticated");
  if (isAuthenticated) {
    return redirect("/");
  }
  return {};
}

// Handle administrative login credentials and logout operations
export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const actionType = formData.get("_action")?.toString();

  if (actionType === "logout") {
    return await logoutAdmin(request);
  }

  const username = formData.get("username")?.toString() || "";
  const password = formData.get("password")?.toString() || "";

  if (!username.trim() || !password.trim()) {
    return { error: "Please enter both administrative username and password." };
  }

  const redirectResponse = await loginAdmin(request, username, password);
  if (!redirectResponse) {
    return { error: "Invalid administrative credentials. Access Denied." };
  }

  return redirectResponse;
}

export default function LoginRoute() {
  const actionData = useActionData() as { error?: string } | undefined;
  const navigation = useNavigation();
  const [showPassword, setShowPassword] = useState(false);

  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-[#f8f9fa] dark:bg-[#121212] overflow-hidden px-4 select-none">
      {/* Dynamic Aesthetic Background Glow Circles */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] aspect-square rounded-full bg-blue-500/10 dark:bg-blue-600/5 blur-[120px] pointer-events-none animate-pulse" style={{ animationDuration: "12s" }} />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] aspect-square rounded-full bg-emerald-500/10 dark:bg-emerald-600/5 blur-[120px] pointer-events-none animate-pulse" style={{ animationDuration: "16s" }} />

      <div className="w-full max-w-[420px] z-10">
        {/* Logo and Greeting Header */}
        <div className="text-center mb-8 flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-white dark:bg-neutral-900 flex items-center justify-center shadow-2xl shadow-blue-500/10 mb-4 transition-transform hover:scale-105 duration-300 p-2 border border-neutral-100 dark:border-neutral-800">
            <img src="/logo.png" alt="Dreamline Logo" className="w-full h-full object-contain rounded-xl" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-neutral-950 dark:text-neutral-50 font-sans">
            Dreamline Logistics
          </h1>
          <p className="text-xs font-semibold text-neutral-400 dark:text-neutral-500 mt-1 uppercase tracking-widest">
            Administrative Console Gate
          </p>
        </div>

        {/* Glassmorphic Login Form Card */}
        <div className="bg-white/70 dark:bg-[#1a1a1a]/70 backdrop-blur-xl border border-neutral-200/80 dark:border-neutral-800/80 shadow-2xl rounded-3xl p-8 space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-neutral-900 dark:text-white">
              Identity Verification
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Only authenticated administrators can load or modify logs.
            </p>
          </div>

          {/* Secure credentials warning error alert banner */}
          {actionData?.error && (
            <div className="p-4 bg-rose-500/10 dark:bg-rose-500/5 border border-rose-500/20 rounded-2xl flex items-start gap-3 animate-headShake">
              <svg className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 leading-tight">
                {actionData.error}
              </span>
            </div>
          )}

          <Form method="post" className="space-y-4">
            {/* Username Input */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                Username
              </label>
              <div className="relative">
                <input
                  type="text"
                  name="username"
                  required
                  autoFocus
                  placeholder="Enter administrative identity"
                  className="w-full text-sm font-semibold border border-neutral-200 dark:border-neutral-800 rounded-xl px-4 py-3 bg-white/50 dark:bg-[#121212]/50 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  required
                  placeholder="Enter access code"
                  className="w-full text-sm font-mono border border-neutral-200 dark:border-neutral-800 rounded-xl px-4 py-3 bg-white/50 dark:bg-[#121212]/50 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Submit Action Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 font-bold text-sm rounded-xl hover:shadow-xl hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer select-none flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Verifying Access...</span>
                  </>
                ) : (
                  <span>Verify Identity</span>
                )}
              </button>
            </div>
          </Form>
        </div>

        {/* Security watermark */}
        <p className="text-center text-[10px] uppercase font-bold text-neutral-400 dark:text-neutral-500 mt-6 tracking-widest">
          🔐 Secure Endpoint • SHA-256 Signed Session
        </p>
      </div>
    </div>
  );
}
