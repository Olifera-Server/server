const express = require('express');
const { body, validationResult } = require('express-validator');
const { executeQuery, executeTransaction } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const {sendOrderConfirmationEmail} = require('../config/emailConfig')

const router = express.Router();

// Generate unique order number
const generateOrderNumber = () => {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `ORD-${timestamp}-${random}`;
};

// Get user's orders
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;
    const params = [req.user.id];
    let whereClause = 'WHERE o.user_id = ?';

    if (status && status !== 'all') {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    // Get orders with item count
    const ordersQuery = `
      SELECT 
        o.*,
        COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      ${whereClause}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM orders o
      ${whereClause}
    `;

    const [orders, countResult] = await Promise.all([
      executeQuery(ordersQuery, [...params, parseInt(limit), offset]),
      executeQuery(countQuery, params)
    ]);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// Get single order with details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);

    // Get order details
    let orders = []
    if(req.user.role == 'admin' ){
      orders = await executeQuery(`
      SELECT * FROM orders WHERE id = ?
    `, [orderId]);
    }else{
      orders = await executeQuery(`
      SELECT * FROM orders WHERE id = ? AND user_id = ?
    `, [orderId, req.user.id]);
    }
    
    console.log(orders)
    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = orders[0];

    // Get order items
    const orderItems = await executeQuery(`
      SELECT 
        oi.*,
        p.name as product_name,
        pi.image_url as product_image
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = TRUE
      WHERE oi.order_id = ?
    `, [orderId]);

    // Get payment details
    const payments = await executeQuery(`
      SELECT * FROM payments WHERE order_id = ?
    `, [orderId]);

    res.json({
      order: {
        ...order,
        items: orderItems,
        payment: payments[0] || null
      }
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ message: 'Failed to fetch order' });
  }
});

// Create new order
// router.post('/', authenticateToken, [
//   body('shippingAddress').notEmpty().withMessage('Shipping address is required'),
//   body('shippingCity').notEmpty().withMessage('Shipping city is required'),
//   body('shippingState').notEmpty().withMessage('Shipping state is required'),
//   body('shippingZipCode').notEmpty().withMessage('Shipping zip code is required'),
//   body('shippingMethod').optional().isString(),
//   body('deliveryNotes').optional().isString(),
//   body('paymentMethod').notEmpty().withMessage('Payment method is required')
// ], async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({ 
//         message: 'Validation failed', 
//         errors: errors.array() 
//       });
//     }

//     const {
//       shippingAddress,
//       shippingCity,
//       shippingState,
//       shippingZipCode,
//       shippingMethod = 'Standard Delivery',
//       deliveryNotes,
//       paymentMethod,
//       sessionId
//     } = req.body;

//     let subtotal = 0;
//     const orderItems = [];

//     for (const item of cartItems) {
//       if (item.stock < item.quantity) {
//         return res.status(400).json({ 
//           message: `Insufficient stock for ${item.name}. Only ${item.stock} available.` 
//         });
//       }

//       const itemTotal = item.price * item.quantity;
//       subtotal += itemTotal;

//       orderItems.push({
//         product_id: item.product_id,
//         product_name: item.name,
//         product_price: item.price,
//         quantity: item.quantity,
//         total_price: itemTotal
//       });
//     }

//     // Calculate shipping cost
//     let shippingCost = 0;
//     if (shippingMethod === 'Express Delivery') {
//       shippingCost = 9.99;
//     } else if (shippingMethod === 'Overnight Delivery') {
//       shippingCost = 19.99;
//     }

//     // Calculate tax (8%)
//     const taxAmount = subtotal * 0.08;
//     const totalAmount = subtotal + shippingCost + taxAmount;

//     // Create order using transaction
//     const orderNumber = generateOrderNumber();
    
//     const queries = [
//       {
//         query: `
//           INSERT INTO orders (
//             order_number, user_id, status, subtotal, shipping_cost, tax_amount, 
//             total_amount, shipping_address, shipping_city, shipping_state, 
//             shipping_zip_code, shipping_method, delivery_notes
//           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//         `,
//         params: [
//           orderNumber, req.user.id, 'pending', subtotal, shippingCost, taxAmount,
//           totalAmount, shippingAddress, shippingCity, shippingState,
//           shippingZipCode, shippingMethod, deliveryNotes
//         ]
//       }
//     ];

//     const results = await executeTransaction(queries);
//     const orderId = results[0].insertId;

//     // Add order items
//     for (const item of orderItems) {
//       await executeQuery(`
//         INSERT INTO order_items (
//           order_id, product_id, product_name, product_price, quantity, total_price
//         ) VALUES (?, ?, ?, ?, ?, ?)
//       `, [orderId, item.product_id, item.product_name, item.product_price, item.quantity, item.total_price]);

//       // Update product stock
//       await executeQuery(`
//         UPDATE products SET stock = stock - ? WHERE id = ?
//       `, [item.quantity, item.product_id]);
//     }

