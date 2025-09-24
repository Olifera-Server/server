const express = require('express');
const router = express.Router();
const {executeQuery} = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Subscribe to newsletter
router.post('/subscribe', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        if(!/\S+@\S+\.\S+/.test(email)) {
            return res.status(400).json({ message: 'Please enter a valid email.' });
        }

        // Insert email into newsletter table
        const query = 'INSERT INTO newsletter (email) VALUES (?)';
        await executeQuery(query, [email]);

        res.status(201).json({ message: 'Successfully subscribed to newsletter' });
    } catch (error) {
        console.error('Newsletter subscription error:', error);
        res.status(500).json({ message: 'Error subscribing to newsletter' });
    }
});

// Get all newsletter subscriptions (Admin only)
router.get('/', [authenticateToken, requireAdmin], async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        // Get total count
        const [countResult] = await executeQuery(
            'SELECT COUNT(*) as total FROM newsletter'
        );
        const total = countResult.total;

        // Get subscribers with pagination
        const subscribers = await executeQuery(`
            SELECT 
                email,
                created_at,
                id
            FROM newsletter
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `, [parseInt(limit), offset]);

        res.json({
            subscribers,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalItems: total,
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Fetch newsletter subscribers error:', error);
        res.status(500).json({ message: 'Failed to fetch newsletter subscribers' });
    }
});

module.exports = router;