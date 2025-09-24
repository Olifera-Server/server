const express = require('express');
const router = express.Router();
const {executeQuery} = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Handle contact form submissions
router.post('/', async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;

        // Validate required fields
        if (!name || !email || !subject || !message) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        // Insert contact form data into user_contact table
        const query = 'INSERT INTO user_contact (name, email, subject, message) VALUES (?, ?, ?, ?)';
        await executeQuery(query, [name, email, subject, message]);

        res.status(201).json({ message: 'Contact form submitted successfully' });
    } catch (error) {
        console.error('Contact form submission error:', error);
        res.status(500).json({ message: 'Error submitting contact form' });
    }
});

// Get all contact form submissions (Admin only)
router.get('/', [authenticateToken, requireAdmin], async (req, res) => {
    try {
        const { page = 1, limit = 20, status = 'all' } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = '';
        const params = [];

        if (status !== 'all') {
            whereClause = 'WHERE status = ?';
            params.push(status);
        }

        // Get total count
        const [countResult] = await executeQuery(
            `SELECT COUNT(*) as total FROM user_contact ${whereClause}`,
            status !== 'all' ? [status] : []
        );
        const total = countResult.total;

        // Get contact submissions with pagination
        const submissions = await executeQuery(`
            SELECT 
                id,
                name,
                email,
                subject,
                message,
                status,
                created_at
            FROM user_contact
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        res.json({
            submissions,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalItems: total,
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Fetch contact submissions error:', error);
        res.status(500).json({ message: 'Failed to fetch contact submissions' });
    }
});

module.exports = router;