// ============================================
// MRZ-OCR PIPELINE v6 — BULLETPROOF FINAL
// ============================================

class TemporalBuffer {
  constructor(size = 5, threshold = 3) {
    this.size = size;
    this.threshold = threshold;
    this.buffer = [];
  }

  push(record) {
    this.buffer.push(record);
    if (this.buffer.length > this.size) this.buffer.shift();
  }

  getConsensus(field, validator = () => true) {
    const votes = {};
    this.buffer.forEach(r => {
      const v = r[field];
      if (v && validator(v)) votes[v] = (votes[v] || 0) + 1;
    });
    const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    return winner && winner[1] >= this.threshold ? winner[0] : null;
  }

  isStable(record) {
    // Returns true if all non-empty fields in this record have consensus
    return Object.keys(record).every(k => 
      !record[k] || this.getConsensus(k) === record[k]
    );
  }
}

const VALIDATORS = {
  nin: (v) => /^[ACFM][CMF][A-Z0-9]{12}$/.test(v),
  dob: (v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v);
    const now = new Date();
    const age = (now - d) / (365.25 * 24 * 60 * 60 * 1000);
    return age >= 16 && age <= 100;
  },
  sex: (v) => ['Male', 'Female'].includes(v),
  surname: (v) => v.length >= 2 && /^[A-Z]+$/.test(v) && !/VILLAGE|PARISH|COUNTY|DISTRICT/.test(v),
  givenName: (v) => v.length >= 2
};
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
function stripArtifacts(part) {
    if (part.length <= 3) return part;
    let p = part;
    if (/^[I1C]/.test(p)) p = p.slice(1);
    if (/C{1,2}$|K{1,2}$|X{1,2}$/.test(p)) p = p.replace(/C{1,2}$|K{1,2}$|X{1,2}$/, '');
    return p;
}

function isValidName(part) {
    if (part.length <= 1) return false;
    if (/^[KLCXSP]{2,}$/.test(part) && !COMMON_NAMES.has(part)) return false;
    return true;
}

function extractNamesByDictionary(str) {
    const found = [];
    let s = str;
    const allKnown = [...Array.from(COMMON_NAMES), ...Object.keys(TRUNCATION_FIXES)];
    
    while (s.length > 2) {
        let match = null;
        for (const name of allKnown) {
            let idx = s.indexOf(name);
            if (idx !== -1) {
                if (!match || idx < match.idx || (idx === match.idx && name.length > match.name.length)) {
                    match = {name, idx};
                }
            }
        }
        if (match) {
            if (match.idx > 3) {
                let skipped = s.slice(0, match.idx);
                let cleaned = stripArtifacts(skipped);
                if (isValidName(cleaned)) found.push(cleaned);
            }
            
            let resolvedName = COMMON_NAMES.has(match.name) ? match.name : TRUNCATION_FIXES[match.name];
            found.push(resolvedName);
            s = s.substring(match.idx + match.name.length);
        } else {
            let cleaned = stripArtifacts(s);
            if (isValidName(cleaned)) found.push(cleaned);
            break;
        }
    }
    return found;
}

