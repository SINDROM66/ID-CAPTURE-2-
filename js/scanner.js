


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

function preprocessImage(img) {
    const MAX_WIDTH = 1200; // Optimal for 30-50px character heights on typical IDs
    let width = img.width;
    let height = img.height;
    
    if (width > MAX_WIDTH) {
        height = Math.round((height * MAX_WIDTH) / width);
        width = MAX_WIDTH;
    }
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // Smooth drawing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    
    // Get image data for pixel manipulation
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    // Step 1: Grayscale & Find Min/Max Luminance for Contrast Stretching
    let minL = 255;
    let maxL = 0;
    const luminanceMap = new Uint8Array(width * height);
    
    for (let i = 0; i < data.length; i += 4) {
        // Luminance = 0.299*R + 0.587*G + 0.114*B
        const l = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
        luminanceMap[i/4] = l;
        if (l < minL) minL = l;
        if (l > maxL) maxL = l;
    }
    
    // Step 2: Contrast Stretching
    const range = maxL - minL;
    if (range > 0) {
        for (let i = 0; i < luminanceMap.length; i++) {
            luminanceMap[i] = ((luminanceMap[i] - minL) / range) * 255;
        }
    }
    
    // Step 3: Bradley Local Adaptive Thresholding
    // We compute an integral image to quickly sum pixels in a neighborhood
    const integral = new Uint32Array(width * height);
    for (let i = 0; i < width; i++) {
        let sum = 0;
        for (let j = 0; j < height; j++) {
            sum += luminanceMap[j * width + i];
            integral[j * width + i] = (i === 0 ? 0 : integral[j * width + i - 1]) + sum;
        }
    }
    
    // Apply local threshold
    // Window size S = width / 16 (approx 75px on a 1200px image)
    const s = Math.floor(width / 16);
    const s2 = Math.floor(s / 2);
    const t = 0.15; // 15% threshold
    
    for (let i = 0; i < width; i++) {
        for (let j = 0; j < height; j++) {
            const x1 = Math.max(i - s2, 0);
            const x2 = Math.min(i + s2, width - 1);
            const y1 = Math.max(j - s2, 0);
            const y2 = Math.min(j + s2, height - 1);
            
            const count = (x2 - x1 + 1) * (y2 - y1 + 1);
            
            let sum = integral[y2 * width + x2];
            if (x1 > 0) sum -= integral[y2 * width + x1 - 1];
            if (y1 > 0) sum -= integral[(y1 - 1) * width + x2];
            if (x1 > 0 && y1 > 0) sum += integral[(y1 - 1) * width + x1 - 1];
            
            const index = j * width + i;
            // If pixel is 15% darker than local average, it's text (black), else background (white)
            if (luminanceMap[index] * count <= sum * (1.0 - t)) {
                // Black
                data[index * 4] = 0;
                data[index * 4 + 1] = 0;
                data[index * 4 + 2] = 0;
                data[index * 4 + 3] = 255;
            } else {
                // White
                data[index * 4] = 255;
                data[index * 4 + 1] = 255;
                data[index * 4 + 2] = 255;
                data[index * 4 + 3] = 255;
            }
        }
    }
    
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85);
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    errorText.classList.add('hidden');
    
    // Show a loading state on the upload zone while processing
    uploadZone.innerHTML = '<div class="spinner" style="margin-bottom: 8px;"></div><div style="font-weight: 700; color: var(--primary);">Processing Image...</div>';
    extractBtn.disabled = true;

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            // Run Computer Vision Pipeline
            const processedDataUrl = preprocessImage(img);
            
            imagePreview.onload = () => {
                previewContainer.classList.remove('hidden');
                uploadZone.classList.add('hidden');
                // Restore upload zone HTML
                uploadZone.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" style="margin-bottom: 8px;"><rect x="3" y="4" width="18" height="16" rx="2" ry="2"></rect><line x1="7" y1="8" x2="11" y2="8"></line><line x1="7" y1="12" x2="17" y2="12"></line><line x1="7" y1="16" x2="17" y2="16"></line></svg><div style="font-weight: 700; color: var(--primary);">Back of ID</div><div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Barcode scan — direct read</div>';
                extractBtn.disabled = false;
            };
            imagePreview.src = processedDataUrl;
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
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

