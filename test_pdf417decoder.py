import cv2
from PIL import Image
from pdf417decoder import PDF417Decoder
import json

def try_decode(image_path):
    print(f"\n--- Testing {image_path} ---")
    
    # Method 1: Raw Image via PIL
    try:
        img = Image.open(image_path)
        decoder = PDF417Decoder(img)
        if decoder.decode() > 0:
            print("SUCCESS (Raw Image via PIL)!")
            for result in decoder.barcode_data_index_to_string.values():
                print(f"Decoded Text: {repr(result)}")
            return True
    except Exception as e:
        print(f"PIL Raw exception: {e}")

    # Method 2: OpenCV Preprocessed (Grayscale + Adaptive Threshold)
    try:
        cv_img = cv2.imread(image_path)
        gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
        
        # Try different thresholds
        for block_size in [11, 21, 31, 51]:
            thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block_size, 2)
            # Convert back to PIL for the decoder
            pil_thresh = Image.fromarray(thresh)
            decoder = PDF417Decoder(pil_thresh)
            if decoder.decode() > 0:
                print(f"SUCCESS (Adaptive Threshold {block_size})!")
                for result in decoder.barcode_data_index_to_string.values():
                    print(f"Decoded Text: {repr(result)}")
                return True
                
        # Try simple threshold
        _, thresh_simple = cv2.threshold(gray, 128, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        pil_simple = Image.fromarray(thresh_simple)
        decoder = PDF417Decoder(pil_simple)
        if decoder.decode() > 0:
            print("SUCCESS (Otsu Threshold)!")
            for result in decoder.barcode_data_index_to_string.values():
                print(f"Decoded Text: {repr(result)}")
            return True
            
    except Exception as e:
        print(f"OpenCV processing exception: {e}")
        
    print("FAILED on all pre-processing attempts.")
    return False

if __name__ == "__main__":
    try_decode("new_id_back.jpg")
    try_decode("old_id_back.jpg")
