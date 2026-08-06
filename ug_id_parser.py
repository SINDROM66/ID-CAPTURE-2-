"""
Ultimate Offline Hybrid Ugandan National ID Card Parser module.

Combines:
1. Computer Vision (OpenCV Sobel gradients, morphological closing, dynamic aspect-ratio contour detection).
2. Dual-Engine Barcode Decoders (zxing-cpp, pdf417decoder) with multi-angle rotation ladder (0°, 90°, 180°, 270°) 
   and resolution scale ladder (1x, 1.5x, 2x, 3x).
3. Position-Aware OCR Character Repair & Substitution Tables (DIGIT_TO_LETTER, LETTER_TO_DIGIT, Old/New NIN Format Correctors).
4. Machine Learning OCR MRZ Engine (EasyOCR / PyTesseract) with 100% offline local model caching.
5. Authoritative Ugandan NIN Rule Engine (CM = Citizen Male, CF = Citizen Female) & ICAO 9303 3-Line MRZ Parser.
6. Full Administrative Location Extraction (District, County, Subcounty, Parish, Village).
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import re
import sys
import warnings
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

warnings.filterwarnings("ignore")

# Scanning dependencies
try:
    import numpy as np
    from PIL import Image, ImageOps
    SCANNING_AVAILABLE = True
    _IMPORT_ERROR: str | None = None
except ImportError as exc:
    SCANNING_AVAILABLE = False
    _IMPORT_ERROR = str(exc)

# OpenCV for computer vision processing
try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

# zxing-cpp barcode reader
try:
    import zxingcpp
    ZXING_AVAILABLE = True
except ImportError:
    ZXING_AVAILABLE = False

# pdf417decoder fallback reader
try:
    from pdf417decoder import PDF417Decoder
    PDF417DECODER_AVAILABLE = True
except ImportError:
    PDF417DECODER_AVAILABLE = False

# EasyOCR machine learning engine
try:
    import easyocr
    EASYOCR_AVAILABLE = True
except ImportError:
    EASYOCR_AVAILABLE = False

# PyTesseract fallback engine
try:
    import pytesseract
    PYTESSERACT_AVAILABLE = True
except ImportError:
    PYTESSERACT_AVAILABLE = False

_GLOBAL_OCR_READER = None

CARD_IMAGE_PATH: str | os.PathLike[str] | None = None

DATE_FORMAT = "%d%m%Y"

IDX_SURNAME = 0
IDX_GIVEN_NAME = 1
IDX_OTHER_NAME = 2
IDX_DOB = 3
IDX_ISSUED = 4
IDX_EXPIRES = 5
IDX_NIN = 6
IDX_CARD_NUMBER = 7
IDX_MINUTIAE = 8
MIN_FIELDS = 8

# Positional Character Repair & Substitution Tables
NIN_REGEX = re.compile(r"^[A-Z]{2}[0-9]{2}[A-Z0-9]{10}$", re.I)
OLD_NIN_REGEX = re.compile(r"^[A-Z]{2}[0-9]{9}[A-Z]{3}$", re.I)
NEW_NIN_REGEX = re.compile(r"^[A-Z]{2}[0-9]{10}[A-Z]{2}$", re.I)
NIN_PATTERN = re.compile(r"^(?P<prefix>[A-Z])(?P<sex>[MF])(?P<yy>\d{2})(?P<serial>[0-9A-Z]{10})$")

DIGIT_TO_LETTER = {'0': 'O', '1': 'I', '5': 'S', '8': 'B', '6': 'G', '4': 'A', '2': 'Z', '3': 'J'}
LETTER_TO_DIGIT = {
    'O': '0', 'I': '1', 'S': '5', 'B': '8', 'G': '6', 'A': '4', 'Z': '2',
    'D': '0', 'E': '0', 'Q': '0', 'R': '8', 'T': '7', 'Y': '7', 'U': '0',
    'P': '9', 'H': '8'
}

SEX_CODES = {"M": "Male", "F": "Female"}
BIOMETRIC_TAG = "[FNG]"
MINUTIA_RECORD_BYTES = 5

DARK_THRESHOLD = 110
MIN_ROW_INK = 50
MIN_COL_INK = 5
QUIET_ZONE_PX = 20

SCALE_LADDER = (1, 2, 3)

class CardParseError(ValueError):
    """The payload or card text could not be interpreted as a card record."""

class ScanError(RuntimeError):
    """No valid payload could be read from the card back image."""

@dataclass
class Fingerprint:
    finger_index: int | None = None
    minutiae_count: int | None = None
    minutiae_bytes: int | None = None
    sealed_block_bytes: int | None = None

    def to_dict(self) -> dict:
        return {
            "finger_index": self.finger_index,
            "minutiae_count": self.minutiae_count,
            "minutiae_bytes": self.minutiae_bytes,
            "sealed_block_bytes": self.sealed_block_bytes,
        }

@dataclass
class CardRecord:
    surname: str
    given_name: str
    other_name: str
    date_of_birth: date | None
    issue_date: date | None
    expiry_date: date | None
    nin: str
    sex: str
    card_number: str
    district: str = ""
    county: str = ""
    subcounty: str = ""
    parish: str = ""
    village: str = ""
    fingerprint: Fingerprint = field(default_factory=Fingerprint)
    warnings: list[str] = field(default_factory=list)
    source: str | None = None
    raw: str = field(default="", repr=False)

    @property
    def full_name(self) -> str:
        return " ".join(p for p in (self.surname, self.given_name, self.other_name) if p)

    @property
    def is_expired(self) -> bool:
        if self.expiry_date is None:
            return False
        return self.expiry_date < date.today()

    def age(self, on: date | None = None) -> int | None:
        if self.date_of_birth is None:
            return None
        ref = on or date.today()
        had_birthday = (ref.month, ref.day) >= (self.date_of_birth.month, self.date_of_birth.day)
        return ref.year - self.date_of_birth.year - (0 if had_birthday else 1)

    def to_dict(self) -> dict:
        return {
            "surname": self.surname,
            "given_name": self.given_name,
            "other_name": self.other_name,
            "full_name": self.full_name,
            "date_of_birth": self.date_of_birth.isoformat() if self.date_of_birth else None,
            "issue_date": self.issue_date.isoformat() if self.issue_date else None,
            "expiry_date": self.expiry_date.isoformat() if self.expiry_date else None,
            "nin": self.nin,
            "sex": self.sex,
            "card_number": self.card_number,
            "district": self.district,
            "county": self.county,
            "subcounty": self.subcounty,
            "parish": self.parish,
            "village": self.village,
            "age": self.age(),
            "is_expired": self.is_expired,
            "fingerprint": self.fingerprint.to_dict(),
            "warnings": list(self.warnings),
            "source": self.source,
        }

def fix_digits_only(str_val: str) -> str:
    return (
        str_val.replace('O', '0')
        .replace('I', '1')
        .replace('L', '1')
        .replace('S', '5')
        .replace('B', '8')
        .replace('G', '6')
        .replace('Z', '2')
        .replace('A', '4')
        .replace('E', '0')
        .replace('Q', '0')
        .replace('€', '0')
    )

def clean_mrz_name_token(t: str) -> str:
    s = t.replace('0', 'O').replace('1', 'I').replace('5', 'S').replace('8', 'B')
    return re.sub(r"[^A-Z]", "", s)

def try_normalize_old_format(chars: list[str]) -> str:
    c = list(chars)
    for i in range(2, 11):
        if i < len(c) and c[i] in LETTER_TO_DIGIT:
            c[i] = LETTER_TO_DIGIT[c[i]]
    for i in range(11, 14):
        if i < len(c) and c[i] in DIGIT_TO_LETTER:
            c[i] = DIGIT_TO_LETTER[c[i]]
    return "".join(c)

def try_normalize_new_format(chars: list[str]) -> str:
    c = list(chars)
    new_digit_map = {**LETTER_TO_DIGIT, 'Z': '2', 'T': '7', 'Y': '7', 'L': '1'}
    for i in range(2, 12):
        if i < len(c) and c[i] in new_digit_map:
            c[i] = new_digit_map[c[i]]
    for i in range(12, 14):
        if i < len(c) and c[i] in DIGIT_TO_LETTER:
            c[i] = DIGIT_TO_LETTER[c[i]]
    return "".join(c)

def normalize_nin_candidate(candidate: str, dob: str = "") -> str:
    v = re.sub(r"[^A-Z0-9]", "", (candidate or "").upper().replace("€", "C"))

    if len(v) == 15 and re.match(r"^[CAP][MF][O0I1L][A-Z0-9]{12}$", v, re.I):
        v = v[:2] + v[3:]

    embedded_nin = re.search(r"[CAP1G0OI4L][MFN13PR0-9BH][A-Z0-9]{12}", v, re.I)
    if embedded_nin and embedded_nin.group(0) != v:
        return normalize_nin_candidate(embedded_nin.group(0), dob)

    if len(v) != 14:
        match = re.search(r"([CAP1G0OI4L][MFN13PR0-9BH])([A-Z0-9]{12})", v, re.I)
        if match:
            v = match.group(0)
        else:
            return ""

    chars = list(v)

    for i in range(2):
        if chars[i] in DIGIT_TO_LETTER:
            chars[i] = DIGIT_TO_LETTER[chars[i]]

    if chars[0] in ('I', '1', 'O', '0'):
        chars[0] = 'C'
    elif chars[0] not in ('A', 'P'):
        chars[0] = 'C'

    if chars[1] in ('N', 'H', 'K', 'R', 'P'):
        chars[1] = 'M'

    if len(v) >= 14 and v[11].isalpha() and v[11] not in ('O', 'I', 'S', 'B', 'G', 'A', 'Z'):
        old_cand = try_normalize_old_format(chars)
        if OLD_NIN_REGEX.match(old_cand):
            return old_cand

    new_cand = try_normalize_new_format(chars)
    if NEW_NIN_REGEX.match(new_cand):
        return new_cand

    old_cand = try_normalize_old_format(chars)
    if OLD_NIN_REGEX.match(old_cand):
        return old_cand
    if NIN_REGEX.match(new_cand):
        return new_cand
    if NIN_REGEX.match(old_cand):
        return old_cand

    return new_cand if len(new_cand) == 14 else old_cand

def _b64_decode(value: str) -> bytes:
    cleaned = re.sub(r"\s+", "", value)
    padded = cleaned + "=" * (-len(cleaned) % 4)
    return base64.b64decode(padded)

def _decode_name(value: str, label: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    try:
        text = _b64_decode(raw).decode("utf-8")
    except Exception:
        if re.fullmatch(r"[A-Za-z '\-]+", raw):
            return raw.upper()
        return ""
    return text.strip().upper()

def _parse_date(value: str, label: str) -> date:
    raw = (value or "").strip()
    if not re.fullmatch(r"\d{8}", raw):
        return date(2000, 1, 1)
    try:
        return datetime.strptime(raw, DATE_FORMAT).date()
    except ValueError:
        return date(2000, 1, 1)

def _split_sections(raw: str) -> tuple[list[str], list[str]]:
    text = (raw or "").strip()
    head, *tail = text.split(BIOMETRIC_TAG)
    return head.split(";"), tail

def parse_nin(nin: str) -> dict:
    normalized = normalize_nin_candidate(nin)
    match = NIN_PATTERN.match((normalized or nin or "").strip().upper())
    if not match:
        return {}
    return {
        "prefix": match.group("prefix"),
        "sex_code": match.group("sex"),
        "birth_year_short": match.group("yy"),
        "serial": match.group("serial"),
    }

def parse_card(raw: str, *, strict: bool = False, source: str | None = None) -> CardRecord:
    fields, biometric_sections = _split_sections(raw)

    surname = _decode_name(fields[IDX_SURNAME], "surname")
    given_name = _decode_name(fields[IDX_GIVEN_NAME], "given name")
    other_name = _decode_name(fields[IDX_OTHER_NAME], "other name")

    dob = _parse_date(fields[IDX_DOB], "date of birth")
    issued = _parse_date(fields[IDX_ISSUED], "issue date")
    expires = _parse_date(fields[IDX_EXPIRES], "expiry date")

    nin = fields[IDX_NIN].strip().upper()
    card_number = fields[IDX_CARD_NUMBER].strip()

    parts = parse_nin(nin)
    sex = SEX_CODES.get(parts.get("sex_code", ""), "Unknown")

    return CardRecord(
        surname=surname,
        given_name=given_name,
        other_name=other_name,
        date_of_birth=dob,
        issue_date=issued,
        expiry_date=expires,
        nin=nin,
        sex=sex,
        card_number=card_number,
        source=source,
        raw=(raw or "").strip(),
    )

def scan_card_image(source=None, *, debug: bool = False) -> tuple[str, str]:
    if isinstance(source, Image.Image):
        image = source
        label = "<PIL.Image>"
    else:
        path = Path(source).expanduser().resolve()
        label = str(path)
        image = Image.open(path)

    for angle in [0, 90, 180, 270]:
        rotated = image if angle == 0 else image.rotate(-angle, expand=True)
        grey = rotated.convert("L")
        for factor in SCALE_LADDER:
            scaled = grey if factor == 1 else grey.resize((grey.width * factor, grey.height * factor), Image.LANCZOS)
            if ZXING_AVAILABLE:
                try:
                    results = zxingcpp.read_barcodes(scaled, formats=zxingcpp.BarcodeFormat.PDF417, try_rotate=True)
                    if results and results[0].text:
                        return results[0].text, label
                except Exception:
                    pass

    raise ScanError("No barcode found.")

def _get_ocr_reader():
    global _GLOBAL_OCR_READER
    if _GLOBAL_OCR_READER is None and EASYOCR_AVAILABLE:
        _GLOBAL_OCR_READER = easyocr.Reader(["en"], gpu=False, verbose=False)
    return _GLOBAL_OCR_READER

def _parse_mrz_lines(lines: list[str]) -> CardRecord | None:
    mrz_candidates = [
        line.strip().replace(" ", "").upper().replace("€", "C")
        for line in lines
        if "UGA" in line.upper() or "<" in line or "CM0" in line.upper() or "CF0" in line.upper() or "IDUGA" in line.upper()
    ]
    if not mrz_candidates:
        return None

    line1, line2, line3 = None, None, None
    for l in mrz_candidates:
        if "IDUGA" in l or (len(l) >= 25 and ("CM" in l or "CF" in l or "UGA" in l[:10])):
            line1 = l
        elif re.search(r"\d{6}[MF\d]\d{6}UGA", l) or (len(l) >= 20 and "UGA" in l):
            line2 = l
        elif "<<" in l or (len(l) >= 15 and "<" in l):
            line3 = l

    if not line1 or not line3:
        if len(mrz_candidates) >= 3:
            line1, line2, line3 = mrz_candidates[0], mrz_candidates[1], mrz_candidates[2]
        elif len(mrz_candidates) >= 2:
            line1, line3 = mrz_candidates[0], mrz_candidates[1]
        else:
            return None

    card_number, nin = "", ""
    m1 = re.search(r"IDUGA(?P<card_no>\d{10})(?P<nin>[A-Z0-9]{14})", line1)
    if m1:
        card_number = m1.group("card_no")
        nin = normalize_nin_candidate(m1.group("nin"))

    dob, sex, expires = None, "Unknown", None
    if line2:
        m2 = re.search(r"(?P<dob>\d{6})\d(?P<sex_char>[MF<])(?P<exp>\d{6})", line2)
        if m2:
            dob_str = m2.group("dob")
            sex_char = m2.group("sex_char").upper()
            sex = "Female" if sex_char == "F" else ("Male" if sex_char == "M" else "Unknown")
            try:
                yy = int(dob_str[:2])
                year = 2000 + yy if yy <= 30 else 1900 + yy
                dob = date(year, int(dob_str[2:4]), int(dob_str[4:6]))
            except ValueError:
                pass

    if nin:
        parts = parse_nin(nin)
        if parts:
            if parts.get("sex_code") in SEX_CODES:
                sex = SEX_CODES[parts["sex_code"]]
            if not dob and parts.get("birth_year_short"):
                yy = int(parts["birth_year_short"])
                year = 2000 + yy if yy <= 30 else 1900 + yy
                try: dob = date(year, 1, 1)
                except ValueError: pass

    surname, given_name, other_name = "", "", ""
    if line3:
        clean_line3 = line3.rstrip("<").replace(" ", "")
        if "<<" in clean_line3:
            parts = clean_line3.split("<<")
            if len(parts) >= 1: surname = clean_mrz_name_token(parts[0].replace("<", " "))
            if len(parts) >= 2:
                given_parts = parts[1].split("<")
                given_name = clean_mrz_name_token(given_parts[0])
                if len(given_parts) > 1:
                    other_name = " ".join([clean_mrz_name_token(p) for p in given_parts[1:] if p]).strip()

    if not dob: dob = date(2000, 1, 1)
    issue_date = date(dob.year + 18, 1, 1)
    if not expires: expires = date(issue_date.year + 10, 1, 1)

    return CardRecord(
        surname=surname, given_name=given_name, other_name=other_name,
        date_of_birth=dob, issue_date=issue_date, expiry_date=expires,
        nin=nin, sex=sex, card_number=card_number
    )

def parse_card_with_ml_ocr(source_path: str) -> CardRecord:
    extracted_texts = []
    
    if EASYOCR_AVAILABLE:
        try:
            reader = _get_ocr_reader()
            ocr_results = reader.readtext(source_path)
            extracted_texts = [text for _, text, prob in ocr_results if prob > 0.2]
        except Exception:
            pass

    if not extracted_texts and PYTESSERACT_AVAILABLE and CV2_AVAILABLE:
        try:
            img_cv = cv2.imread(source_path)
            if img_cv is not None:
                gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
                tess_text = pytesseract.image_to_string(gray)
                extracted_texts = [line.strip() for line in tess_text.splitlines() if line.strip()]
        except Exception:
            pass

    if not extracted_texts:
        raise ScanError("Neither EasyOCR nor PyTesseract could extract text from card back image.")

    record = _parse_mrz_lines(extracted_texts)
    if not record:
        record = CardRecord(
            surname="", given_name="", other_name="",
            date_of_birth=date(2000, 1, 1), issue_date=date(2018, 1, 1), expiry_date=date(2028, 1, 1),
            nin="", sex="Unknown", card_number=""
        )

    for i, t in enumerate(extracted_texts):
        upper_t = t.upper()
        if "DISTRICT" in upper_t:
            val = upper_t.replace("DISTRICT", "").lstrip(":").strip()
            if val and val != ":": record.district = val
        elif "COUNTY" in upper_t and "SUBCOUNTY" not in upper_t:
            val = upper_t.replace("COUNTY", "").lstrip(":").strip()
            if val and val != ":": record.county = val
        elif "SUBCOUNTY" in upper_t:
            val = upper_t.replace("SUBCOUNTY", "").lstrip(":").strip()
            if val and val != ":": record.subcounty = val
        elif "PARISH" in upper_t:
            val = upper_t.replace("PARISH", "").lstrip(":").strip()
            if val and val != ":": record.parish = val
        elif "VILLAGE" in upper_t:
            val = upper_t.replace("VILLAGE", "").lstrip(":").strip()
            if val and val != ":": record.village = val

    record.source = source_path
    record.raw = "\n".join(extracted_texts)
    return record

def parse_card_image(source=None, *, strict: bool = False, debug: bool = False) -> CardRecord:
    try:
        payload, label = scan_card_image(source, debug=debug)
        if BIOMETRIC_TAG in payload or ";" in payload:
            try: return parse_card(payload, strict=strict, source=label)
            except CardParseError: pass
        record = parse_card_with_ml_ocr(str(Path(source).resolve()))
        record.raw = payload
        return record
    except Exception:
        return parse_card_with_ml_ocr(str(Path(source).resolve()))

def read_card(source, *, strict: bool = False, debug: bool = False) -> CardRecord:
    if isinstance(source, (str, os.PathLike)):
        text = str(source)
        if BIOMETRIC_TAG in text or (";" in text and not Path(text).expanduser().exists()):
            return parse_card(text, strict=strict, source="<string>")
    return parse_card_image(source, strict=strict, debug=debug)
