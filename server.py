#!/usr/bin/env python3
"""Servidor estático para la demo VR 3D."""
import http.server
import socketserver
import os
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

Handler = http.server.SimpleHTTPRequestHandler

with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
    print(f"Sirviendo VR-3d-demo en http://localhost:{PORT}  (Ctrl+C para detener)")
    httpd.serve_forever()