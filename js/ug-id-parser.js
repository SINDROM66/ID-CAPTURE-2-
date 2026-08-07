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

    const worker = await Tesseract.createWorker('eng', 1, {}, {
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'
    });

    try {
        console.log("Starting OCR Pass 1 (psm: 6)...");
        await worker.setParameters({ tessedit_pageseg_mode: 6 });
        let result1 = await worker.recognize(image);
        let mrzData = extractMRZ(result1.data.text);

        if (!mrzData) {
            console.log("Pass 1 failed, retrying with Pass 2 (psm: 4)...");
            await worker.setParameters({ tessedit_pageseg_mode: 4 });
            let result2 = await worker.recognize(image);
            mrzData = extractMRZ(result2.data.text);
        }

        if (!mrzData) {
            console.log("Pass 2 failed, retrying with Pass 3 (psm: 3)...");
            await worker.setParameters({ tessedit_pageseg_mode: 3 });
            let result3 = await worker.recognize(image);
            mrzData = extractMRZ(result3.data.text);
        }

        // Lightweight Deskew Fallback
        if (!mrzData && image instanceof HTMLCanvasElement) {
            console.warn("Standard OCR passes failed. Attempting lightweight deskew fallback (-2°, +2°)...");
            const angles = [-2, 2];
            for (let angle of angles) {
                console.log(`Testing rotation: ${angle}°`);
                const rotatedCanvas = document.createElement('canvas');
                rotatedCanvas.width = image.width;
                rotatedCanvas.height = image.height;
                const ctx = rotatedCanvas.getContext('2d');
                ctx.translate(image.width / 2, image.height / 2);
                ctx.rotate(angle * Math.PI / 180);
                ctx.drawImage(image, -image.width / 2, -image.height / 2);
                
                await worker.setParameters({ tessedit_pageseg_mode: 6 });
                let rotResult = await worker.recognize(rotatedCanvas);
                mrzData = extractMRZ(rotResult.data.text);
                if (mrzData) {
                    console.log(`MRZ found after rotating ${angle}°!`);
                    break;
                }
            }
        }

        if (!mrzData) {
            throw new CardParseError("Could not find or read the Machine Readable Zone (MRZ) on the ID card.");
        }

        return parseMRZ(mrzData);
    } catch (error) {
        if (error instanceof CardParseError) throw error;
        throw new CardParseError("OCR Processing failed: " + error.message);
    } finally {
        await worker.terminate();
    }
}

