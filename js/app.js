const PIN = 'SINDROM666';

// Security helpers
function hashPin(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return 'h' + Math.abs(hash).toString(16);
}

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function safeCsv(str) {
    if (str == null) return '""';
    let s = String(str).replace(/"/g, '""');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // Prevent CSV formula injection
    return `"${s}"`;
}

// 1. Setup UI Listeners
setupAuth();
setupTabs();
setupSubNav();
setupNetworkStatus();
setupForm();

// 2. Init Database
window.appDB.init().then(() => {
    updateRecordsBadge();
}).catch(e => {
    console.error("DB init failed:", e);
});

// 3. Init Scanner
try {
    initScanner();
} catch (e) {
    console.error("Scanner init failed:", e);
}

// 4. Register Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('SW registered', reg))
        .catch(err => console.error('SW init failed', err));
}

function setupAuth() {
    const lockScreen = document.getElementById('lock-screen');
    const mainApp = document.getElementById('main-app');
    const pinInput = document.getElementById('pin-input');
    const unlockBtn = document.getElementById('unlock-btn');
    const lockError = document.getElementById('lock-error');

    const SESSION_KEY = hashPin(PIN + '_SESSION_SALT');

    function unlockApp() {
        lockScreen.style.opacity = '0';
        setTimeout(() => {
            lockScreen.classList.add('hidden');
            mainApp.classList.remove('app-blurred');
        }, 400);
    }

    if (localStorage.getItem('nssf_unlocked') === SESSION_KEY) {
        lockScreen.style.display = 'none';
        mainApp.classList.remove('app-blurred');
        return;
    }

    function attemptUnlock() {
        if (hashPin(pinInput.value.trim().toUpperCase()) === hashPin(PIN)) {
            localStorage.setItem('nssf_unlocked', SESSION_KEY);
            unlockApp();
        } else {
            lockError.classList.remove('hidden');
            pinInput.value = '';
            pinInput.focus();
        }
    }

    unlockBtn.addEventListener('click', attemptUnlock);
    pinInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') attemptUnlock();
    });
}

function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.add('hidden'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.remove('hidden');

            if (targetId === 'records-tab') {
                renderRecords();
            }
        });
    });
}

function setupNetworkStatus() {
    const statusBadge = document.getElementById('network-status');
    const statusText = statusBadge.querySelector('.status-text');

    function updateOnlineStatus() {
        if (navigator.onLine) {
            statusBadge.classList.replace('offline', 'online');
            statusText.textContent = 'Online';
        } else {
            statusBadge.classList.replace('online', 'offline');
            statusText.textContent = 'Offline';
        }
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();
}

function setupForm() {
    const form = document.getElementById('record-form');
    const discardBtn = document.getElementById('discard-btn');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const record = {
            surname: document.getElementById('surname').value,
            givenName: document.getElementById('givenName').value,
            otherName: document.getElementById('otherName').value,
            dob: document.getElementById('dob').value,
            nationality: document.getElementById('nationality').value,
            sex: document.getElementById('sex').value,
            nin: document.getElementById('nin').value,
            phone: document.getElementById('phone').value,
        };

        if (record.nin && !/^[A-Z]{2}[A-Z0-9]{12}$/.test(record.nin)) {
            alert('Invalid NIN format');
            return;
        }

        // Duplicate check
        try {
            const existing = await window.appDB.getAllRecords();
            if (existing.some(r => r.nin && r.nin === record.nin)) {
                alert('A record with this NIN already exists.');
                return;
            }
        } catch (err) {
            console.error("Duplicate check failed:", err);
        }

        try {
            await window.appDB.addRecord(record);
            form.reset();
            updateRecordsBadge();
            alert('Record saved securely offline.');
            showScannerView();
        } catch (error) {
            console.error("Failed to save record:", error);
            alert("Error saving record. Please try again.");
        }
    });

    discardBtn.addEventListener('click', () => {
        form.reset();
        showScannerView();
    });
}

function setupSubNav() {
    const scanBtn = document.getElementById('nav-scan-btn');
    const manualBtn = document.getElementById('nav-manual-btn');
    const scanView = document.getElementById('card-barcode-upload');
    const formView = document.getElementById('card-form');
    const progressView = document.getElementById('card-progress');

    scanBtn.addEventListener('click', () => {
        scanBtn.classList.add('active');
        manualBtn.classList.remove('active');
        scanView.classList.remove('hidden');
        formView.classList.add('hidden');
        progressView.classList.add('hidden');
    });

    manualBtn.addEventListener('click', () => {
        manualBtn.classList.add('active');
        scanBtn.classList.remove('active');
        scanView.classList.add('hidden');
        progressView.classList.add('hidden');
        formView.classList.remove('hidden');
    });
}

