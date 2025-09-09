const express = require('express');
const { body, validationResult } = require('express-validator');
const { executeQuery } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Apply admin middleware to all routes
router.use(authenticateToken, requireAdmin);

// Get admin dashboard statistics
router.get('/dashboard', async (req, res) => {
  try {
    // Get overall statistics
    const stats = await executeQuery(`
      SELECT 
        COUNT(DISTINCT u.id) as total_users,
        COUNT(DISTINCT p.id) as total_products,
        COUNT(DISTINCT o.id) as total_orders,
        SUM(o.total_amount) as total_revenue
      FROM users u
      CROSS JOIN products p
      CROSS JOIN orders o
      WHERE u.status = 'active' AND p.status = 'active'
    `);

    // Get order statistics by status
    const orderStats = await executeQuery(`
      SELECT 
        status,
        COUNT(*) as count,
        SUM(total_amount) as revenue
      FROM orders
      GROUP BY status
    `);

    // Get recent orders
    const recentOrders = await executeQuery(`
      SELECT 
        o.order_number,
        o.total_amount,
        o.status,
        o.created_at,
        u.name as customer_name,
        u.email as customer_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
      LIMIT 10
    `);

    // Get top selling products
    const topProducts = await executeQuery(`
      SELECT 
        p.name,
        p.price,
        COUNT(oi.id) as order_count,
        SUM(oi.quantity) as total_quantity
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      LEFT JOIN orders o ON oi.order_id = o.id
      WHERE p.status = 'active'
      GROUP BY p.id
      ORDER BY total_quantity DESC
      LIMIT 5
    `);

    // Get category statistics
    const categoryStats = await executeQuery(`
      SELECT 
        c.name,
        COUNT(p.id) as product_count,
        COUNT(oi.id) as order_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND p.status = 'active'
      LEFT JOIN order_items oi ON p.id = oi.product_id
      WHERE c.status = 'active'
      GROUP BY c.id
      ORDER BY product_count DESC
    `);

    res.json({
      stats: stats[0],
      orderStats,
      recentOrders,
      topProducts,
      categoryStats
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard statistics' });
  }
});

// Get all users with pagination and filtering
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, role, status } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let whereClause = 'WHERE 1=1';

    if (search) {
      whereClause += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (role && role !== 'all') {
      whereClause += ' AND u.role = ?';
      params.push(role);
    }

    if (status && status !== 'all') {
      whereClause += ' AND u.status = ?';
      params.push(status);
    }

    // Get users with order statistics
    const usersQuery = `
      SELECT 
        u.*,
        COUNT(DISTINCT o.id) as total_orders,
        SUM(o.total_amount) as total_spent
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      ${whereClause}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM users u
      ${whereClause}
    `;

    const [users, countResult] = await Promise.all([
      executeQuery(usersQuery, [...params, parseInt(limit), offset]),
      executeQuery(countQuery, params)
    ]);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      users,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// Get single user details
router.get('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Get user details
    const users = await executeQuery(`
      SELECT * FROM users WHERE id = ?
    `, [userId]);

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];

    // Get user's orders
    const orders = await executeQuery(`
      SELECT 
        o.*,
        COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = ?
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 10
    `, [userId]);

    // Get user's wishlist
    const wishlist = await executeQuery(`
      SELECT 
        w.*,
        p.name as product_name,
        p.price,
        pi.image_url as product_image
      FROM wishlist w
      LEFT JOIN products p ON w.product_id = p.id
      LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = TRUE
      WHERE w.user_id = ?
      ORDER BY w.created_at DESC
    `, [userId]);

    res.json({
      user: {
        ...user,
        orders,
        wishlist
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Failed to fetch user' });
  }
});

// Update user status
router.put('/users/:id/status', [
  body('status').isIn(['active', 'inactive']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const userId = parseInt(req.params.id);
    const { status } = req.body;

    // Check if user exists
    const users = await executeQuery(
      'SELECT id FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user status
    await executeQuery(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, userId]
    );

    res.json({ message: 'User status updated successfully' });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ message: 'Failed to update user status' });
  }
});

