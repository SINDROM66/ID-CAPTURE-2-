from dbr import *
import cv2
import sys
import numpy as np

def try_decode(image_path):
    print(f"\n--- Testing Dynamsoft on {image_path} ---")
    
    try:
        error = BarcodeReader.init_license("DLS2eyJoYW5kc2hha2VDb2RlIjoiMjAwMDAxLTE2NDk4Mjk3OTI2MzUiLCJvcmdhbml6YXRpb25JRCI6IjIwMDAwMSIsInNlc3Npb25QYXNzd29yZCI6IndTcGR6Vm05WDJrcEQ5YUoifQ==")
    except Exception as e:
        pass

    reader = BarcodeReader()
    settings = reader.get_runtime_settings()
    settings.barcode_format_ids = EnumBarcodeFormat.BF_PDF417
    
    # Enable more aggressive reading
    settings.expected_barcodes_count = 1
    reader.update_runtime_settings(settings)
    
    # Try 1: Raw
    results = reader.decode_file(image_path)
    if results:
        print("SUCCESS (Raw Image)!")
        for result in results:
            print(f"Bytes: {result.barcode_bytes}")
        return True
        
    # Try 2: Grayscale + CLAHE
    print("Trying Grayscale + CLAHE...")
    img = cv2.imread(image_path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    cl1 = clahe.apply(gray)
    cv2.imwrite("temp_dbr.jpg", cl1)
    results = reader.decode_file("temp_dbr.jpg")
    if results:
        print("SUCCESS (CLAHE)!")
        for result in results:
            print(f"Bytes: {result.barcode_bytes}")
        return True
        
    # Try 3: Otsu Thresholding
    print("Trying Otsu Thresholding...")
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    cv2.imwrite("temp_dbr.jpg", thresh)
    results = reader.decode_file("temp_dbr.jpg")
    if results:
        print("SUCCESS (Otsu)!")
        for result in results:
            print(f"Bytes: {result.barcode_bytes}")
        return True
        
    # Try 4: Resizing (Scale up)
    print("Trying Resizing 2x...")
    resized = cv2.resize(gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    cv2.imwrite("temp_dbr.jpg", resized)
    results = reader.decode_file("temp_dbr.jpg")
    if results:
        print("SUCCESS (Resized 2x)!")
        for result in results:
            print(f"Bytes: {result.barcode_bytes}")
        return True
        
    print("FAILED on Dynamsoft even with preprocessing.")
    return False

if __name__ == "__main__":
    try_decode("old_id_back.jpg")
