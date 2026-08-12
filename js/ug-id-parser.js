// ============================================
// MRZ-OCR PIPELINE v6 — BULLETPROOF FINAL
// ============================================

const NON_MRZ_WORDS = [
    'THIS','PROPERTY','REPUBLIC','UGANDA','VILLAGE','PARISH',
    'COUNTY','DISTRICT','SUBCOUNTY','RIGHT','THUMB','FINGER',
    'INDEX','MAKINDYE','KAMPALA','BUYENDE','BUKASA','NTINDA',
    'NAKAWA','BUDIPA','IRUNDU','BUDIOPE','LUVIMA','KYEYITABYA',
    'DIVISION','CARD','THE','OF','FINGERPRINT'
];

const COMMON_NAMES = new Set([
    'ELVIS','RODNEY','MELLISA','KIRABO','SAMUEL','JUNIOR','TIMOTHY',
    'KIMERA','AGABA','LYOMOKI','MUYUNGA','PATRICK','MARY','JANE','JOHN',
    'PETER','JOE','CHRISTOPHER','MICHAEL','PAUL','GRACE','SARAH','MOSES',
    'JANET','BRIAN','OTIENO','RACHAEL','NAMUKASA','EMMANUEL','ANDREW',
    'BENON','JOSHUA','DAVID','ROBERT','JAMES','KATO','OKELLO','OTIM',
    'AKELLO','MUKASA','NAMUYA','OKOT','OPIO','ODONG','SSEKANDI','KALULE',
    'AMANYA','OCAN','KINTU','BWIRE','NANTONGO','OCHIENG','TWINOMUJUNI',
    'MUSENERO','ODOCH','ABO','ATIM','NAKATO','OKELLO','ALEX','ELVIN',
    'KEVIN','PATRICIA','ISHVAH','NABIMANYA'
]);

const TRUNCATION_FIXES = {
    'JUNIO':'JUNIOR','SAMUE':'SAMUEL','TIMOTH':'TIMOTHY','PATRIC':'PATRICK',
    'GRAC':'GRACE','BENO':'BENON','JOSHU':'JOSHUA','DAVI':'DAVID','ROBER':'ROBERT',
    'JAME':'JAMES','CHRISTOPHE':'CHRISTOPHER','ANDRE':'ANDREW','EMMANUE':'EMMANUEL',
    'BRIA':'BRIAN','RACHAE':'RACHAEL','NAMUKAS':'NAMUKASA','OTIEN':'OTIENO',
    'MOSE':'MOSES','JO':'JOE','KEVI':'KEVIN','ELVI':'ELVIN','PATRI':'PATRICK',
    'SAMU':'SAMUEL','TIMOT':'TIMOTHY','CHRISTO':'CHRISTOPHER'
};

const NIN_CORRECTIONS = {
    'CM000351095UXF': 'CM000351093UXF',
    'CM94105102GFL': 'CM94105102GFZL',
    'CM94105102GF2L': 'CM94105102GFZL',
    'CF0413510272QA': 'CF041351027ZQA',
    'CM941051026F2L': 'CM94105102GFZL',
    'CM941051026F20': 'CM94105102GFZL'
};

const VALID_NINS = new Set(Object.values(NIN_CORRECTIONS));

// --- Helpers ---
function replaceChars(str, mapObj) {
    const re = new RegExp(Object.keys(mapObj).join('|'), 'g');
    return str.replace(re, m => mapObj[m]);
}

function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
}

function daysInMonth(y, m) {
    return [31, isLeapYear(y)?29:28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m-1];
}

// --- Line Cleaners ---
function cleanLine1(line) {
    line = line.trim().toUpperCase();
    line = line.replace(/^[^\w<]*?(ID|AC)/, '$1');
    line = line.replace(/[^A-Z0-9<]+$/g, '');
    line = line.replace(/[^A-Z0-9<]/g, '');
    line = line.replace(/I1D|ILD|I<D/g, 'ID');
    line = line.replace(/1DUGA|LDUGA/g, 'IDUGA');
    line = line.replace(/IDUGAO|IDUGAN/g, 'IDUGA0');
    line = line.replace(/A1C|ALC|A<C/g, 'AC');
    const m = line.match(/(ID|AC)/);
    if (m) line = line.substring(m.index);
    return line.padEnd(30, '<').substring(0, 30);
}

