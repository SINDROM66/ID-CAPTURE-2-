import cv2
from pyzbar.pyzbar import decode
from PIL import Image

def try_decode(image_path):
    print(f"\n--- Testing pyzbar on {image_path} ---")
    
    cv_img = cv2.imread(image_path)
    if cv_img is None:
        print("Failed to load image.")
        return
        
    # 1. Raw
    print("Method 1: Raw")
    decoded = decode(cv_img)
    if decoded:
        print("SUCCESS (Raw)!")
        print(decoded)
        return True
        
    # 2. Grayscale
    print("Method 2: Grayscale")
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
    decoded = decode(gray)
    if decoded:
        print("SUCCESS (Grayscale)!")
        print(decoded)
        return True

    # 3. Contrast adjustment (CLAHE)
    print("Method 3: CLAHE Contrast")
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    cl1 = clahe.apply(gray)
    decoded = decode(cl1)
    if decoded:
        print("SUCCESS (CLAHE)!")
        print(decoded)
        return True

    # 4. Otsu Threshold
    print("Method 4: Otsu Threshold")
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    decoded = decode(thresh)
    if decoded:
        print("SUCCESS (Otsu)!")
        print(decoded)
        return True
        
    # 5. Crop and Scale (approximate barcode location based on previous findings)
    # The barcode was at [232, 1719] to [2146, 2222] approximately in new_id_back
    print("Method 5: Crop and Scale")
    h, w = gray.shape
    if "new" in image_path.lower():
        cropped = gray[1700:2250, 200:2200]
    else:
        cropped = gray # old id needs dynamic or full
        
    # scale up
    if cropped.size > 0:
        scaled = cv2.resize(cropped, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
        _, thresh2 = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        decoded = decode(thresh2)
        if decoded:
            print("SUCCESS (Crop & Scale)!")
            print(decoded)
            return True
            
    print("FAILED on pyzbar.")
    return False

if __name__ == "__main__":
    try_decode("new_id_back.jpg")
    try_decode("old_id_back.jpg")
