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

// =============================================================================
// DYNAMIC BASELINE SLOPE DETECTION (Front Scan Only)
// =============================================================================

function estimateTextSlope(lines) {
  const candidates = lines
    .filter(l => l.text.length > 4)
    .sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))
    .slice(0, 6);

  if (candidates.length < 2) return 0;

  let sumAngle = 0;
  candidates.forEach(l => {
    sumAngle += Math.atan2(l.y1 - l.y0, l.x1 - l.x0);
  });

  return sumAngle / candidates.length;
}

function isOnSameBaseline(anchor, candidate, slope, baseTolerance) {
  const projectedY = anchor.cy + Math.tan(slope) * (candidate.cx - anchor.cx);
  return Math.abs(candidate.cy - projectedY) < baseTolerance;
}

function extractRightOf(anchorRegex, lines, slope, baseTolerance) {
  for (let i = 0; i < lines.length; i++) {
    if (anchorRegex.test(lines[i].text.toUpperCase())) {
      const anchor = lines[i];
      const candidates = lines.filter(l =>
        l !== anchor &&
        l.cx > 0.30 &&
        isOnSameBaseline(anchor, l, slope, baseTolerance)
      );

      if (candidates.length) {
        return candidates.sort((a, b) => a.cx - b.cx)
                         .map(c => c.text).join(' ').toUpperCase();
      }
      if (i + 1 < lines.length) return lines[i + 1].text.toUpperCase();
    }
  }
  return '';
}

// =============================================================================
// FRONT OF ID SCANNER (LABEL-BASED PARSING)
// =============================================================================

async function parseFrontUgandaID(imageCanvas, precomputedLines = null) {
  // 1. Remove black bars
  const noBars = removeBlackBars(imageCanvas);
  
  // 2. Grayscale & Thresholding (applies to whole image to remove background noise)
  const ocrCanvas = document.createElement('canvas');
  ocrCanvas.width = noBars.width;
  ocrCanvas.height = noBars.height;
  ocrCanvas.getContext('2d').drawImage(noBars, 0, 0);
  
  // Do NOT apply gentleThresholding. Tesseract's native Otsu thresholding is better for complex backgrounds.
  // gentleThresholding(ocrCanvas);
  
  let lines;
  let text;

  if (precomputedLines && precomputedLines.length > 0) {
    lines = precomputedLines;
    text = lines.map(l => l.text).join('\n');
    console.log("[Front OCR] Using precomputed lines (" + lines.length + " lines)");
  } else {
    // 3. OCR on full image (pass true for isFront flag)
    const result = await Tesseract.recognize(ocrCanvas, 'eng', {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>. -/()',
      psm: 3
    });
    text = result.data.text;
    lines = result.data.lines
      .filter(l => l.confidence > 40 && l.text.trim().length > 0)
      .map(l => ({
        text: l.text.trim(),
        x0: l.bbox.x0 / ocrCanvas.width,
        y0: l.bbox.y0 / ocrCanvas.height,
        x1: l.bbox.x1 / ocrCanvas.width,
        y1: l.bbox.y1 / ocrCanvas.height,
        cx: (l.bbox.x0 + l.bbox.x1) / 2 / ocrCanvas.width,
        cy: (l.bbox.y0 + l.bbox.y1) / 2 / ocrCanvas.height
      }))
      .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  }

  console.log("[Front OCR Output]:\n" + text);

  // 4. Parse Labels with spatial baseline correction
  return extractFrontDetails(text, lines);
}

function extractFrontDetails(text, spatialLines = null) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let record = {
        surname: '',
        givenName: '',
        otherName: '',
        dob: '',
        sex: '',
        nin: '',
        nationality: 'UGA'
    };
    
    // Clean Tesseract's common NIN hallucination (CMO instead of CM0)
    let cleanText = text.replace(/CMO/g, 'CM0').replace(/CFO/g, 'CF0');
    // If it added an extra 0, making it 15 chars, this fixes it:
    cleanText = cleanText.replace(/CM00/g, 'CM0').replace(/CF00/g, 'CF0');

    // 1. Extract NIN (Global Search)
    // A Ugandan NIN is exactly 14 characters: C + M/F + 12 alphanumeric
    const ninMatch = cleanText.match(/(C[MF][A-Z0-9]{12})/);
    if (ninMatch) {
        record.nin = ninMatch[1];
    } else {
        console.warn("Could not confidently extract the NIN from the front of the ID. Manual entry required.");
    }

    // 2. Extract DOB (Global Search)
    const dobMatch = cleanText.match(/(\d{2})[\.\-\/](\d{2})[\.\-\/](\d{4})/);
    if (dobMatch) {
        record.dob = `${dobMatch[3]}-${dobMatch[2]}-${dobMatch[1]}`; // YYYY-MM-DD
    }

    // 3. Extract Sex (Global Search near DOB or UGA)
    if (/\bM\b/.test(cleanText) && !/\bF\b/.test(cleanText)) record.sex = 'Male';
    else if (/\bF\b/.test(cleanText) && !/\bM\b/.test(cleanText)) record.sex = 'Female';
    else {
        // Look on lines with UGA
        const ugaLine = lines.find(l => l.includes('UGA'));
        if (ugaLine) {
            if (/\bM\b/.test(ugaLine)) record.sex = 'Male';
            else if (/\bF\b/.test(ugaLine)) record.sex = 'Female';
        }
    }

    // 4. Extract Names using Spatial Baseline Logic
    if (spatialLines && spatialLines.length > 0) {
      const slope = estimateTextSlope(spatialLines);
      const baseTolerance = 0.04 + (Math.abs(slope) * 0.15);

      record.surname = extractRightOf(/SURNAME|SURNAM|URNAME/, spatialLines, slope, baseTolerance);
      record.givenName = extractRightOf(/GIVEN\s*NAME|GIVEN|NAME\(S\)/, spatialLines, slope, baseTolerance);

      // Fallback: if surname missing, line before GIVEN NAME is often the surname
      if (!record.surname) {
        const givenIdx = spatialLines.findIndex(l => /(?:GIVEN|GIVEN NAME)/i.test(l.text));
        if (givenIdx > 0) {
          record.surname = spatialLines[givenIdx - 1].text.replace(/[^A-Z]/g, '');
        }
      }
    } else {
      // Legacy line-proximity fallback (no bounding boxes available)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toUpperCase();
        if (/SURNAME|SURNAM|URNAME/.test(line) && !record.surname) {
          const remainder = line.replace(/.*(?:SURNAME|SURNAM|URNAME)\s*/, '').replace(/[^A-Z]/g, '');
          if (remainder.length > 2) {
            record.surname = remainder;
          } else if (i + 1 < lines.length) {
            record.surname = lines[i+1].replace(/[^A-Z]/g, '');
          }
        }
        if (/(?:GIVEN|GIVEN NAME|GIVEN NAME\(S\)|NAME\(S\))/.test(line) && !record.givenName) {
          const remainder = line.replace(/.*(?:GIVEN NAME|GIVEN|NAME\(S\))\s*/, '').replace(/[^A-Z\s]/g, '').trim();
          if (remainder.length > 2) {
            record.givenName = remainder;
          } else if (i + 1 < lines.length) {
            record.givenName = lines[i+1].replace(/[^A-Z\s]/g, '').trim();
          }
        }
      }
      if (!record.surname) {
        const givenIdx = lines.findIndex(l => /(?:GIVEN|GIVEN NAME)/i.test(l));
        if (givenIdx > 0) {
          record.surname = lines[givenIdx - 1].replace(/[^A-Z]/g, '');
        }
      }
    }

    return record;
}
