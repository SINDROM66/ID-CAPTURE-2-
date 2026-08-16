import asyncio
import os
import sys
from playwright.async_api import async_playwright

async def run(playwright):
    browser = await playwright.chromium.launch(headless=True)
    page = await browser.new_page()

    page.on("console", lambda msg: print(f"[Browser Console] {msg.text}"))

    await page.goto("http://localhost:8093/index.html")

    # Unlock the app
    await page.fill("#pin-input", "SINDROM666")
    await page.click("#unlock-btn")
    await page.wait_for_selector("#card-barcode-upload:not(.hidden)", timeout=5000)

    images_to_test = [
        "Elvis_new.jpg",
        "mellisa_new.jpg",
        "samuel_front.jpg",
        "samuel_old.jpg",
        "timothy_front.jpg",
        "timothy_new.jpg"
    ]

    for img_name in images_to_test:
        print(f"\n======================================")
        print(f"Testing {img_name}")
        print(f"======================================")

        cwd = os.getcwd()
        img_path = os.path.join(cwd, "test_images", img_name)

        # ---------------------------
        # TEST AS FRONT SCAN
        # ---------------------------
        await page.click("#scan-side-front")
        await page.set_input_files("#input-gallery", img_path)

        try:
            await page.wait_for_function('''
                () => {
                    const formVisible = !document.getElementById('card-form').classList.contains('hidden');
                    const errorVisible = !document.getElementById('scanner-error').classList.contains('hidden');
                    return formVisible || errorVisible;
                }
            ''', timeout=90000)

            error_el = await page.query_selector("#scanner-error")
            is_error_hidden = await error_el.evaluate("el => el.classList.contains('hidden')")
            
            if not is_error_hidden:
                err_text = await error_el.inner_text()
                print(f"[FRONT TEST] {img_name} FAILED: {err_text}")
                front_success = False
            else:
                surname = await page.evaluate("document.getElementById('surname').value")
                givenName = await page.evaluate("document.getElementById('givenName').value")
                
                print(f"[FRONT TEST] {img_name} SUCCESS")
                print(f"  Surname:    {surname}")
                print(f"  Given Name: {givenName}")
                front_success = bool(surname or givenName)
                
        except Exception as e:
            print(f"[FRONT TEST] {img_name} TIMEOUT or EXCEPTION: {e}")
            front_success = False

        # Reset
        await page.evaluate("showScannerView()")
        await asyncio.sleep(0.5)

        # ---------------------------
        # TEST AS BACK SCAN
        # ---------------------------
        await page.click("#scan-side-back")
        await page.set_input_files("#input-gallery", img_path)

        try:
            await page.wait_for_function('''
                () => {
                    const formVisible = !document.getElementById('card-form').classList.contains('hidden');
                    const errorVisible = !document.getElementById('scanner-error').classList.contains('hidden');
                    return formVisible || errorVisible;
                }
            ''', timeout=90000)

            error_el = await page.query_selector("#scanner-error")
            is_error_hidden = await error_el.evaluate("el => el.classList.contains('hidden')")
            
            if not is_error_hidden:
                err_text = await error_el.inner_text()
                print(f"[BACK TEST] {img_name} FAILED: {err_text}")
            else:
                surname = await page.evaluate("document.getElementById('surname').value")
                givenName = await page.evaluate("document.getElementById('givenName').value")
                nin = await page.evaluate("document.getElementById('nin').value")
                
                print(f"[BACK TEST] {img_name} SUCCESS")
                print(f"  Surname:    {surname}")
                print(f"  Given Name: {givenName}")
                print(f"  NIN:        {nin}")
                
        except Exception as e:
            print(f"[BACK TEST] {img_name} TIMEOUT or EXCEPTION: {e}")

        # Reset for next image
        await page.evaluate("showScannerView()")
        await asyncio.sleep(0.5)

    await browser.close()

async def main():
    async with async_playwright() as playwright:
        await run(playwright)

if __name__ == "__main__":
    asyncio.run(main())