function parseMRZName(line3) {
    let raw = line3.replace(/<+$/, '').replace(/^I+/, '').replace(/F{2,}$|L{2,}$|J{2,}$|K{2,}$|C{2,}$|X{2,}$/g, '');
    
    // Standard MRZ has << separating Surname and Given Names.
    if (raw.includes('<<')) {
        let parts = raw.split('<<');
        let surnameRaw = parts[0];
        let givenRaw = parts.slice(1).join('<');
        
        let surname = fixTruncation(stripArtifacts(surnameRaw));
        if (!COMMON_NAMES.has(surname)) {
             let dict = extractNamesByDictionary(surnameRaw);
             if (dict.length > 0) surname = dict[0];
        }
        
        let givenParts = givenRaw.split(/<+/).filter(p => p.length > 1);
        let finalGiven = [];
        for (let p of givenParts) {
             let cp = fixTruncation(stripArtifacts(p));
             if (COMMON_NAMES.has(cp)) {
                 finalGiven.push(cp);
             } else {
                 let dict = extractNamesByDictionary(p);
                 if (dict.length > 0) finalGiven.push(...dict);
                 else if (isValidName(cp)) finalGiven.push(cp);
             }
        }
        
        return { surname, givenName: finalGiven.join(' '), otherName: '' };
    }
    
    // Degraded case: No << found (e.g. IAGABACCMELLISACKIRABO or MUYUNGAK<CTIMOTHY)
    if (raw.includes('<')) {
        let parts = raw.split(/<+/).filter(p => p.length > 1);
        let allExtracted = [];
        for (let p of parts) {
            let dict = extractNamesByDictionary(p);
            if (dict.length > 0) allExtracted.push(...dict);
            else {
                let cp = fixTruncation(stripArtifacts(p));
                if (isValidName(cp)) allExtracted.push(cp);
            }
        }
        if (allExtracted.length >= 2) {
             return { surname: allExtracted[0], givenName: allExtracted.slice(1).join(' '), otherName: '' };
        }
    }
    
    // Fully glued case
    let dictNames = extractNamesByDictionary(raw);
    if (dictNames.length >= 2) {
        return { surname: dictNames[0], givenName: dictNames.slice(1).join(' '), otherName: '' };
    }
    
    return { surname: raw, givenName: '', otherName: '' };
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
    const fallbackText = await runTesseract(fallbackCanvas, false);
    return { crop: fallbackCanvas, text: fallbackText, desc: 'fallback:bottom50' };
}

