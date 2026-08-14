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
let scanSide = 'front'; // default to front

// Live Scanner Variables
let liveStream = null;
let isScanning = false;
let isProcessingFrame = false;
let scanInterval = null;

function initScanner() {
    const btnFront = document.getElementById('scan-side-front');
    const btnBack = document.getElementById('scan-side-back');
    const uploadZoneTitle = document.getElementById('upload-zone-title');
    const uploadZoneSubtitle = document.getElementById('upload-zone-subtitle');
    const hintText = document.getElementById('scan-hint-text');

    btnFront.addEventListener('click', () => {
        scanSide = 'front';
        btnFront.classList.replace('btn-outline', 'btn-primary');
        btnBack.classList.replace('btn-primary', 'btn-outline');
        uploadZoneTitle.textContent = 'Front of ID';
        uploadZoneSubtitle.textContent = 'Reads personal details from front';
        hintText.innerHTML = 'Hold phone parallel to card. The app auto-detects the fields on the front of the ID.';
    });

    btnBack.addEventListener('click', () => {
        scanSide = 'back';
        btnBack.classList.replace('btn-outline', 'btn-primary');
        btnFront.classList.replace('btn-primary', 'btn-outline');
        uploadZoneTitle.textContent = 'Back of ID (MRZ)';
        uploadZoneSubtitle.textContent = 'Reads data from the MRZ code';
        hintText.innerHTML = 'Hold phone parallel to card. The app <strong>auto-detects the MRZ strip</strong> at the bottom.';
    });

    triggerBtn.addEventListener('click', () => photoModal.classList.remove('hidden'));
    uploadZone.addEventListener('click', (e) => {
        if(e.target !== triggerBtn) photoModal.classList.remove('hidden');
    });

    btnCamera.addEventListener('click', () => { 
        photoModal.classList.add('hidden'); 
        startLiveScanner(); 
    });
    btnGallery.addEventListener('click', () => { photoModal.classList.add('hidden'); fileInputGallery.click(); });
    btnCancelModal.addEventListener('click', () => photoModal.classList.add('hidden'));
    photoModal.addEventListener('click', (e) => { if (e.target === photoModal) photoModal.classList.add('hidden'); });

    document.getElementById('btn-cancel-scanner').addEventListener('click', stopLiveScanner);

    fileInputGallery.addEventListener('change', handleFileSelect);
    extractBtn.addEventListener('click', handleExtraction);
    resetBtn.addEventListener('click', resetScanner);
}

// =============================================================================
// LIVE SCANNER LOGIC
// =============================================================================
async function startLiveScanner() {
    const video = document.getElementById('camera-stream');
    const modal = document.getElementById('live-scanner-modal');
    const statusText = document.getElementById('live-scan-status');
    
    try {
        liveStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
        });
        video.srcObject = liveStream;
        modal.classList.remove('hidden');
        isScanning = true;
        isProcessingFrame = false;
        statusText.textContent = 'Scanning automatically...';
        
        // Wait for video to start playing before capturing frames
        video.onloadedmetadata = () => {
            video.play();
            // Start frame capture loop (every 600ms)
            scanInterval = setInterval(processVideoFrame, 600);
        };
    } catch (err) {
        console.error("Camera access failed:", err);
        alert("Could not access camera. Please ensure permissions are granted or use Gallery upload.");
        modal.classList.add('hidden');
    }
}

function stopLiveScanner() {
    isScanning = false;
    clearInterval(scanInterval);
    const modal = document.getElementById('live-scanner-modal');
    modal.classList.add('hidden');
    
    if (liveStream) {
        liveStream.getTracks().forEach(track => track.stop());
        liveStream = null;
    }
}

