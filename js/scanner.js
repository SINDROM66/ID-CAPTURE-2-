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

// Keep reference to processed canvas so parseUgandaID can use deskew fallback
let lastProcessedCanvas = null;

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

    console.log(`[Upload] EXIF Orientation detected: ${orientation}. Rotating canvas.`);

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

function adaptiveThresholding(canvas) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    // Convert to grayscale array
    const grays = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        grays[i] = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
    }
    
    // Build integral image for fast local mean calculation
    const integral = new Uint32Array(width * height);
    for (let y = 0; y < height; y++) {
        let rowSum = 0;
        for (let x = 0; x < width; x++) {
            rowSum += grays[y * width + x];
            integral[y * width + x] = rowSum + (y > 0 ? integral[(y - 1) * width + x] : 0);
        }
    }
    
    // IMPROVED parameters for MRZ text:
    // Smaller window = sharper character edges
    // Lower C value = less aggressive thresholding (preserves thin lines)
    const s = Math.max(10, Math.floor(Math.min(width, height) / 40));
    const s2 = Math.floor(s / 2);
    const C = 12;  // Was 15 — reduced to preserve thin MRZ strokes
    
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

async function handleFileSelect(e) {
    let file = e.target.files[0];
    if (!file) return;

    errorText.classList.add('hidden');
    console.log(`[Upload] Starting process for: ${file.name || 'unknown'}, type: ${file.type || 'unknown'}, size: ${file.size}`);

    try {
        file = new File([file], file.name || "upload.jpg", { type: file.type || "image/jpeg" });
        
        file = await convertHeicToJpeg(file);
        
        let imageSource = null;
        
        imageSource = await new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("Failed to load image"));
            };
            img.src = url;
        });
        imageSource = await fixOrientation(file, imageSource);


        console.log(`[Upload] Source dimensions: ${imageSource.width}x${imageSource.height}`);
        
        const MAX_DIMENSION = 1500;
        let width = imageSource.width;
        let height = imageSource.height;
        
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
            console.log(`[Upload] Downscaled to: ${width}x${height}`);
        }
        
        let canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageSource, 0, 0, width, height);

        
        
        // Step 1: Remove black bars
        const ctxFull = canvas.getContext('2d');
        const imgDataFull = ctxFull.getImageData(0, 0, canvas.width, canvas.height);
        const rowMeans = [];
        for (let y = 0; y < canvas.height; y++) {
            let sum = 0;
            for (let x = 0; x < canvas.width; x++) {
                const idx = (y * canvas.width + x) * 4;
                sum += 0.299 * imgDataFull.data[idx] + 0.587 * imgDataFull.data[idx+1] + 0.114 * imgDataFull.data[idx+2];
            }
            rowMeans.push(sum / canvas.width);
        }
        let topCrop = 0, bottomCrop = canvas.height - 1;
        while (topCrop < canvas.height && rowMeans[topCrop] < 30) topCrop++;
        while (bottomCrop >= 0 && rowMeans[bottomCrop] < 30) bottomCrop--;
        if (bottomCrop > topCrop) {
            const croppedCanvas = document.createElement('canvas');
            croppedCanvas.width = canvas.width;
            croppedCanvas.height = bottomCrop - topCrop + 1;
            croppedCanvas.getContext('2d').drawImage(canvas, 0, topCrop, canvas.width, bottomCrop - topCrop + 1, 0, 0, canvas.width, bottomCrop - topCrop + 1);
            canvas = croppedCanvas;
        }

        // Step 3: Upscale 2x for sharper character edges
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = canvas.width * 2;
        scaledCanvas.height = canvas.height * 2;
        const sCtx = scaledCanvas.getContext('2d');
        sCtx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);

        // Apply adaptive thresholding for clean black/white text
        adaptiveThresholding(scaledCanvas);
        canvas = scaledCanvas;
        console.log("[Upload] Applied adaptive thresholding and upscale.");
        
        // Store canvas for extraction (enables deskew fallback in parseUgandaID)
        lastProcessedCanvas = canvas;
        
        const finalDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        
        imagePreview.onload = () => {
            previewContainer.classList.remove('hidden');
            uploadZone.classList.add('hidden');
            extractBtn.disabled = false;
        };
        imagePreview.src = finalDataUrl;
        
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

        // Pass the actual canvas so deskew fallback (HTMLCanvasElement check) works
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
    // Preserve manually-entered phone number on re-scan
    // (Form reset on Save/Discard clears it; re-scanning alone won't)
}