// Get product statistics
// router.get('/products/stats', async (req, res) => {
//   try {
//     // Get product statistics
//     const productStats = await executeQuery(`
//       SELECT 
//         COUNT(*) as total_products,
//         COUNT(CASE WHEN status = 'active' THEN 1 END) as active_products,
//         COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive_products,
//         COUNT(CASE WHEN stock = 0 THEN 1 END) as out_of_stock,
//         COUNT(CASE WHEN stock < 10 AND stock > 0 THEN 1 END) as low_stock,
//         AVG(price) as avg_price,
//         SUM(stock) as total_stock
//       FROM products
//     `);

//     // Get products by category
//     const categoryProducts = await executeQuery(`
//       SELECT 
//         c.name as category,
//         COUNT(p.id) as product_count,
//         AVG(p.price) as avg_price
//       FROM categories c
//       LEFT JOIN products p ON c.id = p.category_id AND p.status = 'active'
//       WHERE c.status = 'active'
//       GROUP BY c.id
//       ORDER BY product_count DESC
//     `);

//     // Get top rated products
//     const topRated = await executeQuery(`
//       SELECT 
//         name,
//         price,
//         rating,
//         reviews_count
//       FROM products
//       WHERE status = 'active' AND rating > 0
//       ORDER BY rating DESC, reviews_count DESC
//       LIMIT 10
//     `);

//     res.json({
//       productStats: productStats[0],
//       categoryProducts,
//       topRated
//     });
//   } catch (error) {
//     console.error('Get product stats error:', error);
//     res.status(500).json({ message: 'Failed to fetch product statistics' });
//   }
// });
router.get('/products/stats', async (req, res) => {
  try {
    // Category distribution
    const categoryData = await executeQuery(`
      SELECT 
        c.name as category,
        COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND p.status = 'active'
      WHERE c.status = 'active'
      GROUP BY c.id
    `);

    const totalProducts = categoryData.reduce((sum, c) => sum + c.product_count, 0);

    const categoryDistribution = categoryData.map(c => ({
      category: c.category,
      percentage: totalProducts > 0 ? ((c.product_count / totalProducts) * 100).toFixed(2) : 0
    }));

    // Top products (by revenue)
    const topProducts = await executeQuery(`
      SELECT 
        p.id,
        p.name,
        p.price,
        SUM(oi.quantity) as sales,
        SUM(oi.quantity * p.price) as revenue,
        (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = TRUE LIMIT 1) as image
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      LEFT JOIN orders o ON oi.order_id = o.id
      WHERE p.status = 'active'
      GROUP BY p.id
      ORDER BY revenue DESC
      LIMIT 5
    `);

    res.json({
      categoryDistribution,
      topProducts: topProducts.map(p => ({
        name: p.name,
        sales: p.sales || 0,
        revenue: p.revenue || 0,
        image: p.image || null
      }))
    });
  } catch (error) {
    console.error('Get product stats error:', error);
    res.status(500).json({ message: 'Failed to fetch product statistics' });
  }
});


// Get order statistics
// router.get('/orders/stats', async (req, res) => {
//   try {
//     // Get order statistics
//     const orderStats = await executeQuery(`
//       SELECT 
//         COUNT(*) as total_orders,
//         COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
//         COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_orders,
//         COUNT(CASE WHEN status = 'shipped' THEN 1 END) as shipped_orders,
//         COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
//         COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
//         SUM(total_amount) as total_revenue,
//         AVG(total_amount) as avg_order_value
//       FROM orders
//     `);

//     // Get monthly revenue
//     const monthlyRevenue = await executeQuery(`
//       SELECT 
//         DATE_FORMAT(created_at, '%Y-%m') as month,
//         COUNT(*) as order_count,
//         SUM(total_amount) as revenue
//       FROM orders
//       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
//       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
//       ORDER BY month DESC
//     `);

//     // Get top customers
//     const topCustomers = await executeQuery(`
//       SELECT 
//         u.name,
//         u.email,
//         COUNT(o.id) as order_count,
//         SUM(o.total_amount) as total_spent
//       FROM users u
//       LEFT JOIN orders o ON u.id = o.user_id
//       WHERE u.role = 'customer'
//       GROUP BY u.id
//       ORDER BY total_spent DESC
//       LIMIT 10
//     `);