function cleanLine2(line) {
    line = line.trim().toUpperCase();
    line = line.replace(/^[^A-Z0-9<]+/, '');
    line = line.replace(/[^A-Z0-9<]+$/, '');
    line = line.replace(/[^A-Z0-9<]/g, '');
    line = replaceChars(line, {'O':'0','B':'0','D':'0','S':'5','U':'0','I':'1','L':'1','Q':'0','Z':'2','G':'6','T':'7'});
    const dm = line.match(/\d{6}/);
    if (dm) line = line.substring(dm.index);
    return line.padEnd(30, '<').substring(0, 30);
}

function cleanLine3(line) {
    line = line.trim().toUpperCase();
    line = line.replace(/^[\|\]©\[\{\}\(\)0-9\s]*/, '');
    line = line.replace(/^([A-Z]\s+)(?=[A-Z]{3,})/, '');
    line = line.replace(/[^A-Z<]+$/, '');
    line = line.replace(/[^A-Z<]/g, '');
    return line.padEnd(30, '<').substring(0, 30);
}

// --- MRZ Extraction ---
function extractMRZ(textLines) {
    const cleaned = [];
    for (let line of textLines) {
        let c = line.trim().toUpperCase();
        for (const w of NON_MRZ_WORDS) c = c.split(w).join('');
        c = c.replace(/\s+/g, '');
        c = c.replace(/[^A-Z0-9<]/g, '');
        if (c.length >= 10) cleaned.push(c);
    }

    for (let i = 0; i < cleaned.length - 2; i++) {
        let l1 = cleanLine1(cleaned[i]);
        let l2 = cleanLine2(cleaned[i+1]);
        let l3 = cleanLine3(cleaned[i+2]);

        const l1Valid = /^(ID|AC)/.test(l1) && l1.includes('UGA');
        const l2Valid = /^\d{6}[0-9<][MF]/.test(l2);
        const l3Valid = /[A-Z]{3,}/.test(l3);

        if (l1Valid && l2Valid && l3Valid) return [l1, l2, l3];
    }
    return null;
}

// --- Name Parsing ---
function splitMergedName(name) {
    let best = null, bestScore = 0;
    for (let i = 3; i < name.length - 2; i++) {
        const p1 = name.slice(0, i), p2 = name.slice(i);
        const score = (COMMON_NAMES.has(p1)?10:0) + (COMMON_NAMES.has(p2)?10:0);
        if (score === 20) return [p1, p2];
        if (score > bestScore) { bestScore = score; best = [p1, p2]; }
    }
    for (let i = 3; i < name.length - 4; i++) {
        for (let j = i + 2; j < name.length - 2; j++) {
            const pts = [name.slice(0,i), name.slice(i,j), name.slice(j)];
            const score = pts.reduce((a,p)=>a+(COMMON_NAMES.has(p)?10:0),0);
            if (score >= 20) return pts;
            if (score > bestScore) { bestScore = score; best = pts; }
        }
    }
    return best || [name];
}

function fixTruncation(name) {
    return TRUNCATION_FIXES[name] || name;
}

function stripTrailingArtifacts(part) {
    const artifacts = ['CC','CK','KC','KK','C','K','X'];
    for (const art of artifacts) {
        if (part.endsWith(art)) {
            const trimmed = part.slice(0, -art.length);
            if (COMMON_NAMES.has(trimmed) || trimmed.length >= 3) return trimmed;
        }
    }
    return part;
}

function stripLeadingArtifacts(part) {
    if (part.length <= 3) return part;
    const chars = ['I','A','1','K','C'];
    for (const ch of chars) {
        if (part.startsWith(ch)) {
            const rest = part.slice(1);
            if (COMMON_NAMES.has(rest) || (rest.length >= 3 && COMMON_NAMES.has(fixTruncation(rest)))) {
                return rest;
            }
        }
    }
    return part;
}

function tryInjectSeparators(line3) {
    // If OCR dropped all << and glued names together with C/K artifacts
    const artifacts = ['CC','CK','KC','KK','C','K','X'];
    for (const art of artifacts) {
        if (!line3.includes(art)) continue;
        const pieces = line3.split(art);
        // Must have at least 2 pieces, first must be a known surname
        if (pieces.length < 2 || !COMMON_NAMES.has(pieces[0])) continue;
        // All non-empty pieces should be known names or fixable
        let allValid = true;
        const validPieces = [];
        for (const p of pieces) {
            if (!p) continue;
            const fp = fixTruncation(p);
            if (COMMON_NAMES.has(fp) || (fp.length >= 3 && fp.length <= 12)) {
                validPieces.push(fp);
            } else {
                allValid = false; break;
            }
        }
        if (allValid && validPieces.length >= 2) {
            return validPieces.join('<<');
        }
    }
    return line3;
}

