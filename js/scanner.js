const fileInputCamera = document.getElementById('input-camera');
const fileInputGallery = document.getElementById('input-gallery');
const triggerBtn = document.getElementById('trigger-upload');
const photoModal = document.getElementById('photo-modal');
const btnCamera = document.getElementById('btn-camera');
const btnGallery = document.getElementById('btn-gallery');
const btnCancelModal = document.getElementById('btn-cancel-modal');

const imagePreview = document.getElementById('image-preview');
const previewContainer = document.getElementById('image-preview-container');
const extractBtn = document.getElementById('extract-btn');
const resetBtn = document.getElementById('reset-upload-btn');
const errorText = document.getElementById('scanner-error');
const uploadZone = document.getElementById('upload-zone');

const cardUploadView = document.getElementById('card-barcode-upload');
const cardProgressView = document.getElementById('card-progress');
const cardFormView = document.getElementById('card-form');

let lastProcessedCanvas = null;
let originalUploadCanvas = null;
let cropTopY = 0;
let cropBottomY = 0;

function initScanner() {
    triggerBtn.addEventListener('click', () => {
        photoModal.classList.remove('hidden');
    });
    
    uploadZone.addEventListener('click', (e) => {
        if(e.target !== triggerBtn) {
            photoModal.classList.remove('hidden');
        }
    });

    btnCamera.addEventListener('click', () => {
        photoModal.classList.add('hidden');
        fileInputCamera.click();
    });

    btnGallery.addEventListener('click', () => {
        photoModal.classList.add('hidden');
        fileInputGallery.click();
    });

    btnCancelModal.addEventListener('click', () => {
        photoModal.classList.add('hidden');
    });

    photoModal.addEventListener('click', (e) => {
        if (e.target === photoModal) {
            photoModal.classList.add('hidden');
        }
    });

    fileInputCamera.addEventListener('change', handleFileSelect);
    fileInputGallery.addEventListener('change', handleFileSelect);
    
    extractBtn.addEventListener('click', handleExtraction);
    resetBtn.addEventListener('click', resetScanner);
}

// =============================================================================
// EXIF Orientation Fix
// =============================================================================
async function fixOrientation(file, img) {
    const getOrientation = async (file) => {
        const buf = await file.slice(0, 65536).arrayBuffer();
        const view = new DataView(buf);
        if (view.getUint16(0, false) !== 0xFFD8) return 1;
        
        let offset = 2;
        while (offset < view.byteLength) {
            const marker = view.getUint16(offset, false);
            if (marker === 0xFFD9) break;
            
            if ((marker & 0xFF00) !== 0xFF00) { offset += 2; continue; }
            
            if (marker === 0xFFE1) {
                const segLen = view.getUint16(offset + 2, false);
                const seg = new Uint8Array(buf, offset + 4, segLen - 2);
                const head = String.fromCharCode(...seg.slice(0, 6));
                if (head === "Exif\0\0") {
                    const little = view.getUint16(offset + 10, false) === 0x4949;
                    const ifdOff = view.getUint32(offset + 10 + 4, little);
                    let pos = offset + 10 + ifdOff;
                    const count = view.getUint16(pos, little); pos += 2;
                    for (let i = 0; i < count; i++) {
                        const tag = view.getUint16(pos + i * 12, little);
                        if (tag === 0x0112) return view.getUint16(pos + i * 12 + 8, little);
                    }
                }
                offset += 2 + segLen;
            } else {
                offset += 2 + view.getUint16(offset + 2, false);
            }
        }
        return 1;
    };

    let orientation = 1;
    try {
        orientation = await getOrientation(file);
    } catch (exifErr) {
        console.warn("[Upload] EXIF parsing failed, assuming no rotation.", exifErr);
    }
    
    if (orientation <= 1) { img.exifOrientation = orientation; return img; }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    
    if (orientation >= 5) {
        canvas.width = img.height;
        canvas.height = img.width;
    } else {
        canvas.width = img.width;
        canvas.height = img.height;
    }

    ctx.save();
    switch(orientation) {
        case 2: ctx.translate(canvas.width, 0); ctx.scale(-1, 1); break;
        case 3: ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI); break;
        case 4: ctx.translate(0, canvas.height); ctx.scale(1, -1); break;
        case 5:
            ctx.translate(canvas.width, 0);
            ctx.rotate(0.5 * Math.PI);
            ctx.scale(1, -1);
            break;
        case 6:
            ctx.translate(canvas.width, 0);
            ctx.rotate(0.5 * Math.PI);
            break;
        case 7:
            ctx.translate(0, canvas.height);
            ctx.rotate(-0.5 * Math.PI);
            ctx.scale(1, -1);
            break;
        case 8:
            ctx.translate(0, canvas.height);
            ctx.rotate(-0.5 * Math.PI);
            break;
    }
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    
    canvas.exifOrientation = orientation;
    return canvas;
}