//     res.json({
//       orderStats: orderStats[0],
//       monthlyRevenue,
//       topCustomers
//     });
//   } catch (error) {
//     console.error('Get order stats error:', error);
//     res.status(500).json({ message: 'Failed to fetch order statistics' });
//   }
// });
router.get('/orders/stats', async (req, res) => {
  try {
    // Orders + revenue stats
    const monthlyRevenue = await executeQuery(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m') as month,
        SUM(total_amount) as sales,
        COUNT(*) as orders
      FROM orders
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      ORDER BY month ASC
    `);

    res.json({
      salesByMonth: monthlyRevenue.map(r => ({
        month: r.month,
        sales: r.sales || 0,
        orders: r.orders || 0
      }))
    });
  } catch (error) {
    console.error('Get order stats error:', error);
    res.status(500).json({ message: 'Failed to fetch order statistics' });
  }
});



// Get system overview
// router.get('/overview', async (req, res) => {
//   try {
//     // Get quick stats
//     const quickStats = await executeQuery(`
//       SELECT 
//         (SELECT COUNT(*) FROM users WHERE role = 'customer' AND status = 'active') as total_customers,
//         (SELECT COUNT(*) FROM products WHERE status = 'active') as total_products,
//         (SELECT COUNT(*) FROM orders WHERE status = 'pending') as pending_orders,
//         (SELECT SUM(total_amount) FROM orders WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as monthly_revenue
//     `);

//     // Get recent activity
//     const recentActivity = await executeQuery(`
//       (SELECT 'order' as type, order_number as identifier, created_at, total_amount as value
//        FROM orders 
//        ORDER BY created_at DESC 
//        LIMIT 5)
//       UNION ALL
//       (SELECT 'user' as type, email as identifier, created_at, NULL as value
//        FROM users 
//        WHERE role = 'customer'
//        ORDER BY created_at DESC 
//        LIMIT 5)
//       ORDER BY created_at DESC
//       LIMIT 10
//     `);

//     // Get low stock alerts
//     const lowStock = await executeQuery(`
//       SELECT 
//         name,
//         stock,
//         price
//       FROM products
//       WHERE stock < 10 AND status = 'active'
//       ORDER BY stock ASC
//       LIMIT 10
//     `);

//     res.json({
//       quickStats: quickStats[0],
//       recentActivity,
//       lowStock
//     });
//   } catch (error) {
//     console.error('Get overview error:', error);
//     res.status(500).json({ message: 'Failed to fetch overview' });
//   }
// });

router.get('/overview', async (req, res) => {
  try {
    // Current period = this month
    const currentPeriod = await executeQuery(`
      SELECT 
        SUM(total_amount) as revenue,
        COUNT(*) as orders
      FROM orders
      WHERE created_at >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
    `);

    // Previous period = last month
    const prevPeriod = await executeQuery(`
      SELECT 
        SUM(total_amount) as revenue,
        COUNT(*) as orders
      FROM orders
      WHERE created_at >= DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 1 MONTH), '%Y-%m-01')
        AND created_at < DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
    `);

    // Users
    const usersNow = await executeQuery(`
      SELECT COUNT(*) as total FROM users WHERE role = 'customer' AND status = 'active'
    `);
    const usersPrev = await executeQuery(`
      SELECT COUNT(*) as total 
      FROM users 
      WHERE role = 'customer' AND status = 'active'
        AND created_at < DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
    `);

    // Products
    const productsNow = await executeQuery(`
      SELECT COUNT(*) as total FROM products WHERE status = 'active'
    `);
    const productsPrev = await executeQuery(`
      SELECT COUNT(*) as total 
      FROM products 
      WHERE status = 'active'
        AND created_at < DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
    `);

    // Calculate percentages safely
    const calcChange = (now, prev) => {
      if (!prev || prev === 0) return 0;
      return ((now - prev) / prev * 100).toFixed(2);
    };

    res.json({
      totalRevenue: currentPeriod[0].revenue || 0,
      revenueChange: calcChange(currentPeriod[0].revenue || 0, prevPeriod[0].revenue || 0),
      totalOrders: currentPeriod[0].orders || 0,
      orderChange: calcChange(currentPeriod[0].orders || 0, prevPeriod[0].orders || 0),
      totalUsers: usersNow[0].total || 0,
      userChange: calcChange(usersNow[0].total || 0, usersPrev[0].total || 0),
      totalProducts: productsNow[0].total || 0,
      productChange: calcChange(productsNow[0].total || 0, productsPrev[0].total || 0)
    });
  } catch (error) {
    console.error('Get overview error:', error);
    res.status(500).json({ message: 'Failed to fetch overview' });
  }
});


module.exports = router;