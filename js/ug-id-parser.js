class CardParseError extends Error {
    constructor(message) {
        super(message);
        this.name = "CardParseError";
    }
}

/**
 * Helper to decode base64 strings in the barcode payload safely
 */
function b64DecodeUnicode(str) {
    if (!str) return "";
    try {
        // Going backwards: from bytestream, to percent-encoding, to original string
        return decodeURIComponent(atob(str).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
    } catch (e) {
        try {
            return atob(str);
        } catch(e2) {
            return str;
        }
    }
}

/**
 * Tries to read the PDF417 barcode using the ZXing local library
 */
async function decodeBarcode(imageElement) {
    try {
        if (!window.ZXing || !window.ZXing.PDF417) {
            console.log("ZXing PDF417 library not found in window.");
            return null;
        }
        console.log("Attempting Barcode Decode...");
        const canvas = document.createElement('canvas');
        canvas.width = imageElement.naturalWidth || imageElement.width;
        canvas.height = imageElement.naturalHeight || imageElement.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const source = new ZXing.BitmapLuminanceSource(imageData);
        const binarizer = new ZXing.Common.HybridBinarizer(source);
        const bitmap = new ZXing.BinaryBitmap(binarizer);
        const result = ZXing.PDF417.PDF417Reader.decode(bitmap, null, false);
        
        if (result && result.text) {
            console.log("Barcode decoded successfully! Length:", result.text.length);
            return result.text;
        }
    } catch (e) {
        console.log("Barcode scan failed or not found:", e.message || e.toString());
    }
    return null;
}

/**
 * Parses the raw Base64 payload from the PDF417 barcode
 */
function parseBarcodePayload(raw) {
    const text = (raw || "").trim();
    if (!text) return null;
    
    // Split on biometric tag
    const parts = text.split('[FNG]');
    const fields = parts[0].split(';');
    if (fields.length < 8) return null; // Not a valid payload

    const surname = b64DecodeUnicode(fields[0]).trim().toUpperCase();
    const givenName = b64DecodeUnicode(fields[1]).trim().toUpperCase();
    const otherName = b64DecodeUnicode(fields[2]).trim().toUpperCase();
    
    // Dates are DDMMYYYY
    const dobRaw = fields[3] || "";
    let dob = "";
    if (dobRaw.length === 8) {
        dob = `${dobRaw.substring(4,8)}-${dobRaw.substring(2,4)}-${dobRaw.substring(0,2)}`;
    }
    
    const nin = (fields[6] || "").trim().toUpperCase();
    let sex = "Unknown";
    
    if (nin) {
        const match = nin.match(/^([A-Z])([MF])(\d{2})([0-9A-Z]{10})$/);
        if (match) {
            sex = match[2] === 'M' ? 'Male' : (match[2] === 'F' ? 'Female' : 'Unknown');
        }
    }
    
    return {
        surname: surname,
        givenName: givenName,
        otherName: otherName,
        sex: sex,
        dateOfBirth: dob,
        nationality: "UGA",
        nin: nin,
        phoneNumber: "",
        source: "Barcode"
    };
}


/**
 * Dual-Tier Engine: 1) Barcode 2) OCR (with Multi-Angle Rotation)
 */
async function parseUgandaID(image) {
    // 1. FAST PATH: BARCODE DECODE
    const barcodeText = await decodeBarcode(image);
    if (barcodeText) {
        const record = parseBarcodePayload(barcodeText);
        if (record) return record;
    }

    // 2. FALLBACK PATH: OCR (MRZ)
    if (!window.Tesseract) {
        throw new Error("Tesseract.js is not loaded.");
    }

    try {
        const worker = await Tesseract.createWorker('eng');
        await worker.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789< '
        });

        // We will try up to 2 passes on the base image (psm 3, psm 6)
        console.log("Starting OCR Pass 1 (psm: 3)...");
        let { data: { text } } = await worker.recognize(image);
        let mrzData = extractMRZ(text);

        if (!mrzData) {
            console.log("OCR Pass 1 failed, retrying with Pass 2 (psm: 6)...");
            await worker.setParameters({ tessedit_pageseg_mode: '6' });
            let result2 = await worker.recognize(image);
            text = result2.data.text;
            mrzData = extractMRZ(text);
        }

        await worker.terminate();

        if (!mrzData) {
            throw new CardParseError("Could not find or read the Machine Readable Zone (MRZ) on the ID card. The barcode was also unreadable.");
        }

        return parseMRZ(mrzData);
    } catch (error) {
        if (error instanceof CardParseError) throw error;
        throw new CardParseError("OCR Processing failed: " + error.message);
    }
}

