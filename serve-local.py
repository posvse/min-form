"""Enkel lokal server för att testa Min Form.

Kör:  python serve-local.py [port]

Servern sätter rätt MIME-typer (.webmanifest, .webp, .js) och skickar inte cache-headers
som stör service workern. Den använder vanlig HTTP, vilket räcker för http://localhost på
den här datorn. En iPhone kräver HTTPS för service worker och installation, så publicera
mappen på en statisk HTTPS-värd (t.ex. GitHub Pages) eller kör en HTTPS-tunnel mot denna port.
"""
import http.server
import socket
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".webp": "image/webp",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    print(f"Min Form: http://localhost:{PORT}/   (nätverk: http://{lan_ip()}:{PORT}/)")
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
