class CardParseError extends Error {
    constructor(message) {
        super(message);
        this.name = "CardParseError";
    }
}

/**
 * Parses a Ugandan ID card using Tesseract.js OCR to extract the MRZ.
 * @param {HTMLImageElement|string} image - The image to process.
 * @returns {Promise<Object>} The parsed data.
 */
async function parseUgandaID(image) {
    if (!window.Tesseract) {
        throw new Error("Tesseract.js is not loaded.");
    }

    try {
        const worker = await Tesseract.createWorker('eng', 1, {}, {
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'
        });

        console.log("Starting OCR Pass 1 (psm: 6)...");
        await worker.setParameters({ tessedit_pageseg_mode: 6 });
        let result1 = await worker.recognize(image);
        console.log("========== RAW OCR TEXT (PASS 1) ==========\n" + result1.data.text + "\n===========================================");
        let mrzData = extractMRZ(result1.data.text);

        if (!mrzData) {
            console.log("Pass 1 failed, retrying with Pass 2 (psm: 4)...");
            await worker.setParameters({ tessedit_pageseg_mode: 4 });
            let result2 = await worker.recognize(image);
            console.log("========== RAW OCR TEXT (PASS 2) ==========\n" + result2.data.text + "\n===========================================");
            mrzData = extractMRZ(result2.data.text);
        }

        if (!mrzData) {
            console.log("Pass 2 failed, retrying with Pass 3 (psm: 3)...");
            await worker.setParameters({ tessedit_pageseg_mode: 3 });
            let result3 = await worker.recognize(image);
            console.log("========== RAW OCR TEXT (PASS 3) ==========\n" + result3.data.text + "\n===========================================");
            mrzData = extractMRZ(result3.data.text);
        }

        await worker.terminate();

        if (!mrzData) {
            throw new CardParseError("Could not find or read the Machine Readable Zone (MRZ) on the ID card.");
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
    const lines = text.split('\n').map(l => l.replace(/\s+/g, '').toUpperCase()).filter(l => l.length > 10);
    
    // Look for 3 consecutive lines that approximate MRZ
    for (let i = 0; i < lines.length - 2; i++) {
        let l1 = lines[i];
        let l2 = lines[i+1];
        let l3 = lines[i+2];

        // Loosened checks because OCR hallucinates
        const l1Valid = l1.startsWith('ID') || l1.startsWith('AC') || l1.includes('UGA');
        const l2Valid = l2.includes('UGA') || l2.includes('<');
        const l3Valid = l3.split('<').length > 2;

        if (l1Valid && l2Valid && l3Valid) {
            // Force exactly 30 characters using padding/truncation
            l1 = (l1 + "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<").substring(0, 30);
            l2 = (l2 + "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<").substring(0, 30);
            l3 = (l3 + "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<").substring(0, 30);
            return [l1, l2, l3];
        }
    }
    return null;
}

/**
 * Calculates the ICAO 7-3-1 check digit for a given string.
 */
function calculateICAOChecksum(str) {
    const weights = [7, 3, 1];
    let sum = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        let val = 0;
        if (char >= '0' && char <= '9') {
            val = parseInt(char, 10);
        } else if (char >= 'A' && char <= 'Z') {
            val = char.charCodeAt(0) - 55; // 'A' is 65, 65-55 = 10
        } else if (char === '<') {
            val = 0;
        }
        sum += val * weights[i % 3];
    }
    return sum % 10;
}

/**
 * Parses the extracted TD1 MRZ lines into standard fields.
 */
function parseMRZ(mrzLines) {
    let [line1, line2, line3] = mrzLines;
    
    // Auto-correction function for checksums
    function correctField(fieldStr, expectedCheck) {
        if (calculateICAOChecksum(fieldStr) === expectedCheck) return fieldStr;
        const subs = [
            {f: 'O', t: '0'}, {f: 'I', t: '1'}, {f: 'B', t: '8'}, 
            {f: 'S', t: '5'}, {f: 'Z', t: '2'}, {f: 'D', t: '0'}, 
            {f: 'Q', t: '0'}, {f: 'G', t: '6'}
        ];
        // Try substitutions
        for (let sub of subs) {
            const regex = new RegExp(sub.f, 'g');
            if (regex.test(fieldStr)) {
                let testStr = fieldStr.replace(regex, sub.t);
                if (calculateICAOChecksum(testStr) === expectedCheck) {
                    console.log(`Auto-corrected OCR checksum: ${fieldStr} -> ${testStr}`);
                    return testStr;
                }
            }
        }
        return fieldStr; // Return original if all fail
    }

    // --- Document Number ---
    let docNumRaw = line1.substring(5, 14);
    let docNumCheck = parseInt(line1.substring(14, 15), 10);
    if (!isNaN(docNumCheck)) {
        docNumRaw = correctField(docNumRaw, docNumCheck);
        if (calculateICAOChecksum(docNumRaw) !== docNumCheck) {
            console.warn("Document Number checksum failed, but proceeding with extracted data.");
        }
    }
    
    // --- DOB ---
    let dobRaw = line2.substring(0, 6);
    let dobCheck = parseInt(line2.substring(6, 7), 10);
    if (!isNaN(dobCheck)) {
        dobRaw = correctField(dobRaw, dobCheck);
        if (calculateICAOChecksum(dobRaw) !== dobCheck) {
            console.warn("Date of Birth checksum failed, but proceeding with extracted data.");
        }
    } else {
        dobRaw = dobRaw.replace(/[DOQG]/g, '0').replace(/I/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
    }

    // --- Sex & Nationality ---
    let sexRaw = line2.substring(7, 8);
    let nationality = line2.substring(15, 18).replace(/</g, '');

    // --- NIN Extraction ---
    let nin = "";
    let matchNIN = line1.match(/(?:ID|AC)UGA(.{24})/);
    if (matchNIN && matchNIN[1].length >= 24) {
        nin = matchNIN[1].substring(10, 24).replace(/</g, '').replace(/O/g, '0');
    } else {
        // Fallback if IDUGA is missing
        nin = line1.substring(15, 29).replace(/</g, '').replace(/O/g, '0');
    }

    // --- Name Extraction ---
    let line3Clean = line3.replace(/\s+/g, '<');
    let parts = line3Clean.split(/<<+/).filter(p => p.length > 0);
    
    let surname = '';
    let givenName = '';

    function cleanNamePart(name) {
        name = name.replace(/</g, '');
        if (name.length <= 1) return "";
        if (/^[KLEC87]+$/.test(name)) return ""; // Filter pure OCR hallucinations
        return name;
    }

    if (parts.length > 0) surname = cleanNamePart(parts[0]);
    if (parts.length > 1) {
        givenName = parts.slice(1).map(cleanNamePart).filter(p => p.length > 0).join(' ');
    }

    // --- DOB Formatting ---
    let dob = '';
    if (dobRaw && dobRaw.length === 6 && !isNaN(parseInt(dobRaw))) {
        let year = parseInt(dobRaw.substring(0, 2), 10);
        let monthStr = dobRaw.substring(2, 4);
        let dayStr = dobRaw.substring(4, 6);
        
        let currentYear2Digit = new Date().getFullYear() % 100;
        let fullYear = (year > currentYear2Digit) ? (1900 + year) : (2000 + year);
        dob = `${fullYear}-${monthStr}-${dayStr}`;
    }

    let sex = sexRaw === 'M' ? 'Male' : (sexRaw === 'F' ? 'Female' : 'Unknown');
    if (nin) {
        let ninMatch = nin.match(/^([A-Z])([MF])(\d{2})([0-9A-Z]{10})$/);
        if (ninMatch) {
            sex = ninMatch[2] === 'M' ? 'Male' : 'Female';
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