async function processVideoFrame() {
    if (!isScanning || isProcessingFrame) return;
    
    const video = document.getElementById('camera-stream');
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
    
    isProcessingFrame = true;
    const statusText = document.getElementById('live-scan-status');
    
    try {
        // Create an offscreen canvas to capture the current frame
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // If it's the front, we might want to process the whole image. 
        // But for MRZ (Back), we only want the bottom part where the MRZ is.
        // Actually, let's just send the whole canvas to runLiveExtraction
        // and let parseUgandaID do the cropping if needed.
        
        let parsedRecord;
        if (scanSide === 'front') {
            parsedRecord = await parseFrontUgandaID(canvas);
        } else {
            // We pass the whole canvas, ug-id-parser will find MRZ
            parsedRecord = await parseUgandaID(canvas, null);
        }
        
        // If successful, stop scanner and populate form!
        stopLiveScanner();
        
        // Play success beep
        const audio = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU'+Array(1e3).join('123')); 
        audio.play().catch(e => {}); // Ignore if blocked
        
        lastProcessedCanvas = canvas;
        populateForm(parsedRecord);
        
        cardUploadView.classList.add('hidden');
        cardProgressView.classList.add('hidden');
        cardFormView.classList.remove('hidden');
        
    } catch (err) {
        // OCR failed (e.g. no MRZ found), silently ignore and try next frame
        console.log("Live scan frame rejected:", err.message);
    } finally {
        isProcessingFrame = false;
    }
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
    try { orientation = await getOrientation(file); } catch (e) { console.warn("[Upload] EXIF failed", e); }
    if (orientation <= 1) { img.exifOrientation = orientation; return img; }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (orientation >= 5) { canvas.width = img.height; canvas.height = img.width; }
    else { canvas.width = img.width; canvas.height = img.height; }

    ctx.save();
    switch(orientation) {
        case 2: ctx.translate(canvas.width, 0); ctx.scale(-1, 1); break;
        case 3: ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI); break;
        case 4: ctx.translate(0, canvas.height); ctx.scale(1, -1); break;
        case 5: ctx.translate(canvas.width, 0); ctx.rotate(0.5*Math.PI); ctx.scale(1, -1); break;
        case 6: ctx.translate(canvas.width, 0); ctx.rotate(0.5*Math.PI); break;
        case 7: ctx.translate(0, canvas.height); ctx.rotate(-0.5*Math.PI); ctx.scale(1, -1); break;
        case 8: ctx.translate(0, canvas.height); ctx.rotate(-0.5*Math.PI); break;
    }
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    canvas.exifOrientation = orientation;
    return canvas;
}

async function convertHeicToJpeg(file) {
    if (!file.type.includes("heic") && !file.name.toLowerCase().endsWith(".heic")) return file;
    try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.85));
        return new File([blob], "converted.jpg", { type: "image/jpeg" });
    } catch (e) {
        throw new Error("HEIC not supported. Please change camera to 'Most Compatible' (JPEG).");
    }
}

// =============================================================================
// CROP UI
// =============================================================================
// Crop UI removed to automate extraction

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
        let width = imageSource.width, height = imageSource.height;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(imageSource, 0, 0, width, height);

        lastProcessedCanvas = canvas;
        
        // Auto-extract immediately using Tesseract with grayscale/threshold filter
        runExtraction();

    } catch (err) {
        console.error(err);
        errorText.textContent = err.message || "Failed to process image.";
        errorText.classList.remove('hidden');
    }
}

async function runExtraction() {
    cardUploadView.classList.add('hidden');
    cardProgressView.classList.remove('hidden');
    errorText.classList.add('hidden');

    try {
        await new Promise(r => setTimeout(r, 100));
        let parsedRecord;
        if (scanSide === 'front') {
            parsedRecord = await parseFrontUgandaID(lastProcessedCanvas);
        } else {
            parsedRecord = await parseUgandaID(lastProcessedCanvas, null);
        }
        
        populateForm(parsedRecord);
        cardProgressView.classList.add('hidden');
        cardFormView.classList.remove('hidden');
    } catch (err) {
        console.error(err);
        cardProgressView.classList.add('hidden');
        cardUploadView.classList.remove('hidden');
        errorText.textContent = "Failed to detect or parse MRZ text. Please ensure the image is clear and try again. (" + err.message + ")";
        errorText.classList.remove('hidden');
    }
}

function handleExtraction() {
    if (!lastProcessedCanvas) return;
    runExtraction();
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
        if (record.sex.toLowerCase() === 'male' || record.sex === 'M') sexSelect.value = 'Male';
        else if (record.sex.toLowerCase() === 'female' || record.sex === 'F') sexSelect.value = 'Female';
        else sexSelect.value = record.sex;
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