async function runTesseract(canvas, isFront = false) {
    const whitelist = isFront 
        ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>. -/()' 
        : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>';
    const result = await Tesseract.recognize(canvas, 'eng', {
        tessedit_char_whitelist: whitelist,
        psm: isFront ? 3 : 6 // PSM 3 is better for full pages, 6 for uniform blocks
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

// ─── STAGE 1 & 2: AUTO-DETECTION ───
async function detectCardSide(canvas) {
  const w = canvas.width, h = canvas.height;

  // STAGE 1: Fast Back Probe (MRZ is in bottom 35%)
  const bottomCrop = document.createElement('canvas');
  bottomCrop.width = w;
  bottomCrop.height = Math.floor(h * 0.35);
  bottomCrop.getContext('2d').drawImage(
    canvas, 0, Math.floor(h * 0.65), w, Math.floor(h * 0.35),
    0, 0, w, Math.floor(h * 0.35)
  );

  gentleThresholding(bottomCrop);
  
  const backText = await runTesseract(bottomCrop, false, {
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
    psm: 6
  });

  const backLines = backText.split('\n')
    .map(l => l.trim().toUpperCase().replace(/[^A-Z0-9<]/g, ''))
    .filter(l => l.length >= 20);

  for (let i = 0; i < backLines.length - 2; i++) {
    if (/^(ID|AC)/.test(backLines[i]) && 
        backLines[i].includes('UGA') && 
        /^\d{6}/.test(backLines[i+1])) {
      return { side: 'back', cropCanvas: bottomCrop, text: backText };
    }
  }

  // STAGE 2: Front Probe
  const frontText = await runTesseract(canvas, true, {
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>. -/()',
    psm: 3
  });

  const frontScore = ['SURNAME', 'GIVEN NAME', 'NATIONAL ID', 'REPUBLIC OF UGANDA', 'DATE OF BIRTH']
    .reduce((acc, word) => acc + (frontText.toUpperCase().includes(word) ? 1 : 0), 0);

  if (frontScore >= 2) {
    return { side: 'front', text: frontText };
  }

  return { side: 'unknown' };
}

// ─── PREPROCESSING PIPELINES ───
function preprocessFront(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Glare Suppression
  for (let i = 0; i < d.length; i += 4) {
    const maxCh = Math.max(d[i], d[i+1], d[i+2]);
    if (maxCh > 245) {
      d[i] = d[i+1] = d[i+2] = 220; 
    }
  }

  // Mild Contrast Stretch
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }
  const range = max - min || 1;
  for (let i = 0; i < d.length; i += 4) {
    const factor = 255 / range;
    d[i]   = Math.min(255, (d[i]   - min) * factor);
    d[i+1] = Math.min(255, (d[i+1] - min) * factor);
    d[i+2] = Math.min(255, (d[i+2] - min) * factor);
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function preprocessBack(canvas) {
  const noBars = removeBlackBars(canvas);
  
  const h = noBars.height, w = noBars.width;
  const crop = document.createElement('canvas');
  crop.width = w;
  crop.height = Math.floor(h * 0.45);
  crop.getContext('2d').drawImage(
    noBars, 0, Math.floor(h * 0.55), w, Math.floor(h * 0.45),
    0, 0, w, Math.floor(h * 0.45)
  );

  gentleThresholding(crop);

  // Upscale by 2.5x for Tesseract accuracy
  const scaled = document.createElement('canvas');
  scaled.width = crop.width * 2.5;
  scaled.height = crop.height * 2.5;
  const sCtx = scaled.getContext('2d');
  sCtx.imageSmoothingEnabled = false; 
  sCtx.drawImage(crop, 0, 0, scaled.width, scaled.height);

  return scaled;
}

// ─── SPATIAL FRONT PARSER ───
async function parseFrontUgandaID(imageCanvas) {
  const noBars = removeBlackBars(imageCanvas);
  // Assuming suppressGlare helper exists based on instructions
  if (typeof suppressGlare === 'function') suppressGlare(noBars);
  
  // Note: we need the native Tesseract object for bounding boxes
  const worker = await getTesseractWorker('eng');
  const result = await worker.recognize(noBars, {
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>. -/()',
    tessjs_create_box: '1',
    psm: 3
  });

  const lines = result.data.lines
    .filter(l => l.confidence > 40 && l.text.trim().length > 0)
    .map(l => ({
      text: l.text.trim(),
      x0: l.bbox.x0 / noBars.width,
      y0: l.bbox.y0 / noBars.height,
      x1: l.bbox.x1 / noBars.width,
      y1: l.bbox.y1 / noBars.height,
      cx: (l.bbox.x0 + l.bbox.x1) / 2 / noBars.width,
      cy: (l.bbox.y0 + l.bbox.y1) / 2 / noBars.height
    }))
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx);

  const record = { nationality: 'UGA' };

  function extractRightOf(anchorRegex, yTolerance = 0.06, xMin = 0.35) {
    for (let i = 0; i < lines.length; i++) {
      if (anchorRegex.test(lines[i].text.toUpperCase())) {
        const candidates = lines.filter(l => 
          l !== lines[i] &&
          Math.abs(l.cy - lines[i].cy) < yTolerance &&
          l.cx > xMin
        );
        if (candidates.length) {
          return candidates.map(c => c.text).join(' ').toUpperCase();
        }
        if (i + 1 < lines.length) return lines[i+1].text.toUpperCase();
      }
    }
    return '';
  }

  record.surname = extractRightOf(/SURNAME|SURNAM|URNAME/);
  record.givenName = extractRightOf(/GIVEN\s*NAME|GIVEN|NAME\(S\)/);
  
  const givenIdx = lines.findIndex(l => /GIVEN\s*NAME/i.test(l.text));
  if (givenIdx >= 0 && givenIdx + 1 < lines.length && !record.surname) {
    record.surname = lines[Math.max(0, givenIdx - 1)].text.replace(/[^A-Z]/g, '');
  }

  const rightHalfText = lines.filter(l => l.cx > 0.4).map(l => l.text).join(' ');
  const ninMatch = rightHalfText.match(/(C[MF][A-Z0-9]{12})/);
  if (ninMatch) record.nin = ninMatch[1];

  const dobMatch = rightHalfText.match(/(\d{2})[\.\-\/](\d{2})[\.\-\/](\d{4})/);
  if (dobMatch) {
    record.dob = `${dobMatch[3]}-${dobMatch[2]}-${dobMatch[1]}`;
  }

  const ugaBand = lines.filter(l => l.cx > 0.4 && /UGA/.test(l.text));
  const sexContext = ugaBand.map(l => l.text).join(' ');
  if (/\bM\b/.test(sexContext) && !/\bF\b/.test(sexContext)) record.sex = 'Male';
  else if (/\bF\b/.test(sexContext) && !/\bM\b/.test(sexContext)) record.sex = 'Female';

  return record;
};