async function updateRecordsBadge() {
    const count = await window.appDB.getRecordCount();
    document.getElementById('records-badge').textContent = count;
}

async function renderRecords() {
    const list = document.getElementById('records-list');
    const exportBtn = document.getElementById('export-btn');
    const clearBtn = document.getElementById('clear-all-btn');
    
    try {
        const records = await window.appDB.getAllRecords();
        list.innerHTML = '';

        if (records.length === 0) {
            list.innerHTML = `
                <tr><td colspan="7">
                    <div class="empty-state">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="9" y1="15" x2="15" y2="15"></line></svg>
                        <div style="margin-top: 8px; font-weight: 600;">No records yet.</div>
                    </div>
                </td></tr>
            `;
            if(exportBtn) exportBtn.disabled = true;
            if(clearBtn) clearBtn.disabled = true;
            return;
        }

        if(exportBtn) exportBtn.disabled = false;
        if(clearBtn) clearBtn.disabled = false;
        
        records.reverse().forEach(record => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid var(--border)";
            
            const td = document.createElement('td');
            td.style.padding = "12px 8px";
            
            const nameDiv = document.createElement('div');
            nameDiv.style.fontWeight = "600";
            nameDiv.style.color = "var(--text)";
            nameDiv.style.marginBottom = "4px";
            const name = [record.surname, record.givenName, record.otherName].filter(Boolean).join(' ');
            nameDiv.textContent = name;
            
            const metaDiv = document.createElement('div');
            metaDiv.style.fontSize = "11px";
            metaDiv.style.color = "var(--text-muted)";
            metaDiv.style.display = "flex";
            metaDiv.style.gap = "8px";
            
            const ninSpan = document.createElement('span');
            ninSpan.textContent = `NIN: ${record.nin || ''}`;
            const dobSpan = document.createElement('span');
            dobSpan.textContent = `DOB: ${record.dob || ''}`;
            const sexSpan = document.createElement('span');
            sexSpan.textContent = `SEX: ${record.sex || ''}`;
            
            metaDiv.appendChild(ninSpan);
            metaDiv.appendChild(document.createTextNode(' | '));
            metaDiv.appendChild(dobSpan);
            metaDiv.appendChild(document.createTextNode(' | '));
            metaDiv.appendChild(sexSpan);
            
            td.appendChild(nameDiv);
            td.appendChild(metaDiv);
            tr.appendChild(td);
            list.appendChild(tr);
        });

    } catch (err) {
        console.error("Failed to load records:", err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const exportBtn = document.getElementById('export-btn');
    const clearBtn = document.getElementById('clear-all-btn');

    if(exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const records = await window.appDB.getAllRecords();
            if(records.length === 0) return;
            
            const headers = ['SURNAME', 'GIVEN NAME', 'OTHER NAME', 'SEX', 'DOB', 'NATIONALITY', 'NIN', 'PHONE', 'TIMESTAMP'];
            const csvRows = [headers.join(',')];
            
            records.forEach(r => {
                const row = [
                    safeCsv(r.surname),
                    safeCsv(r.givenName),
                    safeCsv(r.otherName),
                    safeCsv(r.sex),
                    safeCsv(r.dob),
                    safeCsv(r.nationality),
                    safeCsv(r.nin),
                    safeCsv(r.phone),
                    safeCsv(r.timestamp)
                ];
                csvRows.push(row.join(','));
            });
            
            const csvData = new Blob([csvRows.join('\n')], { type: 'text/csv' });
            const csvUrl = URL.createObjectURL(csvData);
            const a = document.createElement('a');
            a.href = csvUrl;
            a.download = `NSSF_Records_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(csvUrl);
        });
    }

    if(clearBtn) {
        clearBtn.addEventListener('click', async () => {
            if(confirm("Are you sure you want to completely clear ALL offline records? This cannot be undone.")) {
                await window.appDB.clearAllRecords();
                updateRecordsBadge();
                renderRecords();
            }
        });
    }
});
