const express = require('express');
const { body, validationResult } = require('express-validator');
const { executeQuery, pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const blogs = await executeQuery(`
      SELECT 
        id, 
        title, 
        excerpt, 
        image_url as image, 
        created_at as date
      FROM blogs 
      ORDER BY created_at DESC
    `);
    res.json(blogs);
  } catch (error) {
    console.error('Get all blogs error:', error);
    res.status(500).json({ message: 'Failed to fetch blog posts' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const blogId = parseInt(req.params.id);
    const blogResult = await executeQuery('SELECT * FROM blogs WHERE id = ?', [blogId]);
    if (blogResult.length === 0) {
      return res.status(404).json({ message: 'Blog post not found' });
    }
    const blog = blogResult[0];
    const tagsResult = await executeQuery(`
      SELECT t.name FROM tags t
      INNER JOIN blog_tags bt ON t.id = bt.tag_id
      WHERE bt.blog_id = ?
    `, [blogId]);

    const tags = tagsResult.map(tag => tag.name);

    res.json({ ...blog, tags });
  } catch (error) {
    console.error('Get single blog error:', error);
    res.status(500).json({ message: 'Failed to fetch blog post' });
  }
});

router.post('/', [authenticateToken, requireAdmin], [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('content').trim().notEmpty().withMessage('Content is required'),
  body('imageUrl').optional().isURL().withMessage('Must be a valid URL'),
  body('tags').optional().isArray().withMessage('Tags must be an array of strings')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }

  const { title, content, excerpt, imageUrl, author, tags = [] } = req.body;
  const connection = await pool.getConnection(); 

  try {
    await connection.beginTransaction();
    const blogInsertResult = await connection.query(
      'INSERT INTO blogs (title, content, excerpt, image_url, author) VALUES (?, ?, ?, ?, ?)',
      [title, content, excerpt, imageUrl, author]
    );
    const newBlogId = blogInsertResult[0].insertId;
    if (tags.length > 0) {
      for (const tagName of tags) {
        let [tagResult] = await connection.query('SELECT id FROM tags WHERE name = ?', [tagName.trim()]);
        let tagId;

        if (tagResult.length > 0) {
          tagId = tagResult[0].id;
        } else {
          const [newTagResult] = await connection.query('INSERT INTO tags (name) VALUES (?)', [tagName.trim()]);
          tagId = newTagResult.insertId;
        }
        await connection.query('INSERT INTO blog_tags (blog_id, tag_id) VALUES (?, ?)', [newBlogId, tagId]);
      }
    }
    
    await connection.commit();
    res.status(201).json({ message: 'Blog post created successfully', blogId: newBlogId });

  } catch (error) {
    await connection.rollback();
    console.error('Create blog post error:', error);
    res.status(500).json({ message: 'Failed to create blog post' });
  } finally {
    connection.release();
  }
});

router.put('/:id', [authenticateToken, requireAdmin], [
  body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
  body('content').optional().trim().notEmpty().withMessage('Content cannot be empty'),
  body('imageUrl').optional().isURL().withMessage('Must be a valid URL'),
  body('tags').optional().isArray().withMessage('Tags must be an array of strings')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }

  const blogId = parseInt(req.params.id);
  const { title, content, excerpt, imageUrl, author, tags } = req.body;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query(`
      UPDATE blogs SET 
        title = COALESCE(?, title),
        content = COALESCE(?, content),
        excerpt = COALESCE(?, excerpt),
        image_url = COALESCE(?, image_url),
        author = COALESCE(?, author)
      WHERE id = ?
    `, [title, content, excerpt, imageUrl, author, blogId]);
    if (tags) {
      await connection.query('DELETE FROM blog_tags WHERE blog_id = ?', [blogId]);

      if (tags.length > 0) {
         for (const tagName of tags) {
            let [tagResult] = await connection.query('SELECT id FROM tags WHERE name = ?', [tagName.trim()]);
            let tagId;

            if (tagResult.length > 0) {
              tagId = tagResult[0].id;
            } else {
              const [newTagResult] = await connection.query('INSERT INTO tags (name) VALUES (?)', [tagName.trim()]);
              tagId = newTagResult.insertId;
            }
            
            await connection.query('INSERT INTO blog_tags (blog_id, tag_id) VALUES (?, ?)', [blogId, tagId]);
          }
      }
    }

    await connection.commit();
    res.json({ message: 'Blog post updated successfully' });

  } catch (error) {
    await connection.rollback();
    console.error('Update blog post error:', error);
    res.status(500).json({ message: 'Failed to update blog post' });
  } finally {
    connection.release();
  }
});


router.delete('/:id', [authenticateToken, requireAdmin], async (req, res) => {
  try {
    const blogId = parseInt(req.params.id);
    const blogResult = await executeQuery('SELECT id FROM blogs WHERE id = ?', [blogId]);
    if (blogResult.length === 0) {
      return res.status(404).json({ message: 'Blog post not found' });
    }

    await executeQuery('DELETE FROM blogs WHERE id = ?', [blogId]);

    res.json({ message: 'Blog post deleted successfully' });
  } catch (error) {
    console.error('Delete blog post error:', error);
    res.status(500).json({ message: 'Failed to delete blog post' });
  }
});


module.exports = router;