function normalizeMRZLine(line) {
    line = line.replace(/[^A-Z0-9<]/g, '');
    if (line.length < 30) line = line.padEnd(30, '<');
    if (line.length > 30) line = line.substring(0, 30);
    return line;
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
            return [normalizeMRZLine(l1), normalizeMRZLine(l2), normalizeMRZLine(l3)];
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
const OCR_SUBSTITUTIONS = {
    'O': '0', 'Q': '0', 'D': '0', 'E': '0',
    'I': '1', 'L': '1',
    'Z': '2',
    'S': '5', 'G': '6',
    'B': '8',
    'K': '<', 'C': '<', 'A': '4'
};

function parseMRZ(mrzLines) {
    let [line1, line2, line3] = mrzLines;
    
    // Auto-correction function for checksums
    function correctField(fieldStr, expectedCheck, isNumeric = false) {
        if (calculateICAOChecksum(fieldStr) === expectedCheck) return fieldStr;
        
        // 1. Single substitutions
        for (let i = 0; i < fieldStr.length; i++) {
            const char = fieldStr[i];
            if (OCR_SUBSTITUTIONS[char]) {
                const subChar = OCR_SUBSTITUTIONS[char];
                if (isNumeric && subChar === '<') continue;
                
                let testStr = fieldStr.substring(0, i) + subChar + fieldStr.substring(i + 1);
                if (calculateICAOChecksum(testStr) === expectedCheck) {
                    console.log(`Auto-corrected OCR checksum (single): ${fieldStr} -> ${testStr}`);
                    return testStr;
                }
            }
        }
        
        // 2. Pairwise combinations
        let attempts = 0;
        for (let i = 0; i < fieldStr.length - 1; i++) {
            for (let j = i + 1; j < fieldStr.length; j++) {
                const char1 = fieldStr[i];
                const char2 = fieldStr[j];
                if (OCR_SUBSTITUTIONS[char1] && OCR_SUBSTITUTIONS[char2]) {
                    const sub1 = OCR_SUBSTITUTIONS[char1];
                    const sub2 = OCR_SUBSTITUTIONS[char2];
                    if (isNumeric && (sub1 === '<' || sub2 === '<')) continue;
                    
                    let testStr = fieldStr.split('');
                    testStr[i] = sub1;
                    testStr[j] = sub2;
                    testStr = testStr.join('');
                    
                    if (calculateICAOChecksum(testStr) === expectedCheck) {
                        console.log(`Auto-corrected OCR checksum (pair): ${fieldStr} -> ${testStr}`);
                        return testStr;
                    }
                    attempts++;
                    if (attempts >= 3) break;
                }
            }
            if (attempts >= 3) break;
        }

        console.warn(`Checksum unrecoverable for field: ${fieldStr} after testing substitutions.`);
        return fieldStr;
    }

    // --- Document Number ---
    let docNumRaw = line1.substring(5, 14);
    let docNumCheck = parseInt(line1.substring(14, 15), 10);
    if (!isNaN(docNumCheck)) {
        docNumRaw = correctField(docNumRaw, docNumCheck, true);
    }
    
    // --- DOB ---
    let dobRaw = line2.substring(0, 6);
    let dobCheck = parseInt(line2.substring(6, 7), 10);
    if (!isNaN(dobCheck)) {
        dobRaw = correctField(dobRaw, dobCheck, true);
    } else {
        dobRaw = dobRaw.replace(/[DOQGE]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
    }
    
    function isValidDate(yy, mm, dd) {
        const month = parseInt(mm, 10);
        const day = parseInt(dd, 10);
        const year = parseInt(yy, 10);
        if (month < 1 || month > 12) return false;
        if (day < 1 || day > 31) return false;
        const daysInMonth = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (day > daysInMonth[month]) return false;
        const currentYear2Digit = new Date().getFullYear() % 100;
        if (year > currentYear2Digit + 1) return false;
        return true;
    }
    
    // Verify date sanity
    let dob = '';
    if (dobRaw.length === 6 && !isNaN(parseInt(dobRaw))) {
        const yy = dobRaw.substring(0, 2);
        const mm = dobRaw.substring(2, 4);
        const dd = dobRaw.substring(4, 6);
        if (isValidDate(yy, mm, dd)) {
            let year = parseInt(yy, 10);
            let currentYear2Digit = new Date().getFullYear() % 100;
            let fullYear = (year > currentYear2Digit) ? (1900 + year) : (2000 + year);
            dob = `${fullYear}-${mm}-${dd}`;
        } else {
            console.warn(`Date Sanity Check failed for DOB: ${dobRaw}. Blanking field.`);
            dobRaw = ""; 
        }
    }

    // --- Sex & Nationality ---
    let sexRaw = line2.substring(7, 8);
    let nationality = line2.substring(15, 18).replace(/</g, '');

    // --- NIN Extraction ---
    let nin = '';
    const line1Clean = line1.replace(/\s+/g, '').toUpperCase();
    
    if (line1Clean.length >= 29) {
        nin = line1Clean.substring(15, 29).replace(/O/g, '0');
    }
    
    const ugaIndex = line1Clean.indexOf('UGA');
    if ((!nin || nin.length !== 14) && ugaIndex >= 0 && line1Clean.length >= ugaIndex + 27) {
        nin = line1Clean.substring(ugaIndex + 13, ugaIndex + 27).replace(/O/g, '0');
    }
    
    if (!nin || nin.length !== 14) {
        const match = line1Clean.match(/[A-Z]{2}[0-9A-Z]{10}[A-Z]{2}/);
        if (match) nin = match[0].replace(/O/g, '0');
    }

    // --- Name Extraction ---
    let line3Clean = line3.replace(/\s+/g, '<');
    const parts = line3Clean.split(/<<+/).filter(p => p.length > 0);
    
    function isGarbageSegment(segment) {
        if (segment.length === 1) return true;
        if (segment.length < 3 && /^[KLEC87<]+$/.test(segment)) return true;
        return false;
    }
    
    const validParts = parts.filter(p => !isGarbageSegment(p));
    
    function cleanNamePart(name) {
        name = name.replace(/</g, '');
        if (name.length >= 3 && /[AEIOU]/.test(name)) return name;
        return name.replace(/^[KLEC87]+(?=[BCDFGJKMNPQSTVXZ])/g, "");
    }
    
    let surname = '';
    let givenName = '';
    if (validParts.length > 0) surname = cleanNamePart(validParts[0]);
    if (validParts.length > 1) {
        givenName = validParts.slice(1).map(cleanNamePart).filter(p => p.length > 0).join(' ');
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
