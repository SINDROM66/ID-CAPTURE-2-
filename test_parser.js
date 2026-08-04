const fs = require('fs');

// Raw text from test log for new_id_back.jpg
const rawTextNew = `DISTRICT BUYENDE PARISH BUDIFA FLH
COUNTY  BUDIOPE EAST MIRAE ER ADARAN
SHR IRUNDU FERAR LINDE R J 5 EE
EERE BER ENE ES LTE
NS AR TH
5 EAN DS 2
HA SH E FL
EOE ER CN ERR FER HBR
IDUGA1321896642CM0208310AU7AEK<
D204174M3511048UGA<LLLLLLLLLLT
BUYUNGA<SKTIMOTHY <<< CLLLLCLL
`;

function extractMRZ(text) {
    const lines = text.split('\n').map(l => l.replace(/\s+/g, '').toUpperCase());
    
    for (let i = 0; i < lines.length - 2; i++) {
        const l1 = lines[i];
        const l2 = lines[i+1];
        const l3 = lines[i+2];

        if (l1.startsWith('IDUGA') && l1.length >= 28 && l2.length >= 28 && l3.length >= 28) {
            return [l1, l2, l3];
        }
    }
    return null;
}

function parseMRZ(mrzLines) {
    let [line1, line2, line3] = mrzLines;
    
    // Line 1: IDUGA...
    let line1Clean = line1.replace(/\s+/g, '');
    let nin = line1Clean.substring(15, 29).replace(/</g, '');
    nin = nin.replace(/O/g, '0');
    
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
            givenName = '';
        }
    }

    surname = surname.replace(/</g, ' ').trim();
    givenName = givenName.replace(/</g, ' ').trim();

    if (givenName.startsWith('SK ') || givenName.startsWith('SK')) {
        let possibleClean = givenName.substring(2).trim();
        if (possibleClean.length > 2) {
            givenName = possibleClean;
        }
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

    return {
        surname: surname,
        givenName: givenName,
        sex: sexRaw === 'M' ? 'Male' : (sexRaw === 'F' ? 'Female' : sexRaw),
        dateOfBirth: dob,
        nationality: nationality,
        nin: nin
    };
}

const lines = extractMRZ(rawTextNew);
if (lines) {
    console.log("MRZ Extracted:", lines);
    console.log("Parsed Data:", JSON.stringify(parseMRZ(lines), null, 2));
} else {
    console.log("Failed to extract MRZ");
}
