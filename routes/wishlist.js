const express = require('express');
const { executeQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Get user's wishlist
router.get('/', async (req, res) => {
  try {
    const wishlistItems = await executeQuery(`
      SELECT 
        w.*,
        p.name,
        p.price,
        p.original_price,
        p.description,
        p.stock,
        p.rating,
        p.reviews_count,
        p.badge,
        pi.image_url as image,
        c.name as category
      FROM wishlist w
      JOIN products p ON w.product_id = p.id
      LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = TRUE
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE w.user_id = ? AND p.status = 'active'
      ORDER BY w.created_at DESC
    `, [req.user.id]);

    res.json({ wishlist: wishlistItems });
  } catch (error) {
    console.error('Get wishlist error:', error);
    res.status(500).json({ message: 'Failed to fetch wishlist' });
  }
});

// Add item to wishlist
router.post('/add', async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ message: 'Product ID is required' });
    }

    // Check if product exists and is active
    const products = await executeQuery(
      'SELECT id FROM products WHERE id = ? AND status = "active"',
      [productId]
    );

    if (products.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Check if item already exists in wishlist
    const existingItems = await executeQuery(
      'SELECT id FROM wishlist WHERE user_id = ? AND product_id = ?',
      [req.user.id, productId]
    );

    if (existingItems.length > 0) {
      return res.status(400).json({ message: 'Product already in wishlist' });
    }

    // Add to wishlist
    await executeQuery(
      'INSERT INTO wishlist (user_id, product_id) VALUES (?, ?)',
      [req.user.id, productId]
    );

    res.json({ message: 'Product added to wishlist successfully' });
  } catch (error) {
    console.error('Add to wishlist error:', error);
    res.status(500).json({ message: 'Failed to add product to wishlist' });
  }
});

// Remove item from wishlist
router.delete('/remove/:productId', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);

    // Remove from wishlist
    const result = await executeQuery(
      'DELETE FROM wishlist WHERE user_id = ? AND product_id = ?',
      [req.user.id, productId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found in wishlist' });
    }

    res.json({ message: 'Product removed from wishlist successfully' });
  } catch (error) {
    console.error('Remove from wishlist error:', error);
    res.status(500).json({ message: 'Failed to remove product from wishlist' });
  }
});

// Clear wishlist
router.delete('/clear', async (req, res) => {
  try {
    await executeQuery(
      'DELETE FROM wishlist WHERE user_id = ?',
      [req.user.id]
    );

    res.json({ message: 'Wishlist cleared successfully' });
  } catch (error) {
    console.error('Clear wishlist error:', error);
    res.status(500).json({ message: 'Failed to clear wishlist' });
  }
});

// Check if product is in wishlist
router.get('/check/:productId', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);

    const items = await executeQuery(
      'SELECT id FROM wishlist WHERE user_id = ? AND product_id = ?',
      [req.user.id, productId]
    );

    res.json({ isInWishlist: items.length > 0 });
  } catch (error) {
    console.error('Check wishlist error:', error);
    res.status(500).json({ message: 'Failed to check wishlist' });
  }
});

module.exports = router;
