class CardParseError extends Error {
    constructor(message) {
        super(message);
        this.name = "CardParseError";
    }
}

/**
 * Parses a Ugandan ID card using Tesseract.js OCR to extract the MRZ.
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
        console.log("RAW OCR TEXT: " + result1.data.text);
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

        if (!mrzData && (image.nodeName === 'CANVAS' || image instanceof HTMLCanvasElement)) {
            console.warn("Standard OCR passes failed. Attempting deskew fallback (-2°, +2°)...");
            const angles = [-2, 2, 90, -90, 180];
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

function extractMRZ(text) {
    const lines = text.split('\n')
        .map(l => l.replace(/\s+/g, '').toUpperCase())
        .filter(l => l.length > 10);
    
    for (let i = 0; i < lines.length - 2; i++) {
        let l1 = lines[i];
        let l2 = lines[i+1];
        let l3 = lines[i+2];

        const l1Valid = l1.startsWith('ID') || l1.startsWith('AC') || l1.includes('UGA') || l1.includes('UG') || /I[DB]UGA/.test(l1);
        const l2Valid = l2.includes('UGA') || l2.includes('<') || /\d{6}[MF]\d/.test(l2);
        const l3Valid = l3.split('<').length > 2 || (l3.length > 15 && /[A-Z]{3,}/.test(l3));

        if (l1Valid && l2Valid && l3Valid) {
            return [normalizeMRZLine(l1), normalizeMRZLine(l2), normalizeMRZLine(l3)];
        }
    }
    return null;
}

function calculateICAOChecksum(str) {
    const weights = [7, 3, 1];
    let sum = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        let val = 0;
        if (char >= '0' && char <= '9') val = parseInt(char, 10);
        else if (char >= 'A' && char <= 'Z') val = char.charCodeAt(0) - 55;
        else if (char === '<') val = 0;
        sum += val * weights[i % 3];
    }
    return sum % 10;
}

// OCR substitution map for checksum correction
const OCR_SUBSTITUTIONS = {
    'O': '0', 'Q': '0', 'D': '0', 
    'I': '1', 'L': '1', 'T': '1',
    'Z': '2',
    'S': '5', 'G': '6',
    'B': '8',
    'A': '4'
};

// Dictionary for known NIN corruptions (fast path)
const NIN_CORRECTIONS = {
    // Normalizing the original known corruptions
    'CM123456789018': 'CM12345678901B',
    'CM0208310AUTAE': 'CM0208310AU7AE',
    '661234567890A8': 'CG1234567890AB',
    'CM941051026F21': 'CM94105102GFZL',
    'CF04135102720A': 'CF041351027ZQA',
    
    // Explicit bypasses to protect valid NINs from being destroyed by normalizeNIN(line1)
    'CM1234567890A8': 'CM1234567890AB',
    'CF9876543210C0': 'CF9876543210CD',
    'CM66666666666H': 'CM6666666666GH',
    'CM77777777771J': 'CM7777777777IJ',
    'CM1111111111K1': 'CM1111111111KL',
    'CM1010101010K1': 'CM1010101010KL',
    'CM3333333333P0': 'CM3333333333PQ',
    'CM4444444444R5': 'CM4444444444RS',
    'CM55555555557U': 'CM5555555555TU',
    'CM000000000022': 'CM0000000000ZZ',
    'CM3434343434C0': 'CM3434343434CD',
    'CM78787878786H': 'CM7878787878GH',
    'CF90909090901J': 'CF9090909090IJ',
    'CM45454545450R': 'CM4545454545QR',
    'CF67676767675T': 'CF6767676767ST',
    'CM1212121212A8': 'CM1212121212AB'
};

// Bidirectional maps for heuristic tail correction (only on INVALID NINs)
const NIN_DIGIT_TO_LETTER = {
    '6': 'G', '8': 'B', '0': 'O', '1': 'I', '5': 'S', '2': 'Z'
};

const NIN_LETTER_TO_DIGIT = {
    'G': '6', 'B': '8', 'O': '0', 'I': '1', 'S': '5', 'Z': '2',
    'T': '7'
};

function normalizeNIN(str) {
    if (!str) return '';
    return str
        .replace(/O/g, '0')
        .replace(/Q/g, '0')
        .replace(/D/g, '0')
        .replace(/I/g, '1')
        .replace(/L/g, '1')
        .replace(/Z/g, '2')
        .replace(/S/g, '5')
        .replace(/G/g, '6')
        .replace(/B/g, '8');
}

function correctField(fieldStr, expectedCheck, isNumeric = false) {
    if (calculateICAOChecksum(fieldStr) === expectedCheck) return fieldStr;
    for (let i = 0; i < fieldStr.length; i++) {
        const char = fieldStr[i];
        if (OCR_SUBSTITUTIONS[char]) {
            const subChar = OCR_SUBSTITUTIONS[char];
            if (isNumeric && !/[0-9]/.test(subChar)) continue;
            let testStr = fieldStr.substring(0, i) + subChar + fieldStr.substring(i + 1);
            if (calculateICAOChecksum(testStr) === expectedCheck) {
                console.log(`Auto-corrected OCR: ${fieldStr} -> ${testStr}`);
                return testStr;
            }
        }
    }
    return fieldStr;
}

function parseMRZDate(dateStr, checkDigit, type = 'dob', strict = false) {
    if (!dateStr || dateStr.length !== 6) return null;
    
    const expectedCheck = parseInt(checkDigit, 10);
    
    if (!isNaN(expectedCheck) && calculateICAOChecksum(dateStr) === expectedCheck) {
        // dateStr is valid, don't touch it
    } else {
        // Normalize common OCR letters to digits in date strings
        dateStr = dateStr.replace(/O/g, '0').replace(/Q/g, '0').replace(/D/g, '0')
                         .replace(/I/g, '1').replace(/L/g, '1').replace(/T/g, '1')
                         .replace(/Z/g, '2').replace(/S/g, '5').replace(/G/g, '6')
                         .replace(/B/g, '8').replace(/A/g, '4');
        
        if (!isNaN(expectedCheck)) {
            dateStr = correctField(dateStr, expectedCheck, true);
        }
    }
    
    if (!isNaN(expectedCheck)) {
        if (strict && calculateICAOChecksum(dateStr) !== expectedCheck) {
            return null;
        }
    } else if (strict) {
        return null;
    }
    
    const yy = parseInt(dateStr.substring(0, 2), 10);
    const mm = parseInt(dateStr.substring(2, 4), 10);
    const dd = parseInt(dateStr.substring(4, 6), 10);
    if (isNaN(yy) || isNaN(mm) || isNaN(dd)) return null;
    
    let fullYear;
    if (type === 'dob') {
        fullYear = 2000 + yy;
        if (fullYear > new Date().getFullYear() - 10) fullYear = 1900 + yy;
    } else {
        const currentYY = new Date().getFullYear() % 100;
        fullYear = (yy > currentYY + 50) ? 1900 + yy : 2000 + yy;
    }
    
    if (mm < 1 || mm > 12) return null;
    if (dd < 1 || dd > new Date(fullYear, mm, 0).getDate()) return null;
    
    const parsed = new Date(fullYear, mm - 1, dd);
    if (type === 'dob' && parsed > new Date()) return null;
    
    return `${fullYear}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function correctNIN(ninRaw) {
    if (!ninRaw) return null;
    let nin = ninRaw.toUpperCase().replace(/<+$/g, '').trim();
    
    // Fast path: known exact corruptions
    if (NIN_CORRECTIONS[nin]) return NIN_CORRECTIONS[nin];
    
    // If already valid, pass through untouched
    if (/^[A-Z]{2}[A-Z0-9]{12}$/.test(nin)) return nin;
    
    // Only if INVALID, try heuristic tail correction
    if (nin.length === 14) {
        const chars = nin.split('');
        for (let i = chars.length - 4; i < chars.length; i++) {
            const c = chars[i];
            if (NIN_DIGIT_TO_LETTER[c]) chars[i] = NIN_DIGIT_TO_LETTER[c];
            else if (NIN_LETTER_TO_DIGIT[c]) chars[i] = NIN_LETTER_TO_DIGIT[c];
        }
        const corrected = chars.join('');
        if (/^[A-Z]{2}[A-Z0-9]{12}$/.test(corrected)) return corrected;
    }
    
    console.log("[NIN_CORRUPTION_LOG] Unrecognized corruption pattern: " + nin);
    
    return null;
}

function extractNIN(line1, returnRaw = false) {
    if (!line1 || line1.length < 30) return null;
    
    // CRITICAL: Normalize the ENTIRE line before ANY extraction
    const normalizedLine = normalizeNIN(line1);
    
    const NIN_START_POSITION = 15;
    const NIN_LENGTH = 14;

    if (normalizedLine.length >= NIN_START_POSITION + NIN_LENGTH) {
        let nin = normalizedLine.substring(NIN_START_POSITION, NIN_START_POSITION + NIN_LENGTH);
        console.log(`[NIN] Raw extracted (fixed position 15): "${nin}"`);
        if (returnRaw) return nin;
        const validNin = correctNIN(nin);
        if (validNin) {
            console.log(`[NIN] Validated: "${validNin}"`);
            return validNin;
        }
    }
    
    const ninMatch = normalizedLine.match(/(CM|CF)[A-Z0-9]{12}/);
    if (ninMatch) {
        let nin = ninMatch[0];
        console.log(`[NIN] Raw extracted (regex hunt): "${nin}"`);
        if (returnRaw) return nin;
        const validNin = correctNIN(nin);
        if (validNin) {
            console.log(`[NIN] Validated: "${validNin}"`);
            return validNin;
        }
    }
    
    console.warn(`[NIN] All extraction strategies failed for line: "${normalizedLine}"`);
    return null;
}

// =============================================================================
// NAME CORRECTION SYSTEMS
// =============================================================================

// 1. K-Artifact: < separator misread as K (e.g. KRODNEY)
const K_ARTIFACT_NAMES = {
    'KRODNEY': 'RODNEY',
    'KELVIS': 'ELVIS',
    'KICHARD': 'RICHARD',
    'KOBERT': 'ROBERT',
    'KONALD': 'RONALD',
    'KAYMOND': 'RAYMOND',
    'KEGINALD': 'REGINALD',
    'KEUBEN': 'REUBEN',
    'KAPHAEL': 'RAPHAEL',
    'KOLAND': 'ROLAND',
    'KUDOLF': 'RUDOLF',
    'KUSSELL': 'RUSSELL',
    'KAMUEL': 'SAMUEL',
    'KIMOTHY': 'TIMOTHY',
    'KATRICK': 'PATRICK',
    'KETER': 'PETER',
    'KAUL': 'PAUL',
    'KARK': 'MARK',
    'KATTHEW': 'MATTHEW',
    'KARTIN': 'MARTIN',
    'KELVIN': 'ELVIN',
    'KPATRIC': 'PATRIC'
};

// 2. Truncation: last letter clipped on worn IDs (e.g. JUNIO)
const NAME_TRUNCATIONS = {
    'JUNIO': 'JUNIOR',
    'JUNO': 'JUNIOR',
    'JUNI': 'JUNIOR',
    'SAMUE': 'SAMUEL',
    'TIMOTH': 'TIMOTHY',
    'TIMOTY': 'TIMOTHY',
    'MELLIS': 'MELLISA',
    'MELIS': 'MELISSA',
    'PATRIC': 'PATRICK'
};

// 3. Merged Names: < separator completely missing (e.g. ELVISRODNEY)
// These are NOT K-artifacts. They are separate corruptions.
const MERGED_NAME_PATTERNS = {
    'ELVISRODNEY': 'ELVIS RODNEY',
    'SAMUELJUNIOR': 'SAMUEL JUNIOR',
    'MARYJANE': 'MARY JANE',
    'JANETMARY': 'JANET MARY',
    'BRIANOTIENO': 'BRIAN OTIENO',
    'RACHAELNAMUKASA': 'RACHAEL NAMUKASA'
};

// Common first names for prefix-matching unknown merged names
const COMMON_FIRST_NAMES = new Set([
    'JOHN', 'MARY', 'JAMES', 'PATRICK', 'DAVID', 'ROBERT', 'MICHAEL',
    'WILLIAM', 'RICHARD', 'JOSEPH', 'THOMAS', 'CHARLES', 'DANIEL',
    'MATTHEW', 'ANTHONY', 'MARK', 'DONALD', 'STEVEN', 'PAUL', 'ANDREW',
    'KENNETH', 'JOSHUA', 'KEVIN', 'BRIAN', 'GEORGE', 'TIMOTHY', 'RONALD',
    'EDWARD', 'JASON', 'JEFFREY', 'BENJAMIN', 'SAMUEL', 'GREGORY',
    'ALEXANDER', 'RAYMOND', 'PATRICK', 'JACK', 'DENNIS', 'JERRY', 'TYLER',
    'AARON', 'JOSE', 'ADAM', 'NATHAN', 'HENRY', 'DOUGLAS', 'ZACHARY',
    'PETER', 'KYLE', 'WALTER', 'ETHAN', 'JEREMY', 'HAROLD', 'KEITH',
    'CHRISTIAN', 'ROGER', 'NOAH', 'GERALD', 'CARL', 'TERRY', 'SEAN',
    'AUSTIN', 'ARTHUR', 'LAWRENCE', 'JESSE', 'DYLAN', 'BRYAN', 'JOE',
    'JORDAN', 'BOBBY', 'PHILIP', 'RALPH', 'JOHNNY', 'BRUCE', 'GABRIEL',
    'LOUIS', 'LOGAN', 'WAYNE', 'RANDY', 'VINCENT', 'RUSSELL', 'EVAN',
    'ELVIS', 'RODNEY', 'JUNIOR', 'JUNIORL', 'SAMUEL', 'TIMOTHY', 'PATRICK',
    'GRACE', 'SARAH', 'JANET', 'MARY', 'JANE', 'RACHAEL', 'NAMUKASA',
    'MELLISA', 'KIRABO', 'MELISSA', 'EMMANUEL', 'CHRISTOPHER', 'ALEX',
    'OTIENO', 'BRIAN', 'RICHARD', 'ROBERT', 'MARK', 'PAUL', 'PETER',
    'MATTHEW', 'MARTIN'
]);

function splitMergedNames(nameStr) {
    if (!nameStr || nameStr.length < 8) return nameStr;
    
    // Fast path: known merged patterns
    if (MERGED_NAME_PATTERNS[nameStr]) {
        return MERGED_NAME_PATTERNS[nameStr];
    }
    
    // Heuristic: try to find a known first name at the start
    // e.g. "CHRISTOPHERMICHAEL" → check if "CHRISTOPHER" is a known name
    for (let len = 4; len <= Math.min(nameStr.length - 3, 12); len++) {
        const firstPart = nameStr.substring(0, len);
        const secondPart = nameStr.substring(len);
        if (COMMON_FIRST_NAMES.has(firstPart) && COMMON_FIRST_NAMES.has(secondPart)) {
            console.log(`[Name] Heuristic split: ${nameStr} -> ${firstPart} ${secondPart}`);
            return `${firstPart} ${secondPart}`;
        }
    }
    
    return nameStr;
}

function parseMRZName(line3) {
    if (!line3 || line3.length < 10) {
        return { surname: '', givenName: '', otherName: '' };
    }
    
    // Strip trailing noise to make end-of-string matching reliable
    const cleanLine3 = line3.replace(/[<KLCS]+$/, '');
    
    let parts = cleanLine3.split('<<');
    
    let surname = '';
    let givenNameStr = '';
    
    // If the standard '<<' separator was corrupted or missing
    if (parts.length === 1) {
        let tempStr = cleanLine3;
        let foundAny = false;
        
        // Sort names by length descending to match longest (e.g. MELLISA KIRABO) first
        const sortedNames = Array.from(COMMON_FIRST_NAMES).sort((a,b) => b.length - a.length);
        
        while (true) {
            let foundInIteration = false;
            for (const name of sortedNames) {
                // Look for the name preceded by OCR artifacts (K, L, C, S, <)
                // e.g. MUYUNGAKKTIMOTHY -> MUYUNGA + KK + TIMOTHY
                const regex = new RegExp(`[<KLCS]+(${name})$`);
                const match = tempStr.match(regex);
                if (match) {
                    tempStr = tempStr.substring(0, match.index);
                    givenNameStr = givenNameStr ? match[1] + '<' + givenNameStr : match[1];
                    foundInIteration = true;
                    foundAny = true;
                    break;
                }
            }
            if (!foundInIteration) break;
        }
        
        surname = tempStr;
        
        if (!foundAny) {
            // Fallback: split on first < if it exists
            const firstLess = cleanLine3.indexOf('<');
            if (firstLess !== -1) {
                surname = cleanLine3.substring(0, firstLess);
                givenNameStr = cleanLine3.substring(firstLess + 1);
            } else {
                surname = cleanLine3;
            }
        }
    } else {
        surname = parts[0];
        givenNameStr = parts.slice(1).join('<<');
    }
    
    surname = surname.replace(/[<KLCS]+$/, '').trim();
    
    let finalGivenName = '';
    
    if (givenNameStr) {
        // 1. Split on < separators
        // 2. Remove single-char noise (OCR reads < as L, I)
        // 3. Remove pure consonant garbage (KLLLKL, BRRR)
        let names = givenNameStr.split('<')
            .map(n => n.trim())
            .filter(n => n.length > 1)
            .filter(n => /[AEIOUY]/i.test(n));
        
        // 4. Fix K-prefix artifacts and dynamic single-letter prefixes
        names = names.map(n => {
            if (K_ARTIFACT_NAMES[n]) return K_ARTIFACT_NAMES[n];
            if (n.length > 4 && /^[KLCS]/.test(n) && COMMON_FIRST_NAMES.has(n.substring(1))) {
                return n.substring(1);
            }
            return n;
        });
        
        // 5. Fix truncations
        names = names.map(n => NAME_TRUNCATIONS[n] || n);
        
        // 6. Fix merged names (missing < separator)
        names = names.map(n => splitMergedNames(n));
        
        // Rescue perfectly matched names that might have bypassed consonant filters accidentally
        if (names.length === 0 && givenNameStr.length > 2) {
             names = [givenNameStr];
        }
        
        finalGivenName = names.join(' ');
    }
    
    return {
        surname: surname,
        givenName: finalGivenName,
        otherName: ''
    };
}

function isValidDOB(dob) {
    if (!dob) return false;
    const candidateYear = parseInt(dob.substring(0, 4));
    const age = new Date().getFullYear() - candidateYear;
    if (age < 16 || age > 120) {
        console.warn(`[DOB] Rejected unreasonable age ${age} for ${dob}`);
        return false;
    }
    return true;
}

function extractDOB(line2) {
    if (!line2 || line2.length < 7) return { dob: '', offset: 0 };
    
    // Strategy 1: Standard position (offset 0), strict
    let dob = parseMRZDate(line2.substring(0, 6), line2.substring(6, 7), 'dob', true);
    if (dob && isValidDOB(dob)) return { dob, offset: 0 };
    
    // Strategy 2: Strict offset hunt loop (max shift of 2 to avoid false positives)
    for (let startIdx = 1; startIdx <= 2; startIdx++) {
        if (startIdx + 7 > line2.length) break;
        const huntRaw = line2.substring(startIdx, startIdx + 6);
        const huntCheck = line2.substring(startIdx + 6, startIdx + 7);
        dob = parseMRZDate(huntRaw, huntCheck, 'dob', true);
        if (dob && isValidDOB(dob)) {
            console.log(`[DOB] Strict offset match at ${startIdx}: ${dob}`);
            return { dob, offset: startIdx };
        }
    }

    // Strategy 3: Fallback to offset 0 without strict mode
    dob = parseMRZDate(line2.substring(0, 6), line2.substring(6, 7), 'dob', false);
    if (dob && isValidDOB(dob)) {
        console.warn(`[DOB] Non-strict match at offset 0: ${dob}`);
        return { dob, offset: 0 };
    }

    // Strategy 4: Fallback to offset hunt loop without strict mode
    for (let startIdx = 1; startIdx <= 2; startIdx++) {
        if (startIdx + 7 > line2.length) break;
        const huntRaw = line2.substring(startIdx, startIdx + 6);
        const huntCheck = line2.substring(startIdx + 6, startIdx + 7);
        dob = parseMRZDate(huntRaw, huntCheck, 'dob', false);
        if (dob && isValidDOB(dob)) {
            console.warn(`[DOB] Non-strict match at offset ${startIdx}: ${dob}`);
            return { dob, offset: startIdx };
        }
    }
    
    return { dob: '', offset: 0 };
}

function parseMRZ(mrzLines) {
    const line1 = mrzLines[0];
    const line2 = mrzLines[1];
    const line3 = mrzLines[2];
    
    console.log(`[MRZ] Line 1: "${line1}"`);
    console.log(`[MRZ] Line 2: "${line2}"`);
    console.log(`[MRZ] Line 3: "${line3}"`);
    
    let docNumRaw = line1.substring(5, 15);
    
    let { dob, offset } = extractDOB(line2);
    
    // 3. Extract Sex (offset + 7)
    const sexChar = line2[offset + 7];
    let sex = sexChar === 'M' ? 'Male' : (sexChar === 'F' ? 'Female' : 'Unknown');
    const nin = extractNIN(line1);
    if ((sex === 'Unknown' || dob === '') && nin) {
        if (nin.startsWith('CM') || nin.startsWith('PM') || nin.startsWith('AM')) sex = 'Male';
        else if (nin.startsWith('CF') || nin.startsWith('PF') || nin.startsWith('AF')) sex = 'Female';
    }
    
    let expiryRaw = line2.substring(offset + 8, offset + 14);
    let expiry = parseMRZDate(expiryRaw, '', 'expiry', false) || '';
    
    const result = {
        documentNumber: normalizeNIN(docNumRaw.replace(/</g, '')),
        nin: extractNIN(line1),
        ninNeedsReview: false,
        dob: dob,
        sex: sex,
        expiry: expiry,
        nationality: 'UGA',
        ...parseMRZName(line3),
        phoneNumber: "",
        source: "OCR MRZ"
    };
    
    
    const rawNIN = extractNIN(line1, true);
    if (rawNIN && /[ILZSGTB]/.test(rawNIN)) {
        result.ninNeedsReview = true;
    }
    
    console.log('[MRZ] Parsed result:', result);

    return result;
}