async function convertHeicToJpeg(file) {
    if (!file.type.includes("heic") && !file.name.toLowerCase().endsWith(".heic")) return file;
    
    try {
        console.log("[Upload] HEIC detected. Attempting native Canvas conversion...");
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        
        const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.85));
        console.log("[Upload] HEIC converted successfully.");
        return new File([blob], "converted.jpg", { type: "image/jpeg" });
    } catch (e) {
        throw new Error("HEIC not supported by this browser. Please change your camera to 'Most Compatible' (JPEG).");
    }
}

// =============================================================================
// GENTLE THRESHOLDING (C=5 + contrast boost)
// =============================================================================
function gentleThresholding(canvas) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    // Step 1: Convert to grayscale
    const grays = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        grays[i] = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
    }
    
    // Step 2: Contrast boost (loop-based, no spread)
    let minGray = 255, maxGray = 0;
    for (let i = 0; i < grays.length; i++) {
        if (grays[i] < minGray) minGray = grays[i];
        if (grays[i] > maxGray) maxGray = grays[i];
    }
    const range = maxGray - minGray || 1;
    for (let i = 0; i < grays.length; i++) {
        grays[i] = ((grays[i] - minGray) / range) * 255;
    }
    
    // Step 3: Adaptive threshold with C=5
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
            const x1 = Math.max(x - s2, 0);
            const y1 = Math.max(y - s2, 0);
            const x2 = Math.min(x + s2, width - 1);
            const y2 = Math.min(y + s2, height - 1);
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
// SMART MRZ DETECTION
// =============================================================================
function detectMRZRegion(canvas) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imgData = ctx.getImageData(0, 0, width, height);
    
    const bottomStart = Math.floor(height * 0.35);
    const bh = height - bottomStart;
    
    const textness = new Float32Array(bh);
    for (let y = 0; y < bh; y++) {
        const actualY = bottomStart + y;
        let edgeSum = 0;
        let darkSum = 0;
        const rowPixels = [];
        
        for (let x = 1; x < width - 1; x++) {
            const idx = (actualY * width + x) * 4;
            const leftIdx = (actualY * width + (x - 1)) * 4;
            const rightIdx = (actualY * width + (x + 1)) * 4;
            
            const center = 0.299 * imgData.data[idx] + 0.587 * imgData.data[idx+1] + 0.114 * imgData.data[idx+2];
            const left = 0.299 * imgData.data[leftIdx] + 0.587 * imgData.data[leftIdx+1] + 0.114 * imgData.data[leftIdx+2];
            const right = 0.299 * imgData.data[rightIdx] + 0.587 * imgData.data[rightIdx+1] + 0.114 * imgData.data[rightIdx+2];
            
            edgeSum += Math.abs(right - left);
            rowPixels.push(center);
            if (center < 140) darkSum++;
        }
        
        const mean = rowPixels.reduce((a,b) => a+b, 0) / rowPixels.length;
        const variance = rowPixels.reduce((a,b) => a + (b-mean)**2, 0) / rowPixels.length;
        const darkFrac = darkSum / (width - 2);
        
        if (darkFrac > 0.92 || darkFrac < 0.03) {
            textness[y] = 0;
        } else {
            textness[y] = (edgeSum / (width - 2)) * (variance / 255) * Math.min(darkFrac * 2, 1);
        }
    }
    
    const smoothed = new Float32Array(bh);
    for (let i = 0; i < bh; i++) {
        let sum = 0, count = 0;
        for (let j = -2; j <= 2; j++) {
            const idx = i + j;
            if (idx >= 0 && idx < bh) { sum += textness[idx]; count++; }
        }
        smoothed[i] = sum / count;
    }
    
    const sorted = Array.from(smoothed).sort((a,b) => a - b);
    let threshold = sorted[Math.floor(sorted.length * 0.5)];
    const maxVal = sorted[sorted.length - 1];
    if (threshold > maxVal * 0.4) threshold = maxVal * 0.3;
    
    const peaks = [];
    let inPeak = false, peakStart = 0;
    for (let i = 0; i < bh; i++) {
        if (smoothed[i] > threshold && !inPeak) {
            inPeak = true; peakStart = i;
        } else if (smoothed[i] <= threshold && inPeak) {
            inPeak = false;
            peaks.push({
                start: bottomStart + peakStart,
                end: bottomStart + i - 1,
                height: i - peakStart
            });
        }
    }
    if (inPeak) {
        peaks.push({
            start: bottomStart + peakStart,
            end: height - 1,
            height: bh - peakStart
        });
    }
    
    const textPeaks = peaks.filter(p => p.height >= 3 && p.height <= 60);
    if (textPeaks.length === 0) return null;
    
    let bestResult = null;
    for (let i = textPeaks.length - 3; i >= 0; i--) {
        const p1 = textPeaks[i];
        const p2 = textPeaks[i+1];
        const p3 = textPeaks[i+2];
        const gap1 = p2.start - p1.end;
        const gap2 = p3.start - p2.end;
        
        if (gap1 >= -2 && gap1 <= 30 && gap2 >= -2 && gap2 <= 30 && p1.start > height * 0.35) {
            const pad = 10;
            const cropY = Math.max(0, p1.start - pad);
            const cropH = Math.min(height, p3.end + pad) - cropY;
            const mrzH = p3.end - p1.start;
            const score = p3.end;
            
            if (bestResult === null || score > bestResult.score) {
                bestResult = { y: cropY, h: cropH, mrzH: mrzH, method: 'smart', score: score };
            }
        }
    }
    
    return bestResult;
}

