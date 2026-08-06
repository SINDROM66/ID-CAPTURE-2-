# NSSF Member Data Capture - UI Architecture & Flow Guide

This document provides a comprehensive breakdown of the frontend User Interface, styling system, and interaction flows. You can provide this document to an AI to perfectly recreate the frontend visual experience and logic flow, independently of any backend/OCR logic.

## 1. Global Design System & Aesthetics

The application uses a **Clean, Modern Light Mode** aesthetic to feel professional, native, and highly responsive. It utilizes the official NSSF branding colors.

### Color Palette (CSS Variables)
- **Background (`--bg`)**: `#f0f4f8` (Soft, light slate blue) - *Used for the main app background.*
- **Surface (`--card-bg`)**: `#ffffff` (Pure white) - *Used for elevated card containers.*
- **Primary (`--primary`)**: `#0d4f82` (NSSF Navy Blue) - *Used for primary actions, active tabs, and headers.*
- **Primary Hover (`--primary-dark`)**: `#093d66` - *Used for hover states on primary buttons.*
- **Success (`--success`)**: `#0a7044` (Forest green) - *Used for "Save Record" and "Online" status.*
- **Danger (`--danger`)**: `#b91c1c` (Vibrant red) - *Used for "Discard", "Clear Records", and error states.*
- **Text (`--text`)**: `#1a2a3a` (Deep navy/black) - *Primary text color.*
- **Text Muted (`--text-muted`)**: `#64748b` (Slate gray) - *Secondary text, hints, and inactive tabs.*
- **Border (`--border`)**: `#dde5ef` - *Subtle borders separating components.*

### Typography & Spacing
- **Font**: System UI fonts (Inter, Roboto, San Francisco) for a clean, native feel.
- **Border Radius (`--radius`)**: `10px` (Soft, rounded corners for cards and buttons).
- **Shadows**: Soft box-shadows (`0 1px 4px rgba(0,0,0,0.08)`) to lift cards slightly off the background.

### Micro-Animations
- **Button Clicks**: All buttons use `transform: scale(0.98)` on `:active` to give tactile feedback.
- **Transitions**: Global `transition: all 0.2s ease` for smooth hover states and color changes.
- **Unlocking**: The main app starts with `filter: blur(8px)` and smoothly transitions to `filter: blur(0)` when the correct PIN is entered.

---

## 2. Component Breakdown & UI Flow

The UI is built as a Single Page Application (SPA) utilizing hidden/active CSS classes to swap views instantly without page reloads.

### A. The Lock Screen (Initial State)
- **Visuals**: A centered card overlaying a heavily blurred version of the main app.
- **Elements**: 
  - Title: "Secure Access"
  - Input: `<input type="password">` with a placeholder of "PIN".
  - Button: "Unlock" (Primary Blue).
  - Error Text (Hidden): "Invalid PIN" (Danger Red).
- **Flow**: User enters PIN -> Clicks Unlock -> If correct, the lock screen fades out (`opacity: 0`, `pointer-events: none`), the main app blur is removed, and the auth state is saved to `localStorage`.

### B. Global Header & Navigation (Always Visible)
- **Header**: 
  - Left: NSSF Logo (bold) and two-line title ("Digital Pre-Registration" / "Member Data Capture Tool").
  - Right: A pill-shaped Network Status indicator (Red dot/Offline or Green dot/Online) and an outline "Install" button.
- **Tabs**: 
  - Two tabs: **"Capture"** and **"Records"**.
  - Visuals: Active tab has Primary Blue text and a bottom border. Inactive tab is Text Muted. 
  - The "Records" tab includes a small red notification badge showing the count of saved records.
- **Flow**: Clicking a tab hides the current `<section>` and unhides the target `<section>`.

### C. The "Capture" Tab (Main Workflow)
This tab acts as a state machine, swapping between three distinct "Cards" (Views). It features a toggle at the top: "Scan Barcode" vs "Enter Data Manually".

#### State 1: Image Upload View (`#card-barcode-upload`)
- **Elements**:
  - **Upload Zone**: A large dashed-border box with a camera/barcode icon. Turns solid blue on hover.
  - **Action Buttons**: "Choose / Take Photo" (Outline button).
  - **Bottom Actions**: "Extract Data" (Primary Blue, disabled until image is loaded) and "Reset" (Ghost button).
  - **Preview Container (Hidden)**: An `<img>` tag that appears once a photo is selected.
- **Flow**: 
  - Clicking the Upload Zone or the "Choose Photo" button opens the **Photo Modal**.
  - **Photo Modal**: A dark overlay with a bottom-sheet style card offering "Take Photo (Camera)" or "Choose from Gallery". 
  - Once an image is selected, the Upload Zone hides, the Preview Container shows the image, and "Extract Data" becomes enabled.

#### State 2: Progress View (`#card-progress`)
- **Visuals**: A clean card with a spinning CSS loader (border-spinner).
- **Text**: "Running OCR — Please Wait" / "Reading back of ID card...".
- **Flow**: Triggered by clicking "Extract Data". Hides State 1 and shows State 2. When the backend code finishes, it hides State 2 and moves to State 3.

#### State 3: Manual Entry / Review Form (`#card-form`)
- **Visuals**: A structured grid form.
- **Sections**:
  - **Personal Details**: SURNAME, GIVEN NAME, OTHER NAME, SEX (Dropdown), DOB, NATIONALITY.
  - **Identity & Contact**: NIN, PHONE NUMBER.
  - Fields are styled with solid dark backgrounds (`#1e1e1e`) and subtle borders, turning blue on `:focus`.
- **Action Buttons**: "Save Record" (Success Green) and "Discard" (Ghost Button).
- **Flow**: 
  - Can be reached by OCR success (auto-fills the inputs) OR by clicking "Enter Data Manually" at the top toggle.
  - Clicking "Save" validates required fields, saves to the local database, increments the Records badge, and resets the view back to State 1.
  - Clicking "Discard" wipes the inputs and resets to State 1.

### D. The "Records" Tab
- **Visuals**: A data management view.
- **Elements**:
  - **Top Bar**: "Data Export" title with two small buttons: "Export" (Primary Blue) and "Clear" (Danger Red).
  - **Data Table**: A clean, borderless list. Columns for "Name & NIN".
- **Flow**: 
  - Displays all records saved from the Capture tab.
  - "Export" triggers a CSV download of all rows.
  - "Clear" prompts a confirmation and deletes all rows.

### E. The Developer Console (Debug)
- **Visuals**: A small, terminal-like window fixed at the bottom of the app.
- **Styling**: `background: #1e1e1e`, `color: #00ff00` (hacker green text), monospace font. Features a fixed height of `300px` with `-webkit-overflow-scrolling: touch` for mobile scrolling.
- **Flow**: Intercepts `console.log` commands from the background scripts and prints them here so the user can see raw OCR output without opening browser dev tools. Includes a "Clear" button.
