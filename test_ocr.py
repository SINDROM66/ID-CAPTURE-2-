import asyncio
from playwright.async_api import async_playwright
import sys
import os

async def run_test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # We need to serve the local directory or just load the file:// URI
        cwd = os.getcwd()
        file_url = f"file:///{cwd.replace(chr(92), '/')}/index.html"
        
        # Hook console logs
        page.on("console", lambda msg: print(f"[Browser]: {msg.text}") if "RAW OCR TEXT" in msg.text or "Starting" in msg.text or "Pass" in msg.text else None)
        
        await page.goto(file_url)
        
        # Unlock the app
        await page.fill("#pin-input", "SINDROM666")
        await page.click("#unlock-btn")
        await page.wait_for_selector("#card-barcode-upload:not(.hidden)", timeout=5000)
        
        test_images = ["samuel_old.jpg", "timothy_new.jpg", "mellisa_new.jpg"]
        
        for img_name in test_images:
            print(f"\n======================================")
            print(f"TESTING IMAGE: {img_name}")
            print(f"======================================")
            img_path = os.path.join(cwd, "test_images", img_name)
            
            # Upload image
            await page.set_input_files("#input-gallery", img_path)
            
            # Click extract
            await page.wait_for_selector("#extract-btn:not([disabled])", timeout=5000)
            await page.click("#extract-btn")
            
            # Wait for either success (card-form) or failure (scanner-error)
            try:
                # Wait for form to appear
                await page.wait_for_selector("#card-form:not(.hidden)", timeout=30000)
                
                # Extract the parsed values
                surname = await page.input_value("#surname")
                given_name = await page.input_value("#givenName")
                dob = await page.input_value("#dob")
                nin = await page.input_value("#nin")
                sex = await page.evaluate("document.getElementById('sex').value")
                
                print(f"[SUCCESS] Parsed Record for {img_name}:")
                print(f"  Surname: {surname}")
                print(f"  Given Name: {given_name}")
                print(f"  DOB: {dob}")
                print(f"  NIN: {nin}")
                print(f"  Sex: {sex}")
                
                # Screenshot the result page
                screenshot_path = os.path.join(cwd, f"result_{img_name}.png")
                await page.screenshot(path=screenshot_path, full_page=True)
                print(f"[SCREENSHOT] Saved to {screenshot_path}")
                
                # Reset for next test
                await page.click("#discard-btn")
                
            except Exception as e:
                # Check for error
                try:
                    error_text = await page.text_content("#scanner-error")
                    print(f"[FAILED] OCR failed for {img_name}: {error_text}")
                except:
                    print(f"[FAILED] Timed out waiting for OCR on {img_name}")
                    
                # Force reset via DOM
                await page.evaluate("resetScanner()")
                await page.evaluate("showScannerView()")
                
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_test())
