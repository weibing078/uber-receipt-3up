# Uber Receipt 3-up PDF Layout Tool

A browser-based tool to help users batch-process Uber receipt PDFs for accounting.

## Features

- Drag-and-drop or button-based file upload
- Keep only page 1 from each PDF
- Auto-trim page white margins
- A4 landscape layout, 3 receipts per page
- Multi-page output for large batches
- File list with reorder/remove controls
- Date detection (with confidence hint)
- Optional auto date sorting
- Duplicate detection based on file metadata + content hash
- One-click export as merged PDF (PNG/JPEG quality modes)
- Click any filename to open original PDF in a new tab for manual review

## Privacy / Permissions

- All processing runs locally in the browser
- Files are **not uploaded** to a server by this app
- The app only uses files explicitly selected or dropped by the user
- No camera/microphone/location/contact permissions are requested

## Deploy to GitHub Pages

1. Push this project to a GitHub repository.
2. Open repository **Settings** -> **Pages**.
3. Under **Build and deployment**:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
4. Save and wait 1-3 minutes.
5. Your site URL will be:
   - `https://<your-username>.github.io/<repo-name>/`

## Local Usage

Open `index.html` directly in a browser.

