import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv, requireUrlEnv } from "@/lib/env";

/** Vrste linkova koje ova ruta sme da razmeni za sesiju. */
const OTP_TYPES = new Set<EmailOtpType>(["magiclink", "email", "recovery"]);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  // Provajder koji odbije prijavu (korisnik odustane na Google ekranu, nalog
  // ne postoji, provajder ugašen) vraća korisnika ovde sa `error` umesto sa
  // kodom. Bez ove grane on bi dobio istu poruku kao za istekao mejl link,
  // koja u tom slučaju nema smisla.
  const oauthError = params.get("error");
  if (oauthError) {
    console.error(
      `Prijava preko provajdera nije uspela: ${oauthError}` +
        ` (${params.get("error_description") ?? "bez opisa"})`,
    );
    return NextResponse.redirect(
      new URL("/prijava?greska=google", request.nextUrl),
    );
  }

  if (!code && !tokenHash) {
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

  // Dva oblika istog linka. `code` traži da je isti pregledač i započeo
  // prijavu, pa pukne kad mejl klijent otvori link unapred ili kad se link
  // otvori na drugom uređaju. `token_hash` nema tu pretpostavku.
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        type: OTP_TYPES.has(type as EmailOtpType)
          ? (type as EmailOtpType)
          : "magiclink",
        token_hash: tokenHash!,
      });

  if (error) {
    console.error(
      `Razmena linka za sesiju nije uspela: ${error.message} (status ${error.status ?? "?"})`,
    );
    return NextResponse.redirect(new URL("/prijava?greska=1", request.nextUrl));
  }

  return response;
}
