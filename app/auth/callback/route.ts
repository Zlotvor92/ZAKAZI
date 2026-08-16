import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv, requireUrlEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/prijava?greska=1", request.nextUrl));
  }

  // Kolačići sesije se pišu direktno na odgovor koji nosi preusmeravanje.
  // Preko `cookies()` iz next/headers znaju da ne stignu na ručno napravljen
  // redirect, pa korisnik stigne na /dashboard bez sesije i biva vraćen
  // nazad — a osvežavanje strane onda „popravi" prijavu.
  const response = NextResponse.redirect(
    new URL("/dashboard", request.nextUrl),
  );

  const supabase = createServerClient(
    requireUrlEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error(
      `exchangeCodeForSession nije uspeo: ${error.message} (status ${error.status ?? "?"})`,
    );
    return NextResponse.redirect(new URL("/prijava?greska=1", request.nextUrl));
  }

  return response;
}
