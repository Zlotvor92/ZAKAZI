import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv, requireUrlEnv } from "@/lib/env";

const SIGN_IN_PATH = "/prijava";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    requireUrlEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Potpis tokena se proverava ovde, javnim ključem projekta, umesto da se za
  // svaki zahtev pita Supabase da li token važi. Provera je jednako stroga —
  // isti ES256 potpis, samo bez odlaska na mrežu, a ključ se dovlači jednom pa
  // stoji u kešu. Kolačiću se i dalje ne veruje na reč.
  //
  // Cena je što opozvana sesija ostaje važeća do isteka tokena, najviše sat
  // vremena. Ako projekat ikad pređe na simetričan ključ, biblioteka sama pada
  // nazad na `getUser`, pa ova zamena ne može tiho da propusti nevažeći token.
  const { data } = await supabase.auth.getClaims();
  const signedIn = data?.claims != null;

  const path = request.nextUrl.pathname;

  if (!signedIn && (path.startsWith("/dashboard") || path.startsWith("/admin"))) {
    const url = request.nextUrl.clone();
    url.pathname = SIGN_IN_PATH;
    return NextResponse.redirect(url);
  }

  if (signedIn && path === SIGN_IN_PATH) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