//     // Create payment record
//     await executeQuery(`
//       INSERT INTO payments (
//         order_id, payment_method, amount, status, payment_details
//       ) VALUES (?, ?, ?, ?, ?)
//     `, [orderId, paymentMethod, totalAmount, 'pending', JSON.stringify({ method: paymentMethod })]);

//     // Clear cart
//     if (sessionId) {
//       await executeQuery('DELETE FROM cart_items WHERE session_id = ?', [sessionId]);
//       await executeQuery('DELETE FROM cart_sessions WHERE session_id = ?', [sessionId]);
//     } else {
//       const sessions = await executeQuery(
//         'SELECT session_id FROM cart_sessions WHERE user_id = ?',
//         [req.user.id]
//       );
//       if (sessions.length > 0) {
//         await executeQuery('DELETE FROM cart_items WHERE session_id = ?', [sessions[0].session_id]);
//       }
//     }

//     res.status(201).json({
//       message: 'Order created successfully',
//       order: {
//         id: orderId,
//         orderNumber,
//         totalAmount: parseFloat(totalAmount.toFixed(2))
//       }
//     });
//   } catch (error) {
//     console.error('Create order error:', error);
//     res.status(500).json({ message: 'Failed to create order' });
//   }
// });
router.post('/', authenticateToken, [
  // --- VALIDATION UPDATED TO MATCH FRONTEND PAYLOAD ---

  // Validate nested fields within the 'shippingAddress' object
  body('shippingAddress.firstName').notEmpty().withMessage('First name is required'),
  body('shippingAddress.lastName').notEmpty().withMessage('Last name is required'),
  body('shippingAddress.address').notEmpty().withMessage('Shipping address is required'),
  body('shippingAddress.city').notEmpty().withMessage('Shipping city is required'),
  body('shippingAddress.state').notEmpty().withMessage('Shipping state is required'),
  body('shippingAddress.zipCode').notEmpty().withMessage('Shipping zip code is required'),
  body('shippingAddress.phone').notEmpty().withMessage('Phone number is required'),

  // Validate other top-level fields
  body('deliveryMethod').notEmpty().withMessage('Delivery method is required'),
  body('items').isArray({ min: 1 }).withMessage('Cart items cannot be empty'),

], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    // --- DESTRUCTURING UPDATED TO MATCH FRONTEND PAYLOAD ---
    const {
      shippingAddress, // This is now an object
      items,             // This is the array of cart items
      deliveryMethod,    // The shipping option like 'standard'
      sessionId
    } = req.body;
    
    // As per frontend note, we'll set a default payment method here
    const paymentMethod = 'Cash on Delivery'; // Or 'Credit Card (Pending)', etc.

    let subtotal = 0;
    const orderItems = [];

    // Loop through the 'items' array from req.body, NOT a separate cartItems variable
    for (const item of items) {
      // You might need a DB call here to verify price and stock from the server
      // For example: const product = await getProductById(item.product);
      // if (product.stock < item.quantity) { ... }

      const itemTotal = item.price * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        product_id: item.product, // Frontend sends 'product' which is the ID
        product_name: item.name,
        product_price: item.price,
        quantity: item.quantity,
        total_price: itemTotal
      });
    }

    // --- Calculations based on frontend data ---
    let shippingCost = 0;
    // if (deliveryMethod === 'express') { // matches 'express' from frontend
    //   shippingCost = 9.99;
    // } else if (deliveryMethod === 'overnight') { // matches 'overnight' from frontend
    //   shippingCost = 19.99;
    // }

    const taxAmount = 0;
    const totalAmount = subtotal + shippingCost + taxAmount;
    
    const orderNumber = generateOrderNumber();
    
    // --- SQL QUERY UPDATED TO INCLUDE NEW FIELDS ---
    const orderInsertQuery = {
      query: `
        INSERT INTO orders (
          order_number, user_id, status, subtotal, shipping_cost, tax_amount, total_amount, 
          shipping_address, shipping_city, shipping_state, shipping_zip_code, 
          shipping_method 
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        orderNumber, req.user.id, 'pending', subtotal, shippingCost, taxAmount, totalAmount,      // from nested object
        shippingAddress.address,     // from nested object
        shippingAddress.city,        // from nested object
        shippingAddress.state,       // from nested object
        shippingAddress.zipCode,     // from nested object
        deliveryMethod               // from top-level property
      ]
    };
    
    const results = await executeTransaction([orderInsertQuery]);
    const orderId = results[0].insertId;

    // Add order items and update stock (this part remains largely the same)
    for (const item of orderItems) {
      await executeQuery(`
        INSERT INTO order_items (
          order_id, product_id, product_name, product_price, quantity, total_price
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [orderId, item.product_id, item.product_name, item.product_price, item.quantity, item.total_price]);

      await executeQuery(`
        UPDATE products SET stock = stock - ? WHERE id = ?
      `, [item.quantity, item.product_id]);
    }

    // Since payment and cart clearing are handled separately or omitted,
    // we send the success response directly after creating the order.

    // Send order confirmation email to admin
    await sendOrderConfirmationEmail(
      {
        orderId: orderNumber,
        customerName: `${shippingAddress.firstName} ${shippingAddress.lastName}`,
        customerEmail: shippingAddress.email,
        shippingAddress: `${shippingAddress.address}, ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.zipCode}`,
        items: orderItems,
        totalAmount: totalAmount.toFixed(2),
        status: 'pending',
        shippingMethod: deliveryMethod,
        phone: shippingAddress.phone
      },
      [process.env.ADMIN_EMAIL, shippingAddress.email]
    );

    res.status(201).json({
      message: 'Order created successfully',
      order: {
        id: orderId,
        orderNumber,
        totalAmount: parseFloat(totalAmount.toFixed(2))
      }
    });

  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ message: 'Failed to create order' });
  }
});