// =============================================================================
// DYNAMIC UPSCALE (clamped 25-50px char height)
// =============================================================================
function upscaleMRZ(cropCanvas, estimatedMrzHeight) {
    const currentCharHeight = estimatedMrzHeight / 3.5;
    const TARGET = 35;
    const MIN = 25;
    const MAX = 50;
    
    let scale = TARGET / currentCharHeight;
    
    let finalChar = currentCharHeight * scale;
    if (finalChar < MIN) {
        scale = MIN / currentCharHeight;
    } else if (finalChar > MAX) {
        scale = MAX / currentCharHeight;
    }
    
    scale = Math.max(2.0, scale);
    
    finalChar = currentCharHeight * scale;
    if (finalChar > MAX) {
        scale = MAX / currentCharHeight;
    }
    
    const scaled = document.createElement('canvas');
    scaled.width = Math.round(cropCanvas.width * scale);
    scaled.height = Math.round(cropCanvas.height * scale);
    const sCtx = scaled.getContext('2d');
    sCtx.imageSmoothingEnabled = false;
    sCtx.drawImage(cropCanvas, 0, 0, scaled.width, scaled.height);
    return scaled;
}

// =============================================================================
// MANUAL CROP UI
// =============================================================================
function showCropUI(canvas, suggestedRegion) {
    const container = document.getElementById('crop-container') || createCropContainer();
    container.classList.remove('hidden');
    
    const img = container.querySelector('.crop-image');
    const confirmBtn = document.getElementById('confirm-crop-btn');
    const autoBtn = document.getElementById('auto-crop-btn');
    
    img.src = canvas.toDataURL('image/jpeg', 0.9);
    originalUploadCanvas = canvas;
    
    const height = canvas.height;
    let topY = suggestedRegion ? suggestedRegion.y : Math.floor(height * 0.55);
    let bottomY = suggestedRegion ? suggestedRegion.y + suggestedRegion.h : Math.floor(height * 0.85);
    
    cropTopY = topY;
    cropBottomY = bottomY;
    
    const topLine = container.querySelector('.crop-line-top');
    const bottomLine = container.querySelector('.crop-line-bottom');
    const topHandle = container.querySelector('.crop-handle-top');
    const bottomHandle = container.querySelector('.crop-handle-bottom');
    
    function updateLines() {
        const h = img.naturalHeight || img.clientHeight || height;
        topLine.style.top = (cropTopY / height * 100) + '%';
        bottomLine.style.top = (cropBottomY / height * 100) + '%';
        topHandle.style.top = (cropTopY / height * 100) + '%';
        bottomHandle.style.top = (cropBottomY / height * 100) + '%';
    }
    
    img.onload = updateLines;
    setTimeout(updateLines, 100);
    
    let dragging = null;
    
    function startDrag(e, line) { dragging = line; e.preventDefault(); }
    function onDrag(e) {
        if (!dragging) return;
        const rect = img.getBoundingClientRect();
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const pct = (clientY - rect.top) / rect.height;
        const y = Math.max(0, Math.min(height, Math.round(pct * height)));
        
        if (dragging === 'top') cropTopY = Math.min(y, cropBottomY - 30);
        else cropBottomY = Math.max(y, cropTopY + 30);
        updateLines();
    }
    function endDrag() { dragging = null; }
    
    const newTopLine = topLine.cloneNode(true);
    const newBotLine = bottomLine.cloneNode(true);
    const newTopHandle = topHandle.cloneNode(true);
    const newBotHandle = bottomHandle.cloneNode(true);
    topLine.parentNode.replaceChild(newTopLine, topLine);
    bottomLine.parentNode.replaceChild(newBotLine, bottomLine);
    topHandle.parentNode.replaceChild(newTopHandle, topHandle);
    bottomHandle.parentNode.replaceChild(newBotHandle, bottomHandle);
    
    newTopLine.addEventListener('mousedown', (e) => startDrag(e, 'top'));
    newTopLine.addEventListener('touchstart', (e) => startDrag(e, 'top'));
    newBotLine.addEventListener('mousedown', (e) => startDrag(e, 'bottom'));
    newBotLine.addEventListener('touchstart', (e) => startDrag(e, 'bottom'));
    newTopHandle.addEventListener('mousedown', (e) => startDrag(e, 'top'));
    newTopHandle.addEventListener('touchstart', (e) => startDrag(e, 'top'));
    newBotHandle.addEventListener('mousedown', (e) => startDrag(e, 'bottom'));
    newBotHandle.addEventListener('touchstart', (e) => startDrag(e, 'bottom'));
    
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('touchmove', onDrag);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchend', endDrag);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('touchmove', onDrag);
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
    
    autoBtn.onclick = () => {
        const newRegion = detectMRZRegion(originalUploadCanvas);
        if (newRegion) {
            cropTopY = newRegion.y;
            cropBottomY = newRegion.y + newRegion.h;
            updateLines();
        }
    };
    
    confirmBtn.onclick = () => {
        container.classList.add('hidden');
        processCroppedRegion(cropTopY, cropBottomY - cropTopY);
    };
}

