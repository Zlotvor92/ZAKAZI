import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv, requireUrlEnv } from "@/lib/env";

const SIGN_IN_PATH = "/prijava";
const HOME_PATH = "/";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  let authHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    requireUrlEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          authHeaders = headers;
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
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

  // Redirect je novi odgovor, pa kolačići koje je `getClaims` upravo osvežio ili
  // obrisao na `response` ne bi stigli do pregledača. Pregledač bi ostao sa
  // starim tokenima, a sledeći zahtev bi ponovo morao da ih osvežava — ili bi
  // osvežavanje palo, jer je stari refresh token već potrošen.
  function redirectTo(url: URL): NextResponse {
    const redirect = NextResponse.redirect(url);

    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    for (const [key, value] of Object.entries(authHeaders)) {
      redirect.headers.set(key, value);
    }

    return redirect;
  }

  const path = request.nextUrl.pathname;

  if (!signedIn && (path.startsWith("/dashboard") || path.startsWith("/admin"))) {
    const url = request.nextUrl.clone();
    url.pathname = SIGN_IN_PATH;
    return redirectTo(url);
  }

  // Početna strana postoji zbog posetioca koji ne zna šta je ovo. Vlasnici
  // koja je već prijavljena ne treba prodajni tekst nego njen dan, pa je
  // odavde skreće isto kao sa strane za prijavu.
  if (signedIn && (path === SIGN_IN_PATH || path === HOME_PATH)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return redirectTo(url);
  }

  return response;
}
