// TLS ispred `next start` za iPhone (WebKit) prolaz.
//
// Produkcioni build postavlja kolačiće sa `Secure`. Chromium ih prima i preko
// `http://127.0.0.1`, WebKit ne — pa tok koji zavisi od kolačića (tajna termina)
// na njemu pada iako proizvod radi. Ovde se aplikacija otvara preko HTTPS-a, kao
// u produkciji.
//
// Proxy ujedno upisuje svoju adresu u `x-forwarded-for`: ograničenje od osam
// zakazivanja na sat po mreži tako ne deli korpu sa Android prolazom, koji
// dolazi bez te adrese.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TARGET_PORT = Number(process.env.TARGET_PORT ?? 3100);
const LISTEN_PORT = Number(process.env.LISTEN_PORT ?? 3101);
const CLIENT_ADDRESS = "10.0.0.2";

const dir = mkdtempSync(join(tmpdir(), "e2e-tls-"));
const keyFile = join(dir, "key.pem");
const certFile = join(dir, "cert.pem");

execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyFile,
    "-out",
    certFile,
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);

const server = https.createServer(
  { key: readFileSync(keyFile), cert: readFileSync(certFile) },
  (request, response) => {
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: TARGET_PORT,
        method: request.method,
        path: request.url,
        headers: {
          ...request.headers,
          "x-forwarded-for": CLIENT_ADDRESS,
          "x-forwarded-proto": "https",
        },
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );

    upstream.on("error", () => {
      response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  },
);

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  process.stdout.write(`TLS proxy na ${LISTEN_PORT} -> ${TARGET_PORT}\n`);
});
