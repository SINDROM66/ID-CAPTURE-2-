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
        let { data: { text } } = await worker.recognize(image);
        let mrzData = extractMRZ(text);

        // Pass 2: Fallback. Assume a single uniform block of text (psm: 6)
        // Extremely effective at ignoring background objects like keyboards
        if (!mrzData) {
            console.log("Pass 1 failed, retrying with psm: 6...");
            await worker.setParameters({ tessedit_pageseg_mode: '6' });
            let result2 = await worker.recognize(image);
            text = result2.data.text;
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
    const lines = text.split('\n').map(l => l.replace(/\s+/g, '').toUpperCase());
    
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
    
    // Line 1: IDUGA...
    let line1Clean = line1.replace(/\s+/g, '');
    // NIN starts at index 15 and is exactly 14 characters long. We drop the 15th check digit.
    let nin = line1Clean.substring(15, 29).replace(/</g, '');
    // Replace letter 'O' with number '0' as per Ugandan NIN rules
    nin = nin.replace(/O/g, '0');
    
    if (nin.startsWith('CM0')) {
        // Just ensuring it starts correctly if there are other artifacts
    }

    // Line 2: DOB, Sex, Nationality
    let line2Clean = line2.replace(/\s+/g, '');
    let dobRaw = line2Clean.substring(0, 6)
        .replace(/D/g, '0')
        .replace(/O/g, '0')
        .replace(/I/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/Z/g, '2');
        
    let sexRaw = line2Clean.substring(7, 8);
    let nationality = line2Clean.substring(15, 18).replace(/</g, '');

    // Line 3: Surname and Given Names
    let line3Clean = line3.replace(/\s+/g, '<'); // Normalize spaces to <
    // Extract everything before the first sequence of 3 or more < (which indicates padding)
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
            givenName = '';
        }
    }

    surname = surname.replace(/</g, ' ').trim();
    givenName = givenName.replace(/</g, ' ').trim();

    // Clean up common OCR artifacts where '<<' is read as '<SK' or 'SK'
    if (givenName.startsWith('SK ') || givenName.startsWith('SK')) {
        // Only strip if the remaining name is valid
        let possibleClean = givenName.substring(2).trim();
        if (possibleClean.length > 2) {
            givenName = possibleClean;
        }
    }

    // Parse DOB to standard YYYY-MM-DD
    let dob = '';
    if (dobRaw && dobRaw.length === 6 && !isNaN(parseInt(dobRaw))) {
        let year = parseInt(dobRaw.substring(0, 2), 10);
        let month = dobRaw.substring(2, 4);
        let day = dobRaw.substring(4, 6);
        
        let currentYear2Digit = new Date().getFullYear() % 100;
        let fullYear = (year > currentYear2Digit) ? (1900 + year) : (2000 + year);
        dob = `${fullYear}-${month}-${day}`;
    }

    return {
        surname: surname,
        givenName: givenName,
        otherName: "",
        sex: sexRaw === 'M' ? 'Male' : (sexRaw === 'F' ? 'Female' : sexRaw),
        dateOfBirth: dob,
        nationality: nationality,
        nin: nin,
        phoneNumber: ""
    };
}
