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
        const worker = await Tesseract.createWorker('eng');
        await worker.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789< '
        });

        // Pass 1: Default layout analysis (psm: 3)
        console.log("Starting OCR Pass 1 (psm: 3)...");
        let { data: { text } } = await worker.recognize(image);
        console.log("========== RAW OCR TEXT (PASS 1) ==========\n" + text + "\n===========================================");
        let mrzData = extractMRZ(text);

        // Pass 2: Fallback. Assume a single uniform block of text (psm: 6)
        // Extremely effective at ignoring background objects like keyboards
        if (!mrzData) {
            console.log("Pass 1 failed, retrying with Pass 2 (psm: 6)...");
            await worker.setParameters({ tessedit_pageseg_mode: '6' });
            let result2 = await worker.recognize(image);
            text = result2.data.text;
            console.log("========== RAW OCR TEXT (PASS 2) ==========\n" + text + "\n===========================================");
            mrzData = extractMRZ(text);
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
    const lines = text.split('\n').map(l => l.replace(/\s+/g, '').toUpperCase()).filter(l => l.length > 0);
    
    // Look for 3 consecutive lines that look like MRZ
    for (let i = 0; i < lines.length - 2; i++) {
        const l1 = lines[i];
        const l2 = lines[i+1];
        const l3 = lines[i+2];

        // Ensure lines are long enough to be an MRZ block
        if (l1.length >= 25 && l2.length >= 25 && l3.length >= 25) {
            // Robust checks that don't rely on the very first character being correct
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
 * Parses the extracted TD1 MRZ lines into standard fields.
 */
function parseMRZ(mrzLines) {
    let [line1, line2, line3] = mrzLines;
    
    let line1Clean = line1.replace(/\s+/g, '');
    let nin = "";
    
    if (line1Clean.length >= 29) {
        nin = line1Clean.substring(15, 29).replace(/</g, '').replace(/O/g, '0');
    } else {
        let m1 = line1Clean.match(/[A-Z]{2}\d{8}[A-Z0-9]{4}/);
        if (m1) nin = m1[0].replace(/O/g, '0');
    }

    let line2Clean = line2.replace(/\s+/g, '');
    let dobRaw = line2Clean.substring(0, 6).replace(/[DO]/g, '0').replace(/I/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
    let sexRaw = line2Clean.substring(7, 8);
    let nationality = line2Clean.substring(15, 18).replace(/</g, '');

    let line3Clean = line3.replace(/\s+/g, '<');
    
    // Aggressively fix OCR hallucinations of the '<<' name separator (e.g. LKK, KKL, KLK)
    line3Clean = line3Clean.replace(/([A-Z]{3,})(LKK|KKL|LKL|KKK|LLL|KLK|LKC|KLC)([A-Z]{3,})/g, "$1<<$3");
    
    let surname = '';
    let givenName = '';

    let parts = line3Clean.split(/<+/).filter(p => p.length > 0);
    
    function cleanNamePart(name) {
        // Strip common MRZ bracket hallucinations (K, L, E, C, 8, 7) ONLY if followed by a consonant that doesn't form a valid English/Ugandan cluster
        // Consonants excluded: L, R, H, W, Y (because CL, CR, CH, KW are valid)
        return name.replace(/^[KLEC87]+(?=[BCDFGJKMNPQSTVXZ])/g, "");
    }

    if (parts.length > 0) surname = cleanNamePart(parts[0]);
    if (parts.length > 1) {
        let validNames = parts.slice(1).filter(p => {
            if (/^[KLEC87]+$/.test(p)) return false;
            if (p === 'SK') return false;
            return true;
        });
        givenName = validNames.map(cleanNamePart).join(' ');
    }

    let dob = '';
    if (dobRaw && dobRaw.length === 6 && !isNaN(parseInt(dobRaw))) {
        let year = parseInt(dobRaw.substring(0, 2), 10);
        let monthStr = dobRaw.substring(2, 4);
        let dayStr = dobRaw.substring(4, 6);
        
        // Aggressive OCR Error Fixing for Dates
        if (parseInt(monthStr, 10) > 12) {
            monthStr = monthStr.replace(/[689C]/g, '0');
            if (parseInt(monthStr, 10) > 12) monthStr = '01';
        }
        if (parseInt(dayStr, 10) > 31 || parseInt(dayStr, 10) === 0) {
            dayStr = dayStr.replace(/[689C]/g, '0');
            if (parseInt(dayStr, 10) > 31 || parseInt(dayStr, 10) === 0) dayStr = '01';
        }
        
        let currentYear2Digit = new Date().getFullYear() % 100;
        let fullYear = (year > currentYear2Digit) ? (1900 + year) : (2000 + year);
        dob = `${fullYear}-${monthStr}-${dayStr}`;
    }

    // Check NIN for authoritative Sex if OCR fails
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
