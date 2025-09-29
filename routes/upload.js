
const express = require('express');
const router = express.Router();
const path = require('path');
const busboy = require('busboy');       // NEW: Replaces multer for streaming
const ftp = require('basic-ftp');       // NEW: FTP client

// --- FTP Server Configuration ---
// IMPORTANT: Store these securely, e.g., in environment variables
const ftpConfig = {
    host: '86.38.243.79',
    user: 'u813335079',
    password: 'Olifera@25',
    secure: false // Set to true for FTPS (FTP over TLS)
};

// --- We will reuse your existing validation function ---
function checkFileType(file, cb) {
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb('Error: Images Only!');
    }
}

// @route   POST /api/upload
// @desc    Upload an image by streaming it directly to an FTP server
// @access  Private/Admin
router.post('/', (req, res) => {

    const bb = busboy({
        headers: req.headers,
        limits: {
            fileSize: 10000000 // 10MB limit (same as your original code)
        }
    });

    let fileFound = false;

    bb.on('file', (fieldname, fileStream, fileInfo) => {
        fileFound = true;
        const { filename, mimeType } = fileInfo;

        // --- 1. Perform Validation First ---
        const mockFile = { originalname: filename, mimetype: mimeType };
        checkFileType(mockFile, async (err, isValid) => {
            if (err || !isValid) {
                console.log('File type validation failed:', err || 'Invalid file type');
                fileStream.resume(); // Discard the stream's data
                // Check if headers are already sent to avoid errors
                if (!res.headersSent) {
                    return res.status(400).json({ message: 'Error: Images Only!' });
                }
                return;
            }

            // --- 2. If valid, proceed with FTP upload ---
            console.log(`Validation passed. Starting FTP upload for: ${filename}`);
            const fname = `${Date.now()}-${filename}`
            const remotePath = `/domains/olifera.in/public_html/uploads/products/${fname}`; // Define your remote path
            const client = new ftp.Client();

            try {
                await client.access(ftpConfig);
                await client.uploadFrom(fileStream, remotePath);

                console.log(`Successfully uploaded to ${remotePath}`);
                if (!res.headersSent) {
                    res.json({
                        message: 'File uploaded successfully',
                        filePath: `https://olifera.in/uploads/products/${fname}` // Return the remote FTP path
                    });
                }
            } catch (ftpErr) {
                console.error('FTP Upload Failed:', ftpErr);
                fileStream.resume(); // Ensure stream is drained on error
                if (!res.headersSent) {
                    res.status(500).json({ message: 'FTP upload failed.' });
                }
            } finally {
                if (!client.closed) {
                    client.close();
                }
            }
        });
    });

    // Handle file size limit exceeded
    bb.on('limit', () => {
        if (!res.headersSent) {
            res.status(400).json({ message: 'Error: File is too large. Limit is 10MB.' });
        }
    });
    
    // Handle end of form parsing
    bb.on('finish', () => {
        console.log('Finished parsing the form.');
        if (!fileFound && !res.headersSent) {
            res.status(400).json({ message: 'Error: No File Selected!' });
        }
    });

    // Start parsing the request
    req.pipe(bb);
});

module.exports = router;