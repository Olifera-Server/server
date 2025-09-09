const express = require('express');
const { body, validationResult } = require('express-validator');
const { executeQuery } = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Get or create cart session
const getOrCreateCartSession = async (userId = null) => {
  let sessionId = null;

  if (userId) {
    // For logged-in users, get existing session or create new one
    const sessions = await executeQuery(
      'SELECT session_id FROM cart_sessions WHERE user_id = ?',
      [userId]
    );

    if (sessions.length > 0) {
      sessionId = sessions[0].session_id;
    } else {
      sessionId = uuidv4();
      await executeQuery(
        'INSERT INTO cart_sessions (session_id, user_id) VALUES (?, ?)',
        [sessionId, userId]
      );
    }
  } else {
    // For guest users, create new session
    sessionId = uuidv4();
    await executeQuery(
      'INSERT INTO cart_sessions (session_id) VALUES (?)',
      [sessionId]
    );
  }

  return sessionId;
};

// Get cart items
router.get('/', optionalAuth, async (req, res) => {
  try {
    let sessionId = null;

    if (req.user) {
      // For logged-in users, get their session
      const sessions = await executeQuery(
        'SELECT session_id FROM cart_sessions WHERE user_id = ?',
        [req.user.id]
      );

      if (sessions.length === 0) {
        return res.json({ items: [], total: 0 });
      }

      sessionId = sessions[0].session_id;
    } else {
      // For guest users, use session from query or create new one
      sessionId = req.query.sessionId;
      
      if (!sessionId) {
        return res.json({ items: [], total: 0, sessionId: null });
      }
    }

    // Get cart items with product details
    const cartItems = await executeQuery(`
      SELECT 
        ci.id,
        ci.quantity,
        p.id as product_id,
        p.name,
        p.price,
        p.original_price,
        p.stock,
        pi.image_url as image,
        c.name as category
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = TRUE
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ci.session_id = ? AND p.status = 'active'
      ORDER BY ci.created_at DESC
    `, [sessionId]);

    // Calculate totals
    const total = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

    res.json({
      items: cartItems,
      total: parseFloat(total.toFixed(2)),
      itemCount,
      sessionId: req.user ? null : sessionId
    });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ message: 'Failed to fetch cart' });
  }
});

// Add item to cart
router.post('/add', optionalAuth, [
  body('productId').isInt({ min: 1 }).withMessage('Valid product ID is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Valid quantity is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { productId, quantity } = req.body;

    // Check if product exists and is active
    const products = await executeQuery(
      'SELECT id, name, price, stock FROM products WHERE id = ? AND status = "active"',
      [productId]
    );

    if (products.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const product = products[0];

    // Check stock availability
    if (product.stock < quantity) {
      return res.status(400).json({ 
        message: `Only ${product.stock} items available in stock` 
      });
    }

    // Get or create cart session
    const sessionId = await getOrCreateCartSession(req.user?.id);

    // Check if item already exists in cart
    const existingItems = await executeQuery(
      'SELECT id, quantity FROM cart_items WHERE session_id = ? AND product_id = ?',
      [sessionId, productId]
    );

    if (existingItems.length > 0) {
      // Update quantity
      const newQuantity = existingItems[0].quantity + quantity;
      
      if (newQuantity > product.stock) {
        return res.status(400).json({ 
          message: `Cannot add more items. Only ${product.stock} available in stock` 
        });
      }

      await executeQuery(
        'UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newQuantity, existingItems[0].id]
      );
    } else {
      // Add new item
      await executeQuery(
        'INSERT INTO cart_items (session_id, product_id, quantity) VALUES (?, ?, ?)',
        [sessionId, productId, quantity]
      );
    }

    res.json({ 
      message: 'Item added to cart successfully',
      sessionId: req.user ? null : sessionId
    });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ message: 'Failed to add item to cart' });
  }
});