// Update order status (Admin only)
router.put('/:id/status', [authenticateToken, requireAdmin], [
  body('status').isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const orderId = parseInt(req.params.id);
    const { status } = req.body;

    // Check if order exists
    const orders = await executeQuery(
      'SELECT id FROM orders WHERE id = ?',
      [orderId]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // // Get full order details for email
    // const [orderDetails, orderItems, user] = await Promise.all([
    //   executeQuery(`
    //     SELECT o.* 
    //     FROM orders o
    //     WHERE o.id = ?
    //   `, [orderId]),
    //   executeQuery(`
    //     SELECT oi.*, p.name as product_name
    //     FROM order_items oi
    //     LEFT JOIN products p ON oi.product_id = p.id
    //     WHERE oi.order_id = ?
    //   `, [orderId]),
    //   executeQuery(`
    //     SELECT u.email, u.name 
    //     FROM orders o
    //     LEFT JOIN users u ON o.user_id = u.id
    //     WHERE o.id = ?
    //   `, [orderId])
    // ]);

    // Update order status
    await executeQuery(
      'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, orderId]
    );

    // Send status update email to admin
    // await sendOrderConfirmationEmail(
    //   {
    //     orderId: orderDetails[0].order_number,
    //     customerName: user[0].name,
    //     customerEmail: user[0].email,
    //     shippingAddress: `${orderDetails[0].shipping_address}, ${orderDetails[0].shipping_city}, ${orderDetails[0].shipping_state} ${orderDetails[0].shipping_zip_code}`,
    //     items: orderItems.map(item => ({
    //       product_name: item.product_name,
    //       quantity: item.quantity,
    //       product_price: item.product_price,
    //       total_price: item.total_price
    //     })),
    //     totalAmount: orderDetails[0].total_amount,
    //     status: status,
    //     shippingMethod: orderDetails[0].shipping_method
    //   },
    //   process.env.ADMIN_EMAIL
    // );

    res.json({ message: 'Order status updated successfully' });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ message: 'Failed to update order status' });
  }
});

// Cancel order
router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);

    // Check if order exists and belongs to user
    const orders = await executeQuery(
      'SELECT id, status FROM orders WHERE id = ? AND user_id = ?',
      [orderId, req.user.id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = orders[0];

    if (order.status === 'cancelled') {
      return res.status(400).json({ message: 'Order is already cancelled' });
    }

    if (order.status === 'delivered') {
      return res.status(400).json({ message: 'Cannot cancel delivered order' });
    }

    // Cancel order
    await executeQuery(
      'UPDATE orders SET status = "cancelled", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [orderId]
    );

    // Restore product stock
    const orderItems = await executeQuery(
      'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
      [orderId]
    );

    for (const item of orderItems) {
      await executeQuery(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [item.quantity, item.product_id]
      );
    }

    res.json({ message: 'Order cancelled successfully' });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ message: 'Failed to cancel order' });
  }
});

// Get all orders (Admin only)
router.get('/admin/all', [authenticateToken, requireAdmin], async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let whereClause = 'WHERE 1=1';

    if (status && status !== 'all') {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += ' AND (o.order_number LIKE ? OR u.name LIKE ? OR u.email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Get orders with customer details
    const ordersQuery = `
      SELECT 
        o.*,
        u.name as customer_name,
        u.email as customer_email,
        COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      ${whereClause}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ${whereClause}
    `;

    const [orders, countResult] = await Promise.all([
      executeQuery(ordersQuery, [...params, parseInt(limit), offset]),
      executeQuery(countQuery, params)
    ]);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get admin orders error:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// Get order statistics (Admin only)
router.get('/admin/stats', [authenticateToken, requireAdmin], async (req, res) => {
  try {
    const stats = await executeQuery(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing_orders,
        SUM(CASE WHEN status = 'shipped' THEN 1 ELSE 0 END) as shipped_orders,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered_orders,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        SUM(total_amount) as total_revenue
      FROM orders
    `);

    const recentOrders = await executeQuery(`
      SELECT 
        o.order_number,
        o.total_amount,
        o.status,
        o.created_at,
        u.name as customer_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
      LIMIT 10
    `);

    res.json({
      stats: stats[0],
      recentOrders
    });
  } catch (error) {
    console.error('Get order stats error:', error);
    res.status(500).json({ message: 'Failed to fetch order statistics' });
  }
});

module.exports = router;