function createCropContainer() {
    const existing = document.getElementById('crop-container');
    if (existing) existing.remove();
    
    const div = document.createElement('div');
    div.id = 'crop-container';
    div.className = 'crop-container hidden';
    div.innerHTML = `
        <div class="crop-wrapper">
            <img class="crop-image" alt="Adjust crop">
            <div class="crop-line crop-line-top"></div>
            <div class="crop-line crop-line-bottom"></div>
            <div class="crop-handle crop-handle-top">↑ DRAG ↑</div>
            <div class="crop-handle crop-handle-bottom">↓ DRAG ↓</div>
            <div class="crop-label">Place MRZ between green lines</div>
        </div>
        <div class="crop-controls">
            <button id="auto-crop-btn" class="btn-secondary">Auto-Detect</button>
            <button id="confirm-crop-btn" class="btn-primary">Confirm & Extract</button>
        </div>
    `;
    document.body.appendChild(div);
    return div;
}

function processCroppedRegion(y, h) {
    const canvas = originalUploadCanvas;
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = canvas.width;
    cropCanvas.height = h;
    cropCanvas.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    
    const mrzH = h * 0.75;
    const scaledCanvas = upscaleMRZ(cropCanvas, mrzH);
    gentleThresholding(scaledCanvas);
    
    lastProcessedCanvas = scaledCanvas;
    
    imagePreview.src = scaledCanvas.toDataURL('image/jpeg', 0.85);
    previewContainer.classList.remove('hidden');
    uploadZone.classList.add('hidden');
    extractBtn.disabled = false;
}

