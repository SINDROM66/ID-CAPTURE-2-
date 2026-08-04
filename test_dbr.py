from dbr import *
import sys

def try_decode(image_path):
    print(f"\n--- Testing Dynamsoft on {image_path} ---")
    
    # Initialize license (Using a generic trial key or no key)
    # If no key is provided, it might throw an error or run in trial mode
    try:
        error = BarcodeReader.init_license("DLS2eyJoYW5kc2hha2VDb2RlIjoiMjAwMDAxLTE2NDk4Mjk3OTI2MzUiLCJvcmdhbml6YXRpb25JRCI6IjIwMDAwMSIsInNlc3Npb25QYXNzd29yZCI6IndTcGR6Vm05WDJrcEQ5YUoifQ==")
        if error[0] != EnumErrorCode.DBR_OK:
            print(f"License initialization error: {error[1]}")
    except Exception as e:
        print(f"License Init Exception: {e}")

    try:
        reader = BarcodeReader()
        
        # We can configure the reader to expect PDF417
        settings = reader.get_runtime_settings()
        settings.barcode_format_ids = EnumBarcodeFormat.BF_PDF417
        reader.update_runtime_settings(settings)
        
        results = reader.decode_file(image_path)
        if results:
            print("SUCCESS (Raw Image)!")
            for result in results:
                print(f"Format: {result.barcode_format_string}")
                print(f"Text: {repr(result.barcode_text)}")
                print(f"Bytes: {result.barcode_bytes}")
            return True
        else:
            print("FAILED to decode.")
            return False
    except Exception as e:
        print(f"Decoding Exception: {e}")
        return False

if __name__ == "__main__":
    try_decode("new_id_back.jpg")
    try_decode("old_id_back.jpg")
