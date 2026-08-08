import asyncio
import http.server
import socketserver
import threading
from playwright.async_api import async_playwright
import os
import time

PORT = 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass # Suppress logs

def start_server():
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()

async def run():
    print("Starting local HTTP server...")
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # Wait for server to start
    time.sleep(1)
    
    images = [
        "test_images/samuel_old.jpg",
        "test_images/mellisa_new.jpg",
        "test_images/timothy_new.jpg",
        "test_images/Elvis_new.jpg"
    ]
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        for img_path in images:
            if not os.path.exists(img_path):
                print(f"Error: {img_path} not found.")
                continue
                
            print(f"\n==============================================")
            print(f"TESTING IMAGE: {img_path}")
            print(f"==============================================")
            
            await page.goto(f"http://localhost:{PORT}/index.html")
            
            # The app shows a lock screen first. Need to bypass it.
            # wait for #pin-input
            await page.fill("#pin-input", "0000") # Assume 0000 or anything if no actual auth is strictly enforced? Wait, I'll bypass by injecting JS.
            await page.evaluate("document.getElementById('lock-screen').classList.add('hidden');")
            await page.evaluate("document.getElementById('main-app').classList.remove('app-blurred');")
            
            # Set the file input
            file_input = page.locator("#input-gallery")
            await file_input.set_input_files(img_path)
            
            # Wait for preview to show
            await page.wait_for_selector("#image-preview", state="visible")
            
            # Click Extract Data
            await page.click("#extract-btn")
            
            # Wait for OCR to finish (either success form or error shows)
            print("Waiting for Tesseract to finish...")
            try:
                # wait until progress card is hidden again
                await page.wait_for_selector("#card-progress.hidden", timeout=45000)
            except Exception as e:
                print("Timeout waiting for OCR!")
            
            # Grab the dev console output
            console_text = await page.evaluate("document.getElementById('dev-console').innerText")
            
            print("--- CONSOLE OUTPUT ---")
            print(console_text)
            
            # Check results
            surname = await page.evaluate("document.getElementById('surname').value")
            givenName = await page.evaluate("document.getElementById('givenName').value")
            dob = await page.evaluate("document.getElementById('dob').value")
            
            print("--- PARSED FIELDS ---")
            print(f"Surname: {surname}")
            print(f"Given Name: {givenName}")
            print(f"DOB: {dob}")
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
