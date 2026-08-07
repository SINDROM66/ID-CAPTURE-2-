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

const NIN_OCR_PAIRS = {
    '6': 'G', '8': 'B', '0': 'O', '1': 'I', '5': 'S', '2': 'Z',
    'G': '6', 'B': '8', 'O': '0', 'I': '1', 'S': '5', 'Z': '2'
};

function parseMRZDate(dateStr, type = 'dob') {
    if (!dateStr || dateStr.length !== 6) return null;
    
    const yy = parseInt(dateStr.substring(0, 2), 10);
    const mm = parseInt(dateStr.substring(2, 4), 10);
    const dd = parseInt(dateStr.substring(4, 6), 10);
    
    if (isNaN(yy) || isNaN(mm) || isNaN(dd)) return null;
    
    let fullYear;
    if (type === 'dob') {
        fullYear = 2000 + yy;
        const currentYear = new Date().getFullYear();
        if (fullYear > currentYear) {
            fullYear = 1900 + yy;
        }
    } else {
        const currentYear = new Date().getFullYear();
        const currentYY = currentYear % 100;
        fullYear = (yy > currentYY + 50) ? 1900 + yy : 2000 + yy;
    }
    
    if (mm < 1 || mm > 12) return null;
    const daysInMonth = new Date(fullYear, mm, 0).getDate();
    if (dd < 1 || dd > daysInMonth) return null;
    
    const parsed = new Date(fullYear, mm - 1, dd);
    if (type === 'dob' && parsed > new Date()) return null;
    
    return `${fullYear}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function correctNIN(ninRaw) {
    if (!ninRaw) return null;
    let nin = ninRaw.toUpperCase().replace(/<+$/g, '').trim();
    if (nin.length !== 14) return nin; // Return raw if length is already bad, but allow it to pass through
    
    const chars = nin.split('');
    
    for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        
        // Positions 0-1: MUST be letters (CM, CF). Force number→letter.
        if (i < 2 && /[0-9]/.test(c) && NIN_OCR_PAIRS[c]) {
            chars[i] = NIN_OCR_PAIRS[c];
        }
        // Positions 2+: Only substitute at the tail end where OCR is weakest,
        // and ONLY number→letter
        else if (i >= nin.length - 4 && /[0-9]/.test(c) && NIN_OCR_PAIRS[c]) {
            chars[i] = NIN_OCR_PAIRS[c];
        }
    }
    
    return chars.join('');
}

function extractNIN(line1) {
    if (!line1 || line1.length < 30) return null;
    
    // Find UGA in first 8 chars of line 1 ONLY
    const line1Prefix = line1.substring(0, 8);
    let ugaIndex = line1Prefix.indexOf('UGA');
    
    // Fuzzy match for common OCR errors
    if (ugaIndex === -1) {
        const fuzzyMatch = line1Prefix.match(/[VU]G[A4]/);
        if (fuzzyMatch) {
            ugaIndex = fuzzyMatch.index;
            console.log(`[NIN] Fuzzy-matched UGA at index ${ugaIndex}: "${fuzzyMatch[0]}"`);
        }
    }
    
    if (ugaIndex === -1 || ugaIndex > 4) {
        console.warn(`[NIN] No valid UGA anchor found in Line 1 prefix: "${line1Prefix}"`);
        let fallbackNin = line1.substring(15, 29);
        return correctNIN(fallbackNin) || fallbackNin;
    }
    
    const ninStart = ugaIndex + 13; // 0-based: UGA start + 13 = start of NIN
    if (line1.length < ninStart + 14) {
        console.warn(`[NIN] Line 1 too short for NIN extraction`);
        return null;
    }
    
    let nin = line1.substring(ninStart, ninStart + 14);
    console.log(`[NIN] Raw extracted: "${nin}" from Line 1[${ninStart}-${ninStart + 13}]`);
    
    nin = correctNIN(nin);
    console.log(`[NIN] After correction: "${nin}"`);
    
    if (!nin || !/^[A-Z0-9]{14}$/.test(nin)) {
        console.warn(`[NIN] Format validation failed: "${nin}"`);
    }
    
    return nin;
}

function stripTrailingArtifacts(name) {
    if (!name) return '';
    // Strip only 4+ trailing consonants. Include Y as a vowel.
    return name.replace(/[^AEIOUY]{4,}$/i, '');
}

function parseMRZName(line3) {
    if (!line3 || line3.length < 20) {
        return { surname: '', givenName: '', otherName: '' };
    }
    
    // Replace ALL fillers with spaces, collapse multiples
    const cleaned = line3
        .replace(/</g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    let parts = cleaned.split(' ').filter(p => p.length > 0);
    
    // Aggressive artifact filter: each part must contain a vowel AND be > 2 chars
    const VOWELS = /[AEIOUY]/i;
    parts = parts.filter(part => VOWELS.test(part) && part.length > 2);
    
    const rawGiven = parts.slice(1, 2).join(' ');
    const rawOther = parts.slice(2).join(' ');
    
    return {
        surname: stripTrailingArtifacts(parts[0] || ''),
        givenName: stripTrailingArtifacts(rawGiven) || '',
        otherName: stripTrailingArtifacts(rawOther) || ''
    };
}

function parseMRZ(mrzLines) {
    const line1 = mrzLines[0];
    const line2 = mrzLines[1];
    const line3 = mrzLines[2];
    
    console.log(`[MRZ] Line 1: "${line1}"`);
    console.log(`[MRZ] Line 2: "${line2}"`);
    console.log(`[MRZ] Line 3: "${line3}"`);
    
    // Auto-correction function for checksums
    function correctField(fieldStr, expectedCheck, isNumeric = false) {
        if (calculateICAOChecksum(fieldStr) === expectedCheck) return fieldStr;
        
        for (let i = 0; i < fieldStr.length; i++) {
            const char = fieldStr[i];
            if (OCR_SUBSTITUTIONS[char]) {
                const subChar = OCR_SUBSTITUTIONS[char];
                if (isNumeric && subChar === '<') continue;
                
                let testStr = fieldStr.substring(0, i) + subChar + fieldStr.substring(i + 1);
                if (calculateICAOChecksum(testStr) === expectedCheck) {
                    console.log(`Auto-corrected OCR checksum: ${fieldStr} -> ${testStr}`);
                    return testStr;
                }
            }
        }
        return fieldStr;
    }

    // Document Number Checksum Correction
    let docNumRaw = line1.substring(5, 14);
    let docNumCheck = parseInt(line1.substring(14, 15), 10);
    if (!isNaN(docNumCheck)) {
        docNumRaw = correctField(docNumRaw, docNumCheck, true);
    }
    
    // Extract Sex
    const sexChar = line2[7];
    const sex = sexChar === 'M' ? 'Male' : (sexChar === 'F' ? 'Female' : 'Unknown');

    const result = {
        documentNumber: docNumRaw.replace(/</g, ''),
        nin: extractNIN(line1),
        dob: parseMRZDate(line2.substring(0, 6), 'dob') || '',
        sex: sex,
        expiry: parseMRZDate(line2.substring(8, 14), 'expiry') || '',
        nationality: 'UGA',
        ...parseMRZName(line3),
        phoneNumber: "",
        source: "OCR MRZ"
    };
    
    console.log('[MRZ] Parsed result:', result);
    return result;
}
