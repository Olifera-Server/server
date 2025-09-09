const express = require("express");
const { body, validationResult } = require("express-validator");
const { executeQuery } = require("../config/database");
const {
  authenticateToken,
  requireAdmin,
  optionalAuth,
} = require("../middleware/auth");

const router = express.Router();

// Get all products with filtering and pagination
router.get("/", optionalAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      category,
      search,
      sortBy = "name",
      sortOrder = "ASC",
      minPrice,
      maxPrice,
    } = req.query;

    console.log(req.query);
    const offset = (page - 1) * limit;
    const params = [];
    let whereClause = 'WHERE p.status = "active"';

    // Add category filter
    if (category && category !== "All") {
      whereClause += " AND c.name = ?";
      params.push(category);
    }

    // Add search filter
    if (search) {
      whereClause += " AND (p.name LIKE ? OR p.description LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    // Add price filters
    if (minPrice) {
      whereClause += " AND p.price >= ?";
      params.push(parseFloat(minPrice));
    }
    if (maxPrice) {
      whereClause += " AND p.price <= ?";
      params.push(parseFloat(maxPrice));
    }

    // Validate sort parameters
    const allowedSortFields = ["name", "price", "rating", "created_at"];
    const allowedSortOrders = ["ASC", "DESC"];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : "name";
    const sortDirection = allowedSortOrders.includes(sortOrder.toUpperCase())
      ? sortOrder.toUpperCase()
      : "ASC";

    // Get products with category and primary image
    const productsQuery = `
      SELECT 
        p.*,
        c.name as category_name,
        pi.image_url as image
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = TRUE
      ${whereClause}
      ORDER BY p.${sortField} ${sortDirection}
      LIMIT ? OFFSET ?
    `;

    console.log(productsQuery);

    const countQuery = `
      SELECT COUNT(*) as total
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereClause}
    `;

    console.log(params);

    const [products, countResult] = await Promise.all([
      executeQuery(productsQuery, [...params, parseInt(limit), offset]),
      executeQuery(countQuery, params),
    ]);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      products,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: total,
        itemsPerPage: parseInt(limit),
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get products error:", error);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});

// Get featured products
router.get("/featured", async (req, res) => {
  try {
    const products = await executeQuery(`
      SELECT p.*, c.name as category_name, pi.image_url as image
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = TRUE
      WHERE p.status = 'active' AND (p.badge IS NOT NULL OR p.rating >= 4.5)
      ORDER BY p.rating DESC, p.created_at DESC
      LIMIT 3
    `);

    res.json({ products });
  } catch (error) {
    console.error("Get featured products error:", error);
    res.status(500).json({ message: "Failed to fetch featured products" });
  }
});

// Get single product with all details
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const productId = parseInt(req.params.id);

    // Get product details
    const products = await executeQuery(
      `
      SELECT 
        p.*,
        c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ? AND p.status = "active"
    `,
      [productId]
    );

    if (products.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    const product = products[0];

    // Get product images
    const images = await executeQuery(
      `
      SELECT image_url, is_primary, display_order
      FROM product_images
      WHERE product_id = ?
      ORDER BY is_primary DESC, display_order ASC
    `,
      [productId]
    );

    // Get product specifications
    const specifications = await executeQuery(
      `
      SELECT spec_key, spec_value
      FROM product_specifications
      WHERE product_id = ?
      ORDER BY spec_key
    `,
      [productId]
    );

    // Get product features
    const features = await executeQuery(
      `
      SELECT feature_text
      FROM product_features
      WHERE product_id = ?
      ORDER BY display_order ASC
    `,
      [productId]
    );

    // Get product reviews
    const reviews = await executeQuery(
      `
      SELECT 
        pr.*,
        u.name as user_name
      FROM product_reviews pr
      LEFT JOIN users u ON pr.user_id = u.id
      WHERE pr.product_id = ?
      ORDER BY pr.created_at DESC
      LIMIT 10
    `,
      [productId]
    );

    // Check if product is in user's wishlist
    let isInWishlist = false;
    if (req.user) {
      const wishlistItems = await executeQuery(
        `
        SELECT id FROM wishlist WHERE user_id = ? AND product_id = ?
      `,
        [req.user.id, productId]
      );
      isInWishlist = wishlistItems.length > 0;
    }

    // Format specifications as object
    const specsObject = {};
    specifications.forEach((spec) => {
      specsObject[spec.spec_key] = spec.spec_value;
    });

    res.json({
      product: {
        ...product,
        images: images.map((img) => img.image_url),
        specifications: specsObject,
        features: features.map((f) => f.feature_text),
        reviews,
        isInWishlist,
      },
    });
  } catch (error) {
    console.error("Get product error:", error);
    res.status(500).json({ message: "Failed to fetch product" });
  }
});

