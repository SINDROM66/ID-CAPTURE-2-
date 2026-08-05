

const PIN = 'SINDROM666';

// 1. Setup UI Listeners (Synchronous, so it works immediately)
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

    function unlockApp() {
        lockScreen.style.opacity = '0';
        setTimeout(() => {
            lockScreen.classList.add('hidden');
            mainApp.classList.remove('app-blurred');
        }, 400);
    }

    if (localStorage.getItem('nssf_unlocked') === 'true') {
        lockScreen.style.display = 'none';
        mainApp.classList.remove('app-blurred');
        return;
    }

    function attemptUnlock() {
        if (pinInput.value.trim().toUpperCase() === PIN.toUpperCase()) {
            localStorage.setItem('nssf_unlocked', 'true');
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
            // Remove active classes
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.add('hidden'));

            // Add active to clicked
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
    updateOnlineStatus(); // Init
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

        try {
            await window.appDB.addRecord(record);
            form.reset();
            updateRecordsBadge();
            alert('Record saved securely offline.');
            showScannerView(); // Go back to scan mode
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
        list.innerHTML = ''; // Clear

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
            
            const name = [record.surname, record.givenName, record.otherName].filter(Boolean).join(' ');

            tr.innerHTML = `
                <td style="padding: 12px 8px;">
                    <div style="font-weight: 600; color: var(--text); margin-bottom: 4px;">${name}</div>
                    <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px;">
                        <span>NIN: ${record.nin}</span> | <span>DOB: ${record.dob}</span> | <span>SEX: ${record.sex}</span>
                    </div>
                </td>
            `;
            list.appendChild(tr);
        });

    } catch (err) {
        console.error("Failed to load records:", err);
    }
}

// Add export and clear logic
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
                    `"${r.surname || ''}"`,
                    `"${r.givenName || ''}"`,
                    `"${r.otherName || ''}"`,
                    `"${r.sex || ''}"`,
                    `"${r.dob || ''}"`,
                    `"${r.nationality || ''}"`,
                    `"${r.nin || ''}"`,
                    `"${r.phone || ''}"`,
                    `"${r.timestamp || ''}"`
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

