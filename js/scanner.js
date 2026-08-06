


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

function initScanner() {
    
    // Open modal on trigger click
    triggerBtn.addEventListener('click', () => {
        photoModal.classList.remove('hidden');
    });
    
    // Also trigger on zone click
    uploadZone.addEventListener('click', (e) => {
        if(e.target !== triggerBtn) {
            photoModal.classList.remove('hidden');
        }
    });

    // Modal Actions
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

    // Close modal if clicking outside content
    photoModal.addEventListener('click', (e) => {
        if (e.target === photoModal) {
            photoModal.classList.add('hidden');
        }
    });

    // Bind both inputs to the same handler
    fileInputCamera.addEventListener('change', handleFileSelect);
    fileInputGallery.addEventListener('change', handleFileSelect);
    
    extractBtn.addEventListener('click', handleExtraction);
    resetBtn.addEventListener('click', resetScanner);
}

// -----------------------------------------------------------------------------
// MOBILE IMAGE PREPROCESSING PIPELINE
// -----------------------------------------------------------------------------

// EXIF Parser and Rotator (Fallback for older browsers)
async function fixOrientation(file, img) {
    const getOrientation = async (file) => {
        const buf = await file.slice(0, 65536).arrayBuffer();
        const view = new DataView(buf);
        if (view.getUint16(0, false) !== 0xFFD8) return 1; // Not JPEG
        
        let offset = 2;
        while (offset < view.byteLength) {
            const marker = view.getUint16(offset, false);
            if (marker === 0xFFD9) break; // End of image
            
            if ((marker & 0xFF00) !== 0xFF00) { offset += 2; continue; }
            
            if (marker === 0xFFE1) { // APP1 (EXIF)
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

    const orientation = await getOrientation(file);
    if (orientation <= 1) return img; // No rotation needed
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
        case 5: ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); break;
        case 6: ctx.rotate(0.5 * Math.PI); ctx.translate(0, -canvas.width); break;
        case 7: ctx.rotate(0.5 * Math.PI); ctx.translate(canvas.height, -canvas.width); ctx.scale(-1, 1); break;
        case 8: ctx.rotate(-0.5 * Math.PI); ctx.translate(-canvas.height, 0); break;
    }
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    
    return canvas;
}

// HEIC Converter
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

// OCR Preprocessing (Contrast Stretch)
function preprocessForOCR(canvas) {
    const ctx = canvas.getContext("2d");
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    
    for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
        const stretched = Math.min(255, Math.max(0, (gray - 40) * 1.6));
        data[i] = data[i+1] = data[i+2] = stretched;
    }
    
    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

// Main File Handler
async function handleFileSelect(e) {
    let file = e.target.files[0];
    if (!file) return;

    errorText.classList.add('hidden');
    console.log(`[Upload] Starting process for: ${file.name || 'unknown'}, type: ${file.type || 'unknown'}, size: ${file.size}`);

    try {
        // Handle Mobile Blob quirks
        file = new File([file], file.name || "upload.jpg", { type: file.type || "image/jpeg" });
        
        // 1. Convert HEIC if needed
        file = await convertHeicToJpeg(file);
        
        let imageSource = null;
        
        // 2. Try modern createImageBitmap with EXIF parsing
        try {
            imageSource = await createImageBitmap(file, { imageOrientation: "from-image" });
            console.log("[Upload] createImageBitmap with from-image succeeded.");
        } catch (err) {
            // Fallback for older browsers
            console.warn("[Upload] createImageBitmap failed. Falling back to manual EXIF parser.");
            imageSource = await new Promise((resolve, reject) => {
                const img = new Image();
                const url = URL.createObjectURL(file);
                img.onload = () => {
                    URL.revokeObjectURL(url); // Prevent memory leak
                    resolve(img);
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    reject(new Error("Failed to load image"));
                };
                img.src = url;
            });
            // Manual EXIF parsing and rotation
            imageSource = await fixOrientation(file, imageSource);
        }
        
        console.log(`[Upload] Source dimensions: ${imageSource.width}x${imageSource.height}`);
        
        // 3. Smart Resize
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
        
        // 4. Contrast Preprocessing
        canvas = preprocessForOCR(canvas);
        console.log("[Upload] Applied OCR contrast stretching.");
        
        // Render
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
    if (!imagePreview.src) return;

    // Show Progress
    cardUploadView.classList.add('hidden');
    cardProgressView.classList.remove('hidden');
    errorText.classList.add('hidden');

    try {
        // Wait a tiny bit for the UI to update
        await new Promise(r => setTimeout(r, 100));

        // Use our new Tesseract.js OCR pipeline to extract data
        const parsedRecord = await parseUgandaID(imagePreview);
        
        // Transition to Form and pre-fill data
        populateForm(parsedRecord);
        cardProgressView.classList.add('hidden');
        cardFormView.classList.remove('hidden');
        
    } catch (err) {
        console.error(err);
        // If decoding fails, go back and show error
        cardProgressView.classList.add('hidden');
        cardUploadView.classList.remove('hidden');
        errorText.textContent = "Failed to detect or parse MRZ text. Please ensure the image is clear and try again. (" + err.message + ")";
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
    document.getElementById('dob').value = record.dateOfBirth || '';
    
    if (record.sex) {
        const sexSelect = document.getElementById('sex');
        if (record.sex.toLowerCase() === 'male') sexSelect.value = 'Male';
        else if (record.sex.toLowerCase() === 'female') sexSelect.value = 'Female';
    }
    
    document.getElementById('nationality').value = record.nationality || 'UGA';
    document.getElementById('nin').value = record.nin || '';
    
    // Clear phone number as it's not in the ID barcode usually
    document.getElementById('phone').value = '';
}

