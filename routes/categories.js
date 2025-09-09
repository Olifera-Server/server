const express = require('express');
const { body, validationResult } = require('express-validator');
const { executeQuery } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all categories
router.get('/', async (req, res) => {
  try {
    const categories = await executeQuery(`
      SELECT 
        c.*,
        COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND p.status = 'active'
      WHERE c.status = 'active'
      GROUP BY c.id
      ORDER BY c.name ASC
    `);

    res.json({ categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ message: 'Failed to fetch categories' });
  }
});

// Get single category with products
router.get('/:id', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id);

    // Get category details
    const categories = await executeQuery(`
      SELECT * FROM categories WHERE id = ? AND status = 'active'
    `, [categoryId]);

    if (categories.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const category = categories[0];

    // Get products in this category
    const products = await executeQuery(`
      SELECT 
        p.*,
        pi.image_url as image
      FROM products p
      LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = TRUE
      WHERE p.category_id = ? AND p.status = 'active'
      ORDER BY p.name ASC
    `, [categoryId]);

    res.json({
      category: {
        ...category,
        products
      }
    });
  } catch (error) {
    console.error('Get category error:', error);
    res.status(500).json({ message: 'Failed to fetch category' });
  }
});

// Create new category (Admin only)
router.post('/', [authenticateToken, requireAdmin], [
  body('name').trim().notEmpty().withMessage('Category name is required'),
  body('description').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { name, description } = req.body;

    // Check if category already exists
    const existingCategories = await executeQuery(
      'SELECT id FROM categories WHERE name = ?',
      [name]
    );

    if (existingCategories.length > 0) {
      return res.status(400).json({ message: 'Category with this name already exists' });
    }

    // Create category
    const result = await executeQuery(`
      INSERT INTO categories (name, description)
      VALUES (?, ?)
    `, [name, description]);

    res.status(201).json({
      message: 'Category created successfully',
      id: result.insertId,
      name: name,
      status: "Active",
      description: description
    });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ message: 'Failed to create category' });
  }
});

// Update category (Admin only)
router.put('/:id', [authenticateToken, requireAdmin], [
  body('name').optional().trim().notEmpty().withMessage('Category name cannot be empty'),
  body('description').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const categoryId = parseInt(req.params.id);
    const { name, description } = req.body;

    // Check if category exists
    const categories = await executeQuery(
      'SELECT id FROM categories WHERE id = ?',
      [categoryId]
    );

    if (categories.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }

    // Check if new name conflicts with existing category
    if (name) {
      const existingCategories = await executeQuery(
        'SELECT id FROM categories WHERE name = ? AND id != ?',
        [name, categoryId]
      );

      if (existingCategories.length > 0) {
        return res.status(400).json({ message: 'Category with this name already exists' });
      }
    }

    // Update category
    await executeQuery(`
      UPDATE categories 
      SET name = COALESCE(?, name),
          description = COALESCE(?, description),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [name, description, categoryId]);

    res.json({ message: 'Category updated successfully' });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ message: 'Failed to update category' });
  }
});

// Delete category (Admin only)
router.delete('/:id', [authenticateToken, requireAdmin], async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id);

    // Check if category exists
    const categories = await executeQuery(
      'SELECT id FROM categories WHERE id = ?',
      [categoryId]
    );

    if (categories.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }

    // Check if category has products
    const products = await executeQuery(
      'SELECT COUNT(*) as count FROM products WHERE category_id = ? AND status = "active"',
      [categoryId]
    );

    if (products[0].count > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete category with active products. Please move or delete the products first.' 
      });
    }

    // Soft delete by setting status to inactive
    await executeQuery(
      'UPDATE categories SET status = "inactive", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [categoryId]
    );

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ message: 'Failed to delete category' });
  }
});

module.exports = router;