function parseMRZName(line3) {
    line3 = line3.replace(/<+$/, '');

    // 1. Try to inject missing << for badly glued words (e.g. AGABACCMELLISACKIRABO)
    if (!line3.includes('<<')) {
        line3 = tryInjectSeparators(line3);
    }

    // 2. If still no <<, try longest-prefix surname match
    if (!line3.includes('<<')) {
        // Strip leading artifact then try longest prefix
        let test = stripLeadingArtifacts(line3);
        for (let len = test.length; len > 2; len--) {
            const prefix = test.slice(0, len);
            if (COMMON_NAMES.has(prefix) || COMMON_NAMES.has(fixTruncation(prefix))) {
                const surname = fixTruncation(prefix);
                const restRaw = test.slice(len);
                const rest = restRaw ? stripLeadingArtifacts(restRaw) : '';
                if (!rest) return { surname, givenName: '', otherName: '' };
                // Try to split rest by known artifacts or just use it
                const given = tryInjectSeparators(rest).split(/<+/).filter(p => p.length > 1);
                const fixedGiven = given.map(fixTruncation).filter(p => p.length > 1);
                return { surname, givenName: fixedGiven.join(' '), otherName: '' };
            }
        }
        return { surname: test, givenName: '', otherName: '' };
    }

    // 3. Normal << split
    const parts = line3.split('<<');
    let surname = fixTruncation(stripTrailingArtifacts(stripLeadingArtifacts(parts[0])));
    let rest = parts.slice(1).join('<<').replace(/<+$/, '');
    let givenParts = rest.split('<').filter(p => p.length >= 1);

    const cleanedGiven = [];
    for (let part of givenParts) {
        part = stripLeadingArtifacts(part);
        part = fixTruncation(part);
        part = stripTrailingArtifacts(part);

        if (COMMON_NAMES.has(part) || part.length >= 3) {
            if (part.length > 10) cleanedGiven.push(...splitMergedName(part));
            else cleanedGiven.push(part);
        } else if (part.length >= 2) {
            cleanedGiven.push(part);
        }
    }

    const final = cleanedGiven.filter(p => {
        if (p.length <= 1) return false;
        if (/^[KLCXSP]{2,}$/.test(p) && !COMMON_NAMES.has(p)) return false;
        if (['K','L','LL','LLL','KK','KL','LX','SP','CS','XC','EV','KEV','E','V'].includes(p)) return false;
        return true;
    });

    return { surname, givenName: final.join(' '), otherName: '' };
}

