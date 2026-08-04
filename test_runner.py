import http.server
import socketserver
import json
import threading
import subprocess
import time
import os

PORT = 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/submit':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            print("=== TEST RESULTS ===")
            print(json.dumps(data, indent=4))
            print("====================")
            
            with open('results.json', 'w') as f:
                json.dump(data, f, indent=4)
            
            self.send_response(200)
            self.end_headers()
            
            # Shutdown server after receiving
            threading.Thread(target=self.server.shutdown).start()

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving at port {PORT}")
    
    # Run headless edge
    edge_cmd = [
        "cmd", "/c", "start", "msedge", "--headless", "--disable-gpu", 
        f"http://localhost:{PORT}/test_zxing_pdf417_alt.html"
    ]
    subprocess.Popen(edge_cmd)
    
    httpd.serve_forever()
    print("Server stopped.")
