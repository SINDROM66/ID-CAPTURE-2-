


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

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    errorText.classList.add('hidden');
    
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            // Downscale massive phone camera photos for OCR
            const MAX_WIDTH = 1500;
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
            ctx.drawImage(img, 0, 0, width, height);
            
            // Convert back to a manageable data URL
            const scaledDataUrl = canvas.toDataURL('image/jpeg', 0.85);
            
            imagePreview.onload = () => {
                previewContainer.classList.remove('hidden');
                uploadZone.classList.add('hidden');
                extractBtn.disabled = false;
            };
            imagePreview.src = scaledDataUrl;
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