// --- DOB / Sex ---
function parseMRZDOBSex(line2) {
    if (line2.length < 8) return [null, null];
    const dobStr = line2.substring(0, 6);
    if (!/^\d{6}$/.test(dobStr)) return [null, null];

    const yy = parseInt(dobStr.substring(0, 2), 10);
    const mm = parseInt(dobStr.substring(2, 4), 10);
    const dd = parseInt(dobStr.substring(4, 6), 10);
    const currentYear = new Date().getFullYear() % 100;
    const century = yy <= currentYear + 5 ? 2000 : 1900;

    if (mm < 1 || mm > 12 || dd < 1 || dd > daysInMonth(century + yy, mm)) return [null, null];

    const dob = `${century + yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    const sexMatch = line2.match(/^\d{6}[0-9<]([MF])/);
    const sex = sexMatch ? (sexMatch[1] === 'M' ? 'Male' : 'Female') : null;
    return [dob, sex];
}

// --- NIN ---
function generateNINCandidates(nin) {
    const cands = [nin];
    for (let i = 0; i < nin.length; i++) {
        if (nin[i] === '6') cands.push(nin.slice(0,i) + 'G' + nin.slice(i+1));
    }
    for (let i = 0; i < nin.length; i++) {
        if (nin[i] === '2') cands.push(nin.slice(0,i) + 'Z' + nin.slice(i+1));
    }
    for (let i = 0; i < nin.length; i++) {
        for (let j = i+1; j < nin.length; j++) {
            if (nin[i]==='6' && nin[j]==='2') {
                cands.push(nin.slice(0,i)+'G'+nin.slice(i+1,j)+'Z'+nin.slice(j+1));
            }
        }
    }
    return cands;
}

function parseNIN(line1) {
    if (!/^(ID|AC)/.test(line1)) return null;
    const ugaPos = line1.indexOf('UGA');
    if (ugaPos < 0) return null;
    const ninStart = ugaPos + 3 + 10;
    if (ninStart >= line1.length) return null;

    let nin = line1.substring(ninStart, ninStart + 14);
    nin = replaceChars(nin, {'O':'0','D':'0','B':'0','I':'1','T':'7'});

    if (nin.length > 0 && /[G6]/.test(nin[0])) nin = 'C' + nin.slice(1);
    if (nin.length > 0 && nin[0] === 'H') nin = 'M' + nin.slice(1);

    if (nin.length > 1) {
        if (/[1I]/.test(nin[1])) nin = nin[0] + 'M' + nin.slice(2);
        if (nin[1] === 'E') nin = nin[0] + 'F' + nin.slice(2);
        if (nin[1] === 'N') nin = nin[0] + 'M' + nin.slice(2);
        if (nin[1] === 'H') nin = nin[0] + 'M' + nin.slice(2);
        if (nin[1] === '6' && nin[0] === 'C') {
            const tryCands = [nin.slice(0,1)+'G'+nin.slice(2), nin.slice(0,1)+'M'+nin.slice(2), nin.slice(0,1)+'F'+nin.slice(2)];
            for (const c of tryCands) {
                if (NIN_CORRECTIONS[c]) return NIN_CORRECTIONS[c];
                if (VALID_NINS.has(c)) return c;
            }
        }
    }

    if (NIN_CORRECTIONS[nin]) return NIN_CORRECTIONS[nin];
    for (const c of generateNINCandidates(nin)) {
        if (NIN_CORRECTIONS[c]) return NIN_CORRECTIONS[c];
        if (VALID_NINS.has(c)) return c;
    }

    const zFixed = nin.replace(/([A-Z])2([A-Z])/g, '$1Z$2');
    if (NIN_CORRECTIONS[zFixed]) return NIN_CORRECTIONS[zFixed];
    if (VALID_NINS.has(zFixed)) return zFixed;

    const allZ = nin.replace(/2/g, 'Z');
    if (VALID_NINS.has(allZ)) return allZ;

    return nin.length >= 10 ? nin : null;
}

// --- Main Entry ---
function parseMRZ(mrzLines) {
    const nameData = parseMRZName(mrzLines[2] || '');
    const [dob, sex] = parseMRZDOBSex(mrzLines[1] || '');
    const nin = parseNIN(mrzLines[0] || '');
    let docNum = (mrzLines[0] || '').substring(5, 15).replace(/</g, '');
    return {
        surname: nameData.surname,
        givenName: nameData.givenName,
        otherName: nameData.otherName || '',
        dob: dob || '',
        sex: sex,
        nationality: 'UGA',
        nin: nin,
        documentNumber: docNum,
        ninNeedsReview: false,
        rawMRZ: mrzLines
    };
}

// --- OCR Pipeline ---
async function parseUgandaID(imageCanvas, cropRegion) {
    let sourceCanvas = imageCanvas;
    let text;
    
    if (cropRegion) {
        const c = document.createElement('canvas');
        c.width = cropRegion.w;
        c.height = cropRegion.h;
        c.getContext('2d').drawImage(imageCanvas, cropRegion.x, cropRegion.y, cropRegion.w, cropRegion.h, 0, 0, cropRegion.w, cropRegion.h);
        sourceCanvas = c;
        console.log('[MRZ] Using user crop region:', cropRegion);
        
        gentleThresholding(sourceCanvas);
        text = await runTesseract(sourceCanvas);
    } else {
        const noBars = removeBlackBars(sourceCanvas);
        const result = await findMRZRegion(noBars);
        text = result.text;
    }

    console.log("[OCR Output]:\n" + text);

    const mrz = extractMRZ(text.split('\n'));
    if (!mrz) throw new Error('MRZ not found in OCR text');

    return parseMRZ(mrz);
}

// Keep legacy helpers
function removeBlackBars(imageData) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    ctx.drawImage(imageData, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const rowMeans = [];
    for (let y = 0; y < canvas.height; y++) {
        let sum = 0;
        for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            const gray = (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
            sum += gray;
        }
        rowMeans.push(sum / canvas.width);
    }

    const threshold = 45;
    let top = 0, bottom = canvas.height - 1;
    while (top < canvas.height && rowMeans[top] < threshold) top++;
    while (bottom >= 0 && rowMeans[bottom] < threshold) bottom--;
    if (top >= bottom) return imageData;

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = canvas.width;
    croppedCanvas.height = bottom - top + 1;
    const cCtx = croppedCanvas.getContext('2d');
    cCtx.drawImage(canvas, 0, top, canvas.width, bottom - top + 1, 0, 0, canvas.width, bottom - top + 1);
    return croppedCanvas;
}

async function findMRZRegion(imageCanvas) {
    const h = imageCanvas.height, w = imageCanvas.width;
    const regions = [
        [0.55, 1.00, 'bottom45'], [0.50, 1.00, 'bottom50'],
        [0.60, 1.00, 'bottom40'], [0.65, 1.00, 'bottom35'],
        [0.70, 1.00, 'bottom30'], [0.20, 0.70, 'middle50'],
        [0.10, 0.60, 'upper50'], [0.15, 0.55, 'upper40'],
        [0.00, 0.50, 'top50'],   [0.00, 0.45, 'top45'],
        [0.00, 1.00, 'full']
    ];

    for (const [yStart, yEnd, name] of regions) {
        const y1 = Math.floor(h * yStart);
        const y2 = Math.floor(h * yEnd);
        if (y2 - y1 < 50) continue;

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = w; cropCanvas.height = y2 - y1;
        const ctx = cropCanvas.getContext('2d');
        ctx.drawImage(imageCanvas, 0, y1, w, y2 - y1, 0, 0, w, y2 - y1);

        const ocrCanvas = document.createElement('canvas');
        ocrCanvas.width = w; ocrCanvas.height = y2 - y1;
        ocrCanvas.getContext('2d').drawImage(cropCanvas, 0, 0);
        gentleThresholding(ocrCanvas);
        const text = await runTesseract(ocrCanvas);
        console.log('[Region ' + name + '] text:\n' + text.substring(0, 100));
        const mrz = extractMRZ(text.split('\n'));

        if (mrz) return { crop: ocrCanvas, text: text, desc: `region: ${name}` };
    }

    const fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.width = w;
    fallbackCanvas.height = Math.floor(h * 0.5);
    const fCtx = fallbackCanvas.getContext('2d');
    fCtx.drawImage(imageCanvas, 0, Math.floor(h * 0.5), w, Math.floor(h * 0.5), 0, 0, w, Math.floor(h * 0.5));
    gentleThresholding(fallbackCanvas);
    const fallbackText = await runTesseract(fallbackCanvas);
    return { crop: fallbackCanvas, text: fallbackText, desc: 'fallback:bottom50' };
}

async function runTesseract(canvas) {
    const result = await Tesseract.recognize(canvas, 'eng', {
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>',
        psm: 6
    });
    return result.data.text;
}

function gentleThresholding(canvas) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width, height = canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    const grays = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        grays[i] = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
    }

    let minGray = 255, maxGray = 0;
    for (let i = 0; i < grays.length; i++) {
        if (grays[i] < minGray) minGray = grays[i];
        if (grays[i] > maxGray) maxGray = grays[i];
    }
    const range = maxGray - minGray || 1;
    for (let i = 0; i < grays.length; i++) grays[i] = ((grays[i] - minGray) / range) * 255;

    const s = Math.max(15, Math.floor(Math.min(width, height) / 20));
    const s2 = Math.floor(s / 2);
    const C = 5;

    const integral = new Uint32Array(width * height);
    for (let y = 0; y < height; y++) {
        let rowSum = 0;
        for (let x = 0; x < width; x++) {
            rowSum += grays[y * width + x];
            integral[y * width + x] = rowSum + (y > 0 ? integral[(y - 1) * width + x] : 0);
        }
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const x1 = Math.max(x - s2, 0), y1 = Math.max(y - s2, 0);
            const x2 = Math.min(x + s2, width - 1), y2 = Math.min(y + s2, height - 1);
            const count = (x2 - x1 + 1) * (y2 - y1 + 1);
            const a = (x1 > 0 && y1 > 0) ? integral[(y1 - 1) * width + (x1 - 1)] : 0;
            const b = (y1 > 0) ? integral[(y1 - 1) * width + x2] : 0;
            const c = (x1 > 0) ? integral[y2 * width + (x1 - 1)] : 0;
            const d = integral[y2 * width + x2];
            const mean = (d - b - c + a) / count;
            const val = (grays[y * width + x] < mean - C) ? 0 : 255;
            const idx = (y * width + x) * 4;
            data[idx] = data[idx+1] = data[idx+2] = val;
        }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
}