// =============================================================================
// MAIN FILE HANDLER
// =============================================================================
async function handleFileSelect(e) {
    let file = e.target.files[0];
    if (!file) return;

    errorText.classList.add('hidden');
    console.log(`[Upload] Starting process for: ${file.name || 'unknown'}`);

    try {
        file = new File([file], file.name || "upload.jpg", { type: file.type || "image/jpeg" });
        file = await convertHeicToJpeg(file);
        
        let imageSource = await new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
            img.src = url;
        });
        imageSource = await fixOrientation(file, imageSource);

        const MAX_DIMENSION = 1500;
        let width = imageSource.width;
        let height = imageSource.height;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(imageSource, 0, 0, width, height);

        const suggestedRegion = detectMRZRegion(canvas);
        console.log(`[Upload] Smart detection:`, suggestedRegion);
        
        showCropUI(canvas, suggestedRegion);

    } catch (err) {
        console.error(err);
        errorText.textContent = err.message || "Failed to process image.";
        errorText.classList.remove('hidden');
    }
}

async function handleExtraction() {
    if (!lastProcessedCanvas) return;

    cardUploadView.classList.add('hidden');
    cardProgressView.classList.remove('hidden');
    errorText.classList.add('hidden');

    try {
        await new Promise(r => setTimeout(r, 100));
        const parsedRecord = await parseUgandaID(lastProcessedCanvas);
        
        populateForm(parsedRecord);
        cardProgressView.classList.add('hidden');
        cardFormView.classList.remove('hidden');
        
    } catch (err) {
        console.error(err);
        cardProgressView.classList.add('hidden');
        cardUploadView.classList.remove('hidden');
        errorText.textContent = "Failed to detect or parse MRZ text. Please ensure the image is clear and try again. (" + err.message + ")";
        
        const retakeBtn = document.createElement('button');
        retakeBtn.textContent = 'Retake Photo';
        retakeBtn.className = 'retake-btn';
        retakeBtn.addEventListener('click', resetScanner);
        errorText.appendChild(retakeBtn);
        
        errorText.classList.remove('hidden');
    }
}

function resetScanner() {
    fileInputCamera.value = '';
    fileInputGallery.value = '';
    imagePreview.src = '';
    previewContainer.classList.add('hidden');
    uploadZone.classList.remove('hidden');
    extractBtn.disabled = true;
    errorText.classList.add('hidden');
    errorText.textContent = '';
    lastProcessedCanvas = null;
    originalUploadCanvas = null;
    
    const cropContainer = document.getElementById('crop-container');
    if (cropContainer) cropContainer.classList.add('hidden');
}

function showScannerView() {
    resetScanner();
    cardFormView.classList.add('hidden');
    cardProgressView.classList.add('hidden');
    cardUploadView.classList.remove('hidden');
}

function populateForm(record) {
    document.getElementById('surname').value = record.surname || '';
    document.getElementById('givenName').value = record.givenName || '';
    document.getElementById('otherName').value = record.otherName || '';
    document.getElementById('dob').value = record.dob || '';
    
    if (record.sex) {
        const sexSelect = document.getElementById('sex');
        if (record.sex.toLowerCase() === 'male') sexSelect.value = 'Male';
        else if (record.sex.toLowerCase() === 'female') sexSelect.value = 'Female';
    }
    
    document.getElementById('nationality').value = record.nationality || 'UGA';
    document.getElementById('nin').value = record.nin || '';

    const ninWarning = document.getElementById('nin-warning');
    if (ninWarning) {
        if (record.ninNeedsReview) {
            ninWarning.textContent = '⚠️ NIN contains characters that may be OCR errors. Please verify.';
            ninWarning.classList.remove('hidden');
        } else {
            ninWarning.classList.add('hidden');
        }
    }
}