// Create new product (Admin only)
router.post(
  "/",
  [authenticateToken, requireAdmin],
  [
    body("name").trim().notEmpty().withMessage("Product name is required"),
    body("description")
      .trim()
      .notEmpty()
      .withMessage("Product description is required"),
    body("price").isFloat({ min: 0 }).withMessage("Valid price is required"),
    body("category_id")
      .isInt({ min: 1 })
      .withMessage("Valid category is required"),
    body("stock")
      .isInt({ min: 0 })
      .withMessage("Valid stock quantity is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      console.log(req.body);
      console.log(errors);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const {
        name,
        description,
        price,
        original_price,
        category_id,
        stock,
        badge = "New Product",
        images,
        specifications,
        features,
      } = req.body;

      // Check if category exists
      const categories = await executeQuery(
        'SELECT id FROM categories WHERE id = ? AND status = "active"',
        [category_id]
      );

      if (categories.length === 0) {
        return res.status(400).json({ message: "Invalid category" });
      }

      // Create product
      const result = await executeQuery(
        `
      INSERT INTO products (name, description, price, original_price, category_id, stock, badge)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
        [name, description, price, original_price, category_id, stock, badge]
      );

      const productId = result.insertId;

      // Add images
      if (images && images.length > 0) {
        for (let i = 0; i < images.length; i++) {
          await executeQuery(
            `
          INSERT INTO product_images (product_id, image_url, is_primary, display_order)
          VALUES (?, ?, ?, ?)
        `,
            [productId, images[i], i === 0, i]
          );
        }
      }

      // Add specifications
      if (specifications) {
        for (const [key, value] of Object.entries(specifications)) {
          await executeQuery(
            `
          INSERT INTO product_specifications (product_id, spec_key, spec_value)
          VALUES (?, ?, ?)
        `,
            [productId, key, value]
          );
        }
      }

      // Add features
      if (features && features.length > 0) {
        for (let i = 0; i < features.length; i++) {
          await executeQuery(
            `
          INSERT INTO product_features (product_id, feature_text, display_order)
          VALUES (?, ?, ?)
        `,
            [productId, features[i], i]
          );
        }
      }

      res.status(201).json({
        message: "Product created successfully",
        productId,
      });
    } catch (error) {
      console.error("Create product error:", error);
      res.status(500).json({ message: "Failed to create product" });
    }
  }
);

// Update product (Admin only)
router.put(
  "/:id",
  [authenticateToken, requireAdmin],
  [
    body("name")
      .optional()
      .trim()
      .notEmpty()
      .withMessage("Product name cannot be empty"),
    body("price")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Valid price is required"),
    body("stock")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Valid stock quantity is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const productId = parseInt(req.params.id);
      const {
        name,
        description,
        price,
        original_price,
        category_id,
        stock,
        badge,
        status,
      } = req.body;

      // Check if product exists
      const products = await executeQuery(
        "SELECT id FROM products WHERE id = ?",
        [productId]
      );

      if (products.length === 0) {
        return res.status(404).json({ message: "Product not found" });
      }

      // Update product
      await executeQuery(
        `
      UPDATE products 
      SET name = COALESCE(?, name),
          description = COALESCE(?, description),
          price = COALESCE(?, price),
          original_price = COALESCE(?, original_price),
          category_id = COALESCE(?, category_id),
          stock = COALESCE(?, stock),
          badge = COALESCE(?, badge),
          status = COALESCE(?, status),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
        [
          name,
          description,
          price,
          original_price,
          category_id,
          stock,
          badge,
          status,
          productId,
        ]
      );

      res.json({ message: "Product updated successfully" });
    } catch (error) {
      console.error("Update product error:", error);
      res.status(500).json({ message: "Failed to update product" });
    }
  }
);

// Delete product (Admin only)
router.delete("/:id", [authenticateToken, requireAdmin], async (req, res) => {
  try {
    const productId = parseInt(req.params.id);

    // Check if product exists
    const products = await executeQuery(
      "SELECT id FROM products WHERE id = ?",
      [productId]
    );

    if (products.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Soft delete by setting status to inactive
    await executeQuery(
      'UPDATE products SET status = "inactive", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [productId]
    );

    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ message: "Failed to delete product" });
  }
});

// Add product review
router.post(
  "/:id/reviews",
  authenticateToken,
  [
    body("rating")
      .isInt({ min: 1, max: 5 })
      .withMessage("Rating must be between 1 and 5"),
    body("review_text").optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const productId = parseInt(req.params.id);
      const { rating, review_text } = req.body;

      // Check if product exists
      const products = await executeQuery(
        'SELECT id FROM products WHERE id = ? AND status = "active"',
        [productId]
      );

      if (products.length === 0) {
        return res.status(404).json({ message: "Product not found" });
      }

      // Check if user already reviewed this product
      const existingReviews = await executeQuery(
        "SELECT id FROM product_reviews WHERE user_id = ? AND product_id = ?",
        [req.user.id, productId]
      );

      if (existingReviews.length > 0) {
        return res
          .status(400)
          .json({ message: "You have already reviewed this product" });
      }

      // Add review
      await executeQuery(
        `
      INSERT INTO product_reviews (product_id, user_id, rating, review_text)
      VALUES (?, ?, ?, ?)
    `,
        [productId, req.user.id, rating, review_text]
      );

      const reviewStats = await executeQuery(
        `
      SELECT
        COUNT(id) AS review_count,
        AVG(rating) AS average_rating
      FROM product_reviews
      WHERE product_id = ?
    `,
        [productId]
      );

      if (reviewStats.length > 0) {
        const { review_count, average_rating } = reviewStats[0];

        // 3. Update the products table with the new stats
        await executeQuery(
          `
        UPDATE products
        SET
          reviews_count = ?,
          rating = ?
        WHERE id = ?
      `,
          [review_count, average_rating, productId]
        );
      }

      res.status(201).json({ message: "Review added successfully" });
    } catch (error) {
      console.error("Add review error:", error);
      res.status(500).json({ message: "Failed to add review" });
    }
  }
);

module.exports = router;