// Update cart item quantity
router.put('/update/:itemId', optionalAuth, [
  body('quantity').isInt({ min: 0 }).withMessage('Valid quantity is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const itemId = parseInt(req.params.itemId);
    const { quantity } = req.body;

    // Get cart item with product details
    const cartItems = await executeQuery(`
      SELECT 
        ci.*,
        p.stock,
        p.name
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.id = ?
    `, [itemId]);

    if (cartItems.length === 0) {
      return res.status(404).json({ message: 'Cart item not found' });
    }

    const cartItem = cartItems[0];

    // Check if user owns this cart item
    if (req.user) {
      const sessions = await executeQuery(
        'SELECT id FROM cart_sessions WHERE session_id = ? AND user_id = ?',
        [cartItem.session_id, req.user.id]
      );

      if (sessions.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    if (quantity === 0) {
      // Remove item
      await executeQuery('DELETE FROM cart_items WHERE id = ?', [itemId]);
      res.json({ message: 'Item removed from cart' });
    } else {
      // Check stock availability
      if (quantity > cartItem.stock) {
        return res.status(400).json({ 
          message: `Only ${cartItem.stock} items available in stock` 
        });
      }

      // Update quantity
      await executeQuery(
        'UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [quantity, itemId]
      );

      res.json({ message: 'Cart updated successfully' });
    }
  } catch (error) {
    console.error('Update cart error:', error);
    res.status(500).json({ message: 'Failed to update cart' });
  }
});

// Remove item from cart
router.delete('/remove/:itemId', optionalAuth, async (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId);

    // Get cart item
    const cartItems = await executeQuery(
      'SELECT session_id FROM cart_items WHERE id = ?',
      [itemId]
    );

    if (cartItems.length === 0) {
      return res.status(404).json({ message: 'Cart item not found' });
    }

    const cartItem = cartItems[0];

    // Check if user owns this cart item
    if (req.user) {
      const sessions = await executeQuery(
        'SELECT id FROM cart_sessions WHERE session_id = ? AND user_id = ?',
        [cartItem.session_id, req.user.id]
      );

      if (sessions.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Remove item
    await executeQuery('DELETE FROM cart_items WHERE id = ?', [itemId]);

    res.json({ message: 'Item removed from cart' });
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({ message: 'Failed to remove item from cart' });
  }
});

// Clear cart
router.delete('/clear', optionalAuth, async (req, res) => {
  try {
    let sessionId = null;

    if (req.user) {
      // For logged-in users, get their session
      const sessions = await executeQuery(
        'SELECT session_id FROM cart_sessions WHERE user_id = ?',
        [req.user.id]
      );

      if (sessions.length === 0) {
        return res.json({ message: 'Cart is already empty' });
      }

      sessionId = sessions[0].session_id;
    } else {
      // For guest users, use session from query
      sessionId = req.query.sessionId;
      
      if (!sessionId) {
        return res.json({ message: 'Cart is already empty' });
      }
    }

    // Clear cart items
    await executeQuery('DELETE FROM cart_items WHERE session_id = ?', [sessionId]);

    res.json({ message: 'Cart cleared successfully' });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({ message: 'Failed to clear cart' });
  }
});

// Merge guest cart with user cart (when user logs in)
router.post('/merge', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: 'Session ID is required' });
    }

    // Get user's cart session
    const userSessions = await executeQuery(
      'SELECT session_id FROM cart_sessions WHERE user_id = ?',
      [req.user.id]
    );

    let userSessionId = null;

    if (userSessions.length === 0) {
      // Create new session for user
      userSessionId = uuidv4();
      await executeQuery(
        'INSERT INTO cart_sessions (session_id, user_id) VALUES (?, ?)',
        [userSessionId, req.user.id]
      );
    } else {
      userSessionId = userSessions[0].session_id;
    }

    // Get guest cart items
    const guestItems = await executeQuery(
      'SELECT product_id, quantity FROM cart_items WHERE session_id = ?',
      [sessionId]
    );

    // Merge items
    for (const item of guestItems) {
      // Check if item already exists in user's cart
      const existingItems = await executeQuery(
        'SELECT id, quantity FROM cart_items WHERE session_id = ? AND product_id = ?',
        [userSessionId, item.product_id]
      );

      if (existingItems.length > 0) {
        // Update quantity
        const newQuantity = existingItems[0].quantity + item.quantity;
        await executeQuery(
          'UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [newQuantity, existingItems[0].id]
        );
      } else {
        // Add new item
        await executeQuery(
          'INSERT INTO cart_items (session_id, product_id, quantity) VALUES (?, ?, ?)',
          [userSessionId, item.product_id, item.quantity]
        );
      }
    }

    // Delete guest session
    await executeQuery('DELETE FROM cart_sessions WHERE session_id = ?', [sessionId]);
    await executeQuery('DELETE FROM cart_items WHERE session_id = ?', [sessionId]);

    res.json({ message: 'Cart merged successfully' });
  } catch (error) {
    console.error('Merge cart error:', error);
    res.status(500).json({ message: 'Failed to merge cart' });
  }
});

module.exports = router;