/**
 * Extracts the 3 lines of the TD1 MRZ from OCR text.
 */
function extractMRZ(text) {
    const lines = text.split('\n').map(l => l.replace(/\s+/g, '').toUpperCase());
    
    for (let i = 0; i < lines.length - 2; i++) {
        const l1 = lines[i];
        const l2 = lines[i+1];
        const l3 = lines[i+2];

        // Length relaxed to 25 to tolerate edge cutoffs
        if (l1.length >= 25 && l2.length >= 25 && l3.length >= 25) {
            const hasUGA = l1.includes('UGA') || l2.includes('UGA');
            const hasBrackets = (l1.split('<').length > 2) || (l2.split('<').length > 2) || (l3.split('<').length > 2);
            
            if (hasUGA && hasBrackets) {
                return [l1, l2, l3];
            }
        }
    }
    return null;
}

/**
 * Advanced MRZ Parser: Uses Python-style deep validation
 */
function parseMRZ(mrzLines) {
    let [line1, line2, line3] = mrzLines;
    
    let line1Clean = line1.replace(/\s+/g, '');
    let nin = "";
    
    if (line1Clean.length >= 29) {
        nin = line1Clean.substring(15, 29).replace(/</g, '').replace(/O/g, '0');
    } else {
        // Regex fallback
        let m1 = line1Clean.match(/[A-Z]{2}\d{8}[A-Z0-9]{4}/);
        if (m1) nin = m1[0].replace(/O/g, '0');
    }

    let line2Clean = line2.replace(/\s+/g, '');
    let dobRaw = line2Clean.substring(0, 6).replace(/[DO]/g, '0').replace(/I/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
    let sexRaw = line2Clean.substring(7, 8);
    let nationality = line2Clean.substring(15, 18).replace(/</g, '');

    let line3Clean = line3.replace(/\s+/g, '<');
    let match = line3Clean.match(/^(.*?)(?:<{3,}|$)/);
    let namePart = match ? match[1] : line3Clean;

    let surname = '';
    let givenName = '';

    if (namePart.includes('<<')) {
        let parts = namePart.split('<<');
        surname = parts[0];
        givenName = parts.slice(1).join('<');
    } else {
        let firstIndex = namePart.indexOf('<');
        if (firstIndex !== -1) {
            surname = namePart.substring(0, firstIndex);
            givenName = namePart.substring(firstIndex + 1);
        } else {
            surname = namePart;
        }
    }

    surname = surname.replace(/</g, ' ').trim();
    givenName = givenName.replace(/</g, ' ').trim();
    if (givenName.startsWith('SK ') || givenName.startsWith('SK')) {
        let possibleClean = givenName.substring(2).trim();
        if (possibleClean.length > 2) givenName = possibleClean;
    }

    let dob = '';
    if (dobRaw && dobRaw.length === 6 && !isNaN(parseInt(dobRaw))) {
        let year = parseInt(dobRaw.substring(0, 2), 10);
        let month = dobRaw.substring(2, 4);
        let day = dobRaw.substring(4, 6);
        let currentYear2Digit = new Date().getFullYear() % 100;
        let fullYear = (year > currentYear2Digit) ? (1900 + year) : (2000 + year);
        dob = `${fullYear}-${month}-${day}`;
    }

    // Advanced Validation from Python: Check NIN for authoritative Sex & DOB if OCR fails
    let sex = sexRaw === 'M' ? 'Male' : (sexRaw === 'F' ? 'Female' : 'Unknown');
    if (nin) {
        let ninMatch = nin.match(/^([A-Z])([MF])(\d{2})([0-9A-Z]{10})$/);
        if (ninMatch) {
            sex = ninMatch[2] === 'M' ? 'Male' : 'Female';
            if (!dob) {
                let yy = parseInt(ninMatch[3], 10);
                let currentYear2Digit = new Date().getFullYear() % 100;
                let fullYear = (yy > currentYear2Digit) ? (1900 + yy) : (2000 + yy);
                dob = `${fullYear}-01-01`; // Fallback approximate
            }
        }
    }

    return {
        surname: surname,
        givenName: givenName,
        otherName: "",
        sex: sex,
        dateOfBirth: dob,
        nationality: nationality || "UGA",
        nin: nin,
        phoneNumber: "",
        source: "OCR MRZ"
    